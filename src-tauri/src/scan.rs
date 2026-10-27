//! Inbox scanning: finds every sender that includes a `List-Unsubscribe`
//! header and groups their messages.

use std::collections::HashMap;

use async_imap::types::{Fetch, NameAttribute};
use futures_util::TryStreamExt;

use mailparse::{addrparse_header, parse_headers, MailAddr, MailHeaderMap};
use serde::{Deserialize, Serialize};

use crate::listunsub::{self, UnsubscribeMethods};
use crate::mail::{timed, ImapSession, IO_TIMEOUT};

pub const INBOX: &str = "INBOX";
const BATCH: usize = 250;
const FETCH_QUERY: &str = "(UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST)])";

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub scanned_at: i64,
    pub months: u32,
    pub messages_scanned: u32,
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
}

fn parse_message_headers(raw: &[u8]) -> Option<Header> {
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

    Some(Header {
        email,
        name,
        subject: headers.get_first_value("Subject").unwrap_or_default(),
        methods,
    })
}

/// Scans the inbox for mailing lists received in the last `months` months.
pub async fn scan(
    session: &mut ImapSession,
    months: u32,
    mut progress: impl FnMut(ScanProgress),
) -> Result<ScanResult, String> {
    const E: &str = "scan_failed";
    // EXAMINE opens the mailbox read-only, so scanning never marks anything as read.
    timed(E, IO_TIMEOUT, session.examine(INBOX)).await?;

    let since = chrono::Utc::now() - chrono::Duration::days(i64::from(months) * 31);
    let query = format!("SINCE {}", since.format("%d-%b-%Y"));
    let mut uids: Vec<u32> = timed(E, IO_TIMEOUT, session.uid_search(query))
        .await?
        .into_iter()
        .collect();
    uids.sort_unstable_by(|a, b| b.cmp(a));

    let total = uids.len();
    let mut senders: HashMap<String, Sender> = HashMap::new();
    let mut done = 0;
    progress(ScanProgress {
        done,
        total,
        lists: 0,
    });

    for chunk in uids.chunks(BATCH) {
        let fetches = fetch_all(session, &uid_set(chunk), FETCH_QUERY)
            .await
            .map_err(|e| format!("{E}: {e}"))?;

        for fetch in &fetches {
            let Some(header) = fetch.header().and_then(parse_message_headers) else {
                continue;
            };
            let date = fetch.internal_date().map(|d| d.timestamp()).unwrap_or(0);

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

    let mut senders: Vec<Sender> = senders.into_values().collect();
    senders.sort_by(|a, b| b.count.cmp(&a.count).then(b.last_seen.cmp(&a.last_seen)));

    Ok(ScanResult {
        scanned_at: chrono::Utc::now().timestamp(),
        months,
        messages_scanned: total as u32,
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

/// Finds the special-use `\Trash` folder, falling back to common names.
pub async fn find_trash(session: &mut ImapSession) -> Result<String, String> {
    let fut = async {
        session
            .list(Some(""), Some("*"))
            .await?
            .try_collect::<Vec<_>>()
            .await
    };
    let names = timed("trash_failed", IO_TIMEOUT, fut).await?;

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

/// Moves every inbox message from `sender` to the trash. Returns how many were moved.
pub async fn move_to_trash(
    session: &mut ImapSession,
    trash: &str,
    sender: &str,
) -> Result<u32, String> {
    const E: &str = "trash_failed";
    timed(E, IO_TIMEOUT, session.select(INBOX)).await?;

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
        let h = parse_message_headers(raw).unwrap();
        assert_eq!(h.email, "news@shop.example");
        assert_eq!(h.name, "Shop News");
        assert_eq!(h.subject, "Saldi €");
        assert!(h.methods.one_click.is_some());
    }

    #[test]
    fn ignores_messages_without_list_unsubscribe() {
        let raw = b"From: friend@example.com\r\nSubject: hi\r\n\r\n";
        assert!(parse_message_headers(raw).is_none());
    }
}
