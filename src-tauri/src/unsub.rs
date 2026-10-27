//! Leaving mailing lists.

use std::time::Duration;

use futures_util::{stream, StreamExt};
use serde::Serialize;

use crate::listunsub::parse_mailto;
use crate::mail::Smtp;
use crate::scan::Sender;
use crate::store::UnsubMethod;

const USER_AGENT: &str = concat!(
    "QuitList/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/rickardomc/quit-list)"
);
const DEFAULT_SUBJECT: &str = "Unsubscribe";
const DEFAULT_BODY: &str = "Please unsubscribe me from this mailing list.";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Request accepted by the sender; nothing else to do.
    Done,
    /// The sender only offers a web page; the user has to open it.
    Manual,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub key: String,
    pub name: String,
    pub status: Status,
    pub method: Option<UnsubMethod>,
    pub url: Option<String>,
    pub error: Option<String>,
    pub trashed: u32,
}

impl Outcome {
    fn new(sender: &Sender, status: Status, method: Option<UnsubMethod>) -> Self {
        Self {
            key: sender.key.clone(),
            name: sender.name.clone(),
            status,
            method,
            url: None,
            error: None,
            trashed: 0,
        }
    }
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(25))
        .build()
        .expect("static reqwest configuration is valid")
}

/// RFC 8058 one-click unsubscribe.
async fn one_click(client: &reqwest::Client, url: &str) -> Result<(), String> {
    let response = client
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body("List-Unsubscribe=One-Click")
        .send()
        .await
        .map_err(|e| format!("http_failed: {e}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("http_failed: HTTP {}", response.status().as_u16()))
    }
}

/// Runs every one-click request concurrently, returning one result per sender
/// (`None` when the sender has no one-click URL).
pub async fn run_one_click(
    senders: &[Sender],
    mut on_result: impl FnMut(),
) -> Vec<Option<Result<(), String>>> {
    let client = http_client();
    let mut results: Vec<Option<Result<(), String>>> = vec![None; senders.len()];
    // Collect owned jobs first: a stream borrowing `senders` is not `Send`
    // enough for Tauri's async commands.
    let jobs: Vec<(usize, String)> = senders
        .iter()
        .enumerate()
        .filter_map(|(i, s)| Some((i, s.methods.one_click.clone()?)))
        .collect();
    let mut pending = stream::iter(jobs)
        .map(|(i, url)| {
            let client = client.clone();
            async move { (i, one_click(&client, &url).await) }
        })
        .buffer_unordered(8);

    while let Some((i, result)) = pending.next().await {
        results[i] = Some(result);
        on_result();
    }
    results
}

/// Decides the final outcome for one sender, sending the unsubscribe email
/// when one-click is unavailable or failed.
pub fn finish(
    sender: &Sender,
    one_click_result: Option<Result<(), String>>,
    smtp: &mut Option<Result<Smtp, String>>,
    connect_smtp: &dyn Fn() -> Result<Smtp, String>,
) -> Outcome {
    let mut last_error = None;
    match one_click_result {
        Some(Ok(())) => return Outcome::new(sender, Status::Done, Some(UnsubMethod::OneClick)),
        Some(Err(e)) => last_error = Some(e),
        None => {}
    }

    if let Some(mailto) = sender.methods.mailto.as_deref().and_then(parse_mailto) {
        // Connect lazily: many runs never need SMTP at all.
        let smtp = smtp.get_or_insert_with(connect_smtp);
        let sent = match smtp {
            Ok(smtp) => smtp.send(
                &mailto.to,
                mailto
                    .subject
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(DEFAULT_SUBJECT),
                mailto
                    .body
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(DEFAULT_BODY),
            ),
            Err(e) => Err(e.clone()),
        };
        match sent {
            Ok(()) => return Outcome::new(sender, Status::Done, Some(UnsubMethod::Email)),
            Err(e) => last_error = Some(e),
        }
    }

    if let Some(link) = &sender.methods.link {
        let mut outcome = Outcome::new(sender, Status::Manual, Some(UnsubMethod::Link));
        outcome.url = Some(link.clone());
        outcome.error = last_error;
        return outcome;
    }

    let mut outcome = Outcome::new(sender, Status::Failed, None);
    outcome.error = last_error.or_else(|| Some("no_method".into()));
    outcome
}
