//! Parsing of the `List-Unsubscribe` (RFC 2369) and `List-Unsubscribe-Post`
//! (RFC 8058) headers, and of `mailto:` URIs (RFC 6068).

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};

/// How a mailing list can be left, in order of preference.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnsubscribeMethods {
    /// HTTPS URL that accepts an RFC 8058 one-click POST. Fully automatic.
    pub one_click: Option<String>,
    /// `mailto:` URI. Automatic: we send the email through the user's SMTP server.
    pub mailto: Option<String>,
    /// Plain web link. Needs the user to confirm on the sender's page.
    pub link: Option<String>,
}

impl UnsubscribeMethods {
    pub fn is_empty(&self) -> bool {
        self.one_click.is_none() && self.mailto.is_none() && self.link.is_none()
    }
}

/// Parses `List-Unsubscribe` values. `post` is the `List-Unsubscribe-Post` header, if any.
pub fn parse(list_unsubscribe: &str, post: Option<&str>) -> UnsubscribeMethods {
    let one_click_allowed = post
        .map(|p| {
            p.replace(char::is_whitespace, "")
                .eq_ignore_ascii_case("List-Unsubscribe=One-Click")
        })
        .unwrap_or(false);

    let mut methods = UnsubscribeMethods::default();
    for uri in uris(list_unsubscribe) {
        let lower = uri.to_ascii_lowercase();
        if lower.starts_with("mailto:") {
            if methods.mailto.is_none() && parse_mailto(&uri).is_some() {
                methods.mailto = Some(uri);
            }
        } else if lower.starts_with("https://") || lower.starts_with("http://") {
            if url::Url::parse(&uri).is_err() {
                continue;
            }
            // RFC 8058 requires HTTPS for one-click.
            if one_click_allowed && lower.starts_with("https://") && methods.one_click.is_none() {
                methods.one_click = Some(uri.clone());
            }
            if methods.link.is_none() {
                methods.link = Some(uri);
            }
        }
    }
    methods
}

/// Extracts the URIs from a header value like `<mailto:a@b.c>, <https://x.y/z>`.
/// Some senders omit the angle brackets, so we fall back to splitting on commas.
fn uris(value: &str) -> Vec<String> {
    let value = value.replace(['\r', '\n'], "");
    let mut out = Vec::new();
    if value.contains('<') {
        let mut rest = value.as_str();
        while let Some(start) = rest.find('<') {
            let Some(len) = rest[start + 1..].find('>') else {
                break;
            };
            let uri = rest[start + 1..start + 1 + len].trim();
            if !uri.is_empty() {
                out.push(uri.replace(char::is_whitespace, ""));
            }
            rest = &rest[start + 1 + len + 1..];
        }
    } else {
        out.extend(
            value
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        );
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mailto {
    pub to: String,
    pub subject: Option<String>,
    pub body: Option<String>,
}

pub fn parse_mailto(uri: &str) -> Option<Mailto> {
    let rest = uri.get(7..)?; // strip "mailto:" (checked by caller, case-insensitive)
    if !uri[..7].eq_ignore_ascii_case("mailto:") {
        return None;
    }
    let (addr, query) = rest.split_once('?').unwrap_or((rest, ""));
    let decode = |s: &str| {
        percent_decode_str(&s.replace('+', "%2B"))
            .decode_utf8_lossy()
            .into_owned()
    };

    let mut to = decode(addr).trim().to_string();
    let mut subject = None;
    let mut body = None;
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k.to_ascii_lowercase().as_str() {
            "subject" => subject = Some(decode(v)),
            "body" => body = Some(decode(v)),
            "to" if to.is_empty() => to = decode(v),
            _ => {}
        }
    }
    // Only keep the first recipient; we never want to email more than one list address.
    let to = to.split(',').next().unwrap_or("").trim().to_string();
    let valid = to.contains('@')
        && !to.contains(char::is_whitespace)
        && to.parse::<lettre::Address>().is_ok();
    valid.then_some(Mailto { to, subject, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_one_click_and_mailto() {
        let m = parse(
            "<mailto:unsub@list.example.com?subject=unsubscribe>, <https://example.com/u/abc>",
            Some("List-Unsubscribe=One-Click"),
        );
        assert_eq!(m.one_click.as_deref(), Some("https://example.com/u/abc"));
        assert_eq!(m.link.as_deref(), Some("https://example.com/u/abc"));
        assert_eq!(
            m.mailto.as_deref(),
            Some("mailto:unsub@list.example.com?subject=unsubscribe")
        );
    }

    #[test]
    fn link_without_post_header_is_manual() {
        let m = parse("<https://example.com/u/abc>", None);
        assert!(m.one_click.is_none());
        assert!(m.link.is_some());
    }

    #[test]
    fn http_is_never_one_click() {
        let m = parse("<http://example.com/u>", Some("List-Unsubscribe=One-Click"));
        assert!(m.one_click.is_none());
        assert!(m.link.is_some());
    }

    #[test]
    fn handles_missing_brackets_and_folding() {
        let m = parse("mailto:leave@example.com,\r\n https://example.com/x", None);
        assert_eq!(m.mailto.as_deref(), Some("mailto:leave@example.com"));
        assert_eq!(m.link.as_deref(), Some("https://example.com/x"));
    }

    #[test]
    fn decodes_mailto() {
        let m = parse_mailto("mailto:a%2Bb@example.com?Subject=Remove%20me&body=bye").unwrap();
        assert_eq!(m.to, "a+b@example.com");
        assert_eq!(m.subject.as_deref(), Some("Remove me"));
        assert_eq!(m.body.as_deref(), Some("bye"));
        assert!(parse_mailto("mailto:not-an-address").is_none());
    }
}
