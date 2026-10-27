//! Mailbox scanning: finds every sender that includes a `List-Unsubscribe`
//! header, groups their messages and classifies them as newsletter or not.

use std::collections::HashMap;

use async_imap::types::{Fetch, NameAttribute};
use futures_util::TryStreamExt;

use mailparse::{addrparse_header, parse_headers, MailAddr, MailHeaderMap};
use serde::{Deserialize, Serialize};

use crate::classify::{self, GmailCategory, Kind};
use crate::listunsub::{self, UnsubscribeMethods};
use crate::mail::{timed, ImapSession, IO_TIMEOUT};

pub const INBOX: &str = "INBOX";
const BATCH: usize = 500;

fn fetch_query() -> String {
    format!(
        "(UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST {})])",
        classify::HEADERS
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sender {
    /// Lowercased sender address.
    pub key: String,
    pub name: String,
    pub email: String,
    pub count: u32,
    /// Unix timestamps (seconds) of the oldest and newest message.
    pub first_seen: i64,
    pub last_seen: i64,
    pub last_subject: String,
    /// Taken from the newest message, whose links are the most likely to still work.
    pub methods: UnsubscribeMethods,
    /// Scans saved before classification existed default to newsletter.
    #[serde(default)]
    pub kind: Kind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub scanned_at: i64,
    pub months: u32,
    /// Every message in the period, with or without unsubscribe links.
    pub messages_scanned: u32,
    #[serde(default)]
    pub folders: Vec<String>,
    pub senders: Vec<Sender>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: usize,
    pub total: usize,
    pub lists: usize,
}

struct Header {
    email: String,
    name: String,
    subject: String,
    methods: UnsubscribeMethods,
    score: i32,
}

fn parse_message_headers(raw: &[u8], gmail: Option<GmailCategory>) -> Option<Header> {
    let (headers, _) = parse_headers(raw).ok()?;
    let unsub = headers.get_first_value("List-Unsubscribe")?;
    let post = headers.get_first_value("List-Unsubscribe-Post");
    let methods = listunsub::parse(&unsub, post.as_deref());
    if methods.is_empty() {
        return None;
    }

    let from = headers.get_first_header("From")?;
    let (email, name) = match addrparse_header(from).ok()?.iter().next()? {
        MailAddr::Single(info) => (info.addr.trim().to_lowercase(), info.display_name.clone()),
        MailAddr::Group(group) => {
            let info = group.addrs.first()?;
            (info.addr.trim().to_lowercase(), info.display_name.clone())
        }
    };
    if !email.contains('@') {
        return None;
    }
    let name = name
        .map(|n| n.trim().trim_matches('"').trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| email.clone());

    let subject = headers.get_first_value("Subject").unwrap_or_default();
    Some(Header {
        email,
        name,
        score: classify::score(&headers, &subject, gmail),
        subject,
        methods,
    })
}

/// Picks the folders to scan. Gmail's "All Mail" (`\\All`) holds archived
/// messages too, so it's used alone; elsewhere the inbox plus any `\\Archive`.
pub async fn scan_folders(session: &mut ImapSession) -> Result<Vec<String>, String> {
    let names = list_folders(session).await?;
    let with = |attr: NameAttribute<'static>| -> Vec<String> {
        names
            .iter()
            .filter(|n| n.attributes().contains(&attr))
            .map(|n| n.name().to_string())
            .collect()
    };
    let all = with(NameAttribute::All);
    if let Some(first) = all.into_iter().next() {
        return Ok(vec![first]);
    }
    let mut folders = vec![INBOX.to_string()];
    folders.extend(with(NameAttribute::Archive));
    Ok(folders)
}

/// Gmail's inbox categories, via the X-GM-RAW search extension.
async fn gmail_categories(
    session: &mut ImapSession,
    since: &str,
) -> Result<HashMap<u32, GmailCategory>, String> {
    let mut map = HashMap::new();
    for (name, category) in [
        ("updates", GmailCategory::Updates),
        ("social", GmailCategory::Social),
        ("promotions", GmailCategory::Promotions),
    ] {
        let query = format!("X-GM-RAW \"category:{name}\" {since}");
        let uids = timed("scan_failed", IO_TIMEOUT, session.uid_search(query)).await?;
        map.extend(uids.into_iter().map(|u| (u, category)));
    }
    Ok(map)
}

/// Scans the mailbox for mailing lists received in the last `months` months.
pub async fn scan(
    session: &mut ImapSession,
    months: u32,
    mut progress: impl FnMut(ScanProgress),
) -> Result<ScanResult, String> {
    const E: &str = "scan_failed";
    let since = chrono::Utc::now() - chrono::Duration::days(i64::from(months) * 31);
    let since = format!("SINCE {}", since.format("%d-%b-%Y"));
    let is_gmail = timed(E, IO_TIMEOUT, session.capabilities())
        .await?
        .has_str("X-GM-EXT-1");
    let folders = scan_folders(session).await?;

    // Collect every folder's UIDs first so progress covers the whole scan.
    let mut work: Vec<(String, Vec<u32>, HashMap<u32, GmailCategory>)> = Vec::new();
    for folder in &folders {
        // EXAMINE opens the folder read-only, so scanning never marks anything as read.
        timed(E, IO_TIMEOUT, session.examine(folder)).await?;
        let mut uids: Vec<u32> = timed(E, IO_TIMEOUT, session.uid_search(&since))
            .await?
            .into_iter()
            .collect();
        uids.sort_unstable_by(|a, b| b.cmp(a));
        // Categories are a hint only; ignore servers that reject the search.
        let categories = if is_gmail {
            gmail_categories(session, &since).await.unwrap_or_default()
        } else {
            HashMap::new()
        };
        work.push((folder.clone(), uids, categories));
    }

    let total: usize = work.iter().map(|(_, uids, _)| uids.len()).sum();
    let mut senders: HashMap<String, Sender> = HashMap::new();
    let mut scores: HashMap<String, i32> = HashMap::new();
    let mut done = 0;
    progress(ScanProgress {
        done,
        total,
        lists: 0,
    });

    let query = fetch_query();
    for (folder, uids, categories) in &work {
        timed(E, IO_TIMEOUT, session.examine(folder)).await?;
        for chunk in uids.chunks(BATCH) {
            let fetches = fetch_all(session, &uid_set(chunk), &query)
                .await
                .map_err(|e| format!("{E}: {e}"))?;

            for fetch in &fetches {
                let gmail = fetch.uid.and_then(|u| categories.get(&u).copied());
                let Some(header) = fetch.header().and_then(|h| parse_message_headers(h, gmail))
                else {
                    continue;
                };
                let date = fetch.internal_date().map(|d| d.timestamp()).unwrap_or(0);

                *scores.entry(header.email.clone()).or_default() += header.score;
                let sender = senders
                    .entry(header.email.clone())
                    .or_insert_with(|| Sender {
                        key: header.email.clone(),
                        name: header.name.clone(),
                        email: header.email.clone(),
                        count: 0,
                        first_seen: date,
                        last_seen: i64::MIN,
                        last_subject: String::new(),
                        methods: UnsubscribeMethods::default(),
                        kind: Kind::Newsletter,
                    });
                sender.count += 1;
                sender.first_seen = sender.first_seen.min(date);
                if date >= sender.last_seen {
                    sender.last_seen = date;
                    sender.name = header.name;
                    sender.last_subject = header.subject;
                    sender.methods = header.methods;
                }
            }

            done += chunk.len();
            progress(ScanProgress {
                done,
                total,
                lists: senders.len(),
            });
        }
    }

    let mut senders: Vec<Sender> = senders
        .into_values()
        .map(|mut s| {
            s.kind = classify::kind(scores.get(&s.key).copied().unwrap_or(0), s.count);
            s
        })
        .collect();
    senders.sort_by(|a, b| b.count.cmp(&a.count).then(b.last_seen.cmp(&a.last_seen)));

    Ok(ScanResult {
        scanned_at: chrono::Utc::now().timestamp(),
        months,
        messages_scanned: total as u32,
        folders,
        senders,
    })
}

fn uid_set(uids: &[u32]) -> String {
    uids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// Runs a UID FETCH and drains the response stream (it must be fully read
/// before the connection can be used again).
async fn fetch_all(
    session: &mut ImapSession,
    set: &str,
    query: &str,
) -> Result<Vec<Fetch>, String> {
    let fut = async {
        session
            .uid_fetch(set, query)
            .await?
            .try_collect::<Vec<_>>()
            .await
    };
    timed("fetch", IO_TIMEOUT, fut)
        .await
        .map_err(|e| e.trim_start_matches("fetch: ").to_string())
}

async fn list_folders(session: &mut ImapSession) -> Result<Vec<async_imap::types::Name>, String> {
    let fut = async {
        session
            .list(Some(""), Some("*"))
            .await?
            .try_collect::<Vec<_>>()
            .await
    };
    timed("scan_failed", IO_TIMEOUT, fut).await
}

/// Finds the special-use `\Trash` folder, falling back to common names.
pub async fn find_trash(session: &mut ImapSession) -> Result<String, String> {
    let names = list_folders(session)
        .await
        .map_err(|e| e.replace("scan_failed", "trash_failed"))?;

    let special = names.iter().find(|n| {
        n.attributes()
            .iter()
            .any(|a| matches!(a, NameAttribute::Trash))
    });
    if let Some(name) = special {
        return Ok(name.name().to_string());
    }

    const COMMON: &[&str] = &[
        "Trash",
        "INBOX.Trash",
        "Deleted Items",
        "Deleted Messages",
        "Cestino",
        "INBOX.Cestino",
        "Posta eliminata",
        "Bin",
    ];
    COMMON
        .iter()
        .find_map(|c| names.iter().find(|n| n.name().eq_ignore_ascii_case(c)))
        .map(|n| n.name().to_string())
        .ok_or_else(|| "trash_failed: no trash folder".to_string())
}

/// Moves every message from `sender` in `folder` to the trash. Returns how many were moved.
pub async fn move_to_trash(
    session: &mut ImapSession,
    folder: &str,
    trash: &str,
    sender: &str,
) -> Result<u32, String> {
    const E: &str = "trash_failed";
    timed(E, IO_TIMEOUT, session.select(folder)).await?;

    // IMAP's FROM search is a substring match, so confirm the exact address
    // before touching anything ("ann@x.com" must not catch "joann@x.com").
    let query = format!("FROM \"{}\"", sender.replace(['"', '\\'], ""));
    let candidates: Vec<u32> = timed(E, IO_TIMEOUT, session.uid_search(query))
        .await?
        .into_iter()
        .collect();
    if candidates.is_empty() {
        return Ok(0);
    }
    let fetches = fetch_all(
        session,
        &uid_set(&candidates),
        "(UID BODY.PEEK[HEADER.FIELDS (FROM)])",
    )
    .await
    .map_err(|e| format!("{E}: {e}"))?;
    let uids: Vec<u32> = fetches
        .iter()
        .filter(|f| {
            f.header()
                .and_then(|h| parse_headers(h).ok())
                .and_then(|(h, _)| {
                    h.get_first_header("From")
                        .and_then(|f| addrparse_header(f).ok())
                })
                .and_then(|list| list.extract_single_info())
                .is_some_and(|info| info.addr.trim().eq_ignore_ascii_case(sender))
        })
        .filter_map(|f| f.uid)
        .collect();
    if uids.is_empty() {
        return Ok(0);
    }

    let set = uid_set(&uids);
    if timed(E, IO_TIMEOUT, session.uid_mv(&set, trash))
        .await
        .is_err()
    {
        // Server without the MOVE extension: copy, flag as deleted, expunge.
        timed(E, IO_TIMEOUT, session.uid_copy(&set, trash)).await?;
        let flag = async {
            session
                .uid_store(&set, "+FLAGS.SILENT (\\Deleted)")
                .await?
                .try_collect::<Vec<_>>()
                .await
        };
        timed(E, IO_TIMEOUT, flag).await?;
        let expunge = async { session.expunge().await?.try_collect::<Vec<_>>().await };
        timed(E, IO_TIMEOUT, expunge).await?;
    }
    Ok(uids.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_list_headers() {
        let raw = b"From: \"Shop News\" <News@Shop.example>\r\nSubject: =?UTF-8?Q?Saldi_=E2=82=AC?=\r\nList-Unsubscribe: <https://shop.example/u?x=1>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n";
        let h = parse_message_headers(raw, None).unwrap();
        assert_eq!(h.email, "news@shop.example");
        assert_eq!(h.name, "Shop News");
        assert_eq!(h.subject, "Saldi €");
        assert!(h.methods.one_click.is_some());
    }

    #[test]
    fn ignores_messages_without_list_unsubscribe() {
        let raw = b"From: friend@example.com\r\nSubject: hi\r\n\r\n";
        assert!(parse_message_headers(raw, None).is_none());
    }
}
