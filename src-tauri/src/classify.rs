//! Tells newsletters and marketing apart from transactional mail.
//!
//! Since the 2024 Gmail/Yahoo bulk-sender rules, many companies add
//! `List-Unsubscribe` to every email, including receipts, shipping updates
//! and security alerts. Each message gets a score: positive means
//! newsletter, negative means notification or transactional.

use mailparse::{MailHeader, MailHeaderMap};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    #[default]
    Newsletter,
    /// Receipts, orders, shipping, account and security notifications.
    Other,
}

/// Gmail's own inbox category, when the server is Gmail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GmailCategory {
    Promotions,
    Social,
    Updates,
}

/// Header fields the classifier reads, to be added to the IMAP FETCH.
pub const HEADERS: &str =
    "PRECEDENCE LIST-ID AUTO-SUBMITTED X-CAMPAIGN X-CAMPAIGNID X-MC-USER X-CSA-COMPLAINTS";

const MARKETING_HEADERS: &[&str] = &[
    "X-Campaign",
    "X-CampaignID",
    "X-MC-User",
    "X-CSA-Complaints",
];

/// Matched as whole words in the lowercased subject.
const TRANSACTIONAL_WORDS: &[&str] = &[
    "order",
    "ordine",
    "ordinato",
    "receipt",
    "ricevuta",
    "invoice",
    "fattura",
    "payment",
    "pagamento",
    "paid",
    "pagato",
    "refund",
    "rimborso",
    "shipped",
    "spedito",
    "spedizione",
    "shipping",
    "delivery",
    "delivered",
    "consegna",
    "consegnato",
    "tracking",
    "password",
    "verification",
    "verify",
    "verifica",
    "code",
    "codice",
    "otp",
    "pin",
    "security",
    "sicurezza",
    "login",
    "sign-in",
    "accesso",
    "booking",
    "prenotazione",
    "reservation",
    "ticket",
    "biglietto",
    "confirm",
    "confirmation",
    "conferma",
    "statement",
    "estratto",
    "bolletta",
    "bill",
    "appointment",
    "appuntamento",
    "reset",
    "transaction",
    "transazione",
    "bonifico",
    "addebito",
];

/// When present, the transactional words above are ignored ("codice sconto").
const MARKETING_WORDS: &[&str] = &[
    "newsletter",
    "sconto",
    "sconti",
    "discount",
    "offerta",
    "offerte",
    "offer",
    "offers",
    "sale",
    "saldi",
    "promo",
    "promozione",
    "coupon",
    "digest",
    "weekly",
    "settimanale",
    "novità",
    "black friday",
    "cyber monday",
    "%",
];

fn has_word(text: &str, word: &str) -> bool {
    if !word.chars().all(char::is_alphanumeric) {
        return text.contains(word);
    }
    text.split(|c: char| !c.is_alphanumeric())
        .any(|token| token == word)
}

fn subject_score(subject: &str) -> i32 {
    let subject = subject.to_lowercase();
    if MARKETING_WORDS.iter().any(|w| has_word(&subject, w)) {
        1
    } else if TRANSACTIONAL_WORDS.iter().any(|w| has_word(&subject, w)) {
        -2
    } else {
        0
    }
}

pub fn score(headers: &[MailHeader], subject: &str, gmail: Option<GmailCategory>) -> i32 {
    let mut score = subject_score(subject);

    score += match gmail {
        Some(GmailCategory::Promotions | GmailCategory::Social) => 3,
        Some(GmailCategory::Updates) => -1,
        None => 0,
    };

    let precedence = headers
        .get_first_value("Precedence")
        .unwrap_or_default()
        .to_lowercase();
    if precedence.contains("bulk") || precedence.contains("list") {
        score += 2;
    }
    if headers.get_first_header("List-Id").is_some() {
        score += 1;
    }
    if MARKETING_HEADERS
        .iter()
        .any(|h| headers.get_first_header(h).is_some())
    {
        score += 2;
    }
    let auto = headers
        .get_first_value("Auto-Submitted")
        .unwrap_or_default()
        .to_lowercase();
    if !auto.is_empty() && auto != "no" {
        score -= 3;
    }
    score
}

/// Combines the scores of all messages from one sender. Messages with no
/// signal either way lean newsletter, as do senders that write often.
pub fn kind(total_score: i32, count: u32) -> Kind {
    let volume_bonus = if count >= 4 { 1.0 } else { 0.0 };
    if f64::from(total_score) / f64::from(count.max(1)) + volume_bonus >= 0.0 {
        Kind::Newsletter
    } else {
        Kind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mailparse::parse_headers;

    fn s(raw: &str, gmail: Option<GmailCategory>) -> i32 {
        let (headers, _) = parse_headers(raw.as_bytes()).unwrap();
        let subject = headers.get_first_value("Subject").unwrap_or_default();
        score(&headers, &subject, gmail)
    }

    #[test]
    fn transactional_subjects_are_negative() {
        assert!(s("Subject: Il tuo ordine è stato spedito\r\n\r\n", None) < 0);
        assert!(s("Subject: Your receipt from Example\r\n\r\n", None) < 0);
        assert!(s("Subject: Codice di verifica: 123456\r\n\r\n", None) < 0);
    }

    #[test]
    fn marketing_wins_over_transactional_words() {
        assert!(s("Subject: Il tuo codice sconto del 20%\r\n\r\n", None) > 0);
    }

    #[test]
    fn words_match_whole_tokens_only() {
        // "border" contains "order", "codex" contains "code".
        assert_eq!(s("Subject: Across the border with Codex\r\n\r\n", None), 0);
    }

    #[test]
    fn headers_and_gmail_category() {
        assert!(
            s(
                "Subject: Hi\r\nPrecedence: bulk\r\nX-CSA-Complaints: x\r\n\r\n",
                None
            ) >= 4
        );
        assert!(
            s(
                "Subject: Aggiornamento\r\nAuto-Submitted: auto-generated\r\n\r\n",
                None
            ) < 0
        );
        assert!(
            s(
                "Subject: Your order\r\n\r\n",
                Some(GmailCategory::Promotions)
            ) > 0
        );
    }

    #[test]
    fn sender_kind() {
        assert_eq!(kind(0, 1), Kind::Newsletter);
        assert_eq!(kind(-2, 1), Kind::Other);
        assert_eq!(kind(-4, 5), Kind::Newsletter); // frequent sender, mostly neutral
        assert_eq!(kind(-10, 5), Kind::Other);
    }
}
