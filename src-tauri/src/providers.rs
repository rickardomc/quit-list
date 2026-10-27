//! Known IMAP/SMTP settings for common email providers, looked up by domain.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    /// Implicit TLS (IMAPS 993, SMTPS 465).
    Tls,
    /// Plain connection upgraded with STARTTLS (IMAP 143/1143, SMTP 587/1025).
    Starttls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: Security,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: Security,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPreset {
    /// Stable identifier the UI uses to show provider-specific help.
    pub id: &'static str,
    pub name: &'static str,
    pub known: bool,
    pub servers: ServerSettings,
    /// Where the user can create an app password, if the provider requires one.
    pub app_password_url: Option<&'static str>,
}

struct Preset {
    id: &'static str,
    name: &'static str,
    domains: &'static [&'static str],
    imap: (&'static str, u16, Security),
    smtp: (&'static str, u16, Security),
    app_password_url: Option<&'static str>,
}

use Security::{Starttls, Tls};

const PRESETS: &[Preset] = &[
    Preset {
        id: "gmail",
        name: "Gmail",
        domains: &["gmail.com", "googlemail.com"],
        imap: ("imap.gmail.com", 993, Tls),
        smtp: ("smtp.gmail.com", 465, Tls),
        app_password_url: Some("https://myaccount.google.com/apppasswords"),
    },
    Preset {
        id: "outlook",
        name: "Outlook / Hotmail",
        domains: &[
            "outlook.com",
            "outlook.it",
            "hotmail.com",
            "hotmail.it",
            "live.com",
            "live.it",
            "msn.com",
        ],
        imap: ("outlook.office365.com", 993, Tls),
        smtp: ("smtp-mail.outlook.com", 587, Starttls),
        app_password_url: Some("https://account.live.com/proofs/AppPassword"),
    },
    Preset {
        id: "yahoo",
        name: "Yahoo Mail",
        domains: &["yahoo.com", "yahoo.it", "ymail.com", "rocketmail.com"],
        imap: ("imap.mail.yahoo.com", 993, Tls),
        smtp: ("smtp.mail.yahoo.com", 465, Tls),
        app_password_url: Some("https://login.yahoo.com/account/security"),
    },
    Preset {
        id: "icloud",
        name: "iCloud Mail",
        domains: &["icloud.com", "me.com", "mac.com"],
        imap: ("imap.mail.me.com", 993, Tls),
        smtp: ("smtp.mail.me.com", 587, Starttls),
        app_password_url: Some("https://account.apple.com/account/manage"),
    },
    Preset {
        id: "proton",
        name: "Proton Mail (Bridge)",
        domains: &["proton.me", "protonmail.com", "protonmail.ch", "pm.me"],
        imap: ("127.0.0.1", 1143, Starttls),
        smtp: ("127.0.0.1", 1025, Starttls),
        app_password_url: None,
    },
    Preset {
        id: "libero",
        name: "Libero Mail",
        domains: &["libero.it", "iol.it", "inwind.it", "blu.it", "giallo.it"],
        imap: ("imapmail.libero.it", 993, Tls),
        smtp: ("smtp.libero.it", 465, Tls),
        app_password_url: None,
    },
    Preset {
        id: "virgilio",
        name: "Virgilio Mail",
        domains: &["virgilio.it"],
        imap: ("in.virgilio.it", 993, Tls),
        smtp: ("out.virgilio.it", 465, Tls),
        app_password_url: None,
    },
    Preset {
        id: "tim",
        name: "TIM Mail",
        domains: &["alice.it", "tim.it", "tin.it"],
        imap: ("in.alice.it", 993, Tls),
        smtp: ("out.alice.it", 465, Tls),
        app_password_url: None,
    },
    Preset {
        id: "tiscali",
        name: "Tiscali Mail",
        domains: &["tiscali.it"],
        imap: ("imap.tiscali.it", 993, Tls),
        smtp: ("smtp.tiscali.it", 465, Tls),
        app_password_url: None,
    },
    Preset {
        id: "fastmail",
        name: "Fastmail",
        domains: &["fastmail.com", "fastmail.fm"],
        imap: ("imap.fastmail.com", 993, Tls),
        smtp: ("smtp.fastmail.com", 465, Tls),
        app_password_url: Some("https://app.fastmail.com/settings/security/apps"),
    },
    Preset {
        id: "gmx",
        name: "GMX",
        domains: &["gmx.com", "gmx.net", "gmx.de", "gmx.it"],
        imap: ("imap.gmx.net", 993, Tls),
        smtp: ("mail.gmx.net", 465, Tls),
        app_password_url: None,
    },
    Preset {
        id: "zoho",
        name: "Zoho Mail",
        domains: &["zoho.com", "zohomail.com", "zohomail.eu"],
        imap: ("imap.zoho.com", 993, Tls),
        smtp: ("smtp.zoho.com", 465, Tls),
        app_password_url: Some("https://accounts.zoho.com/home#security/app_password"),
    },
    Preset {
        id: "yandex",
        name: "Yandex Mail",
        domains: &["yandex.com", "yandex.ru", "ya.ru"],
        imap: ("imap.yandex.com", 993, Tls),
        smtp: ("smtp.yandex.com", 465, Tls),
        app_password_url: Some("https://id.yandex.com/security/app-passwords"),
    },
    Preset {
        id: "mailbox",
        name: "mailbox.org",
        domains: &["mailbox.org"],
        imap: ("imap.mailbox.org", 993, Tls),
        smtp: ("smtp.mailbox.org", 465, Tls),
        app_password_url: None,
    },
    Preset {
        id: "posteo",
        name: "Posteo",
        domains: &["posteo.de", "posteo.net"],
        imap: ("posteo.de", 993, Tls),
        smtp: ("posteo.de", 465, Tls),
        app_password_url: None,
    },
];

pub fn detect(email: &str) -> ProviderPreset {
    let domain = email
        .rsplit_once('@')
        .map(|(_, d)| d.trim().to_lowercase())
        .unwrap_or_default();

    if let Some(p) = PRESETS
        .iter()
        .find(|p| p.domains.contains(&domain.as_str()))
    {
        return ProviderPreset {
            id: p.id,
            name: p.name,
            known: true,
            servers: ServerSettings {
                imap_host: p.imap.0.into(),
                imap_port: p.imap.1,
                imap_security: p.imap.2,
                smtp_host: p.smtp.0.into(),
                smtp_port: p.smtp.1,
                smtp_security: p.smtp.2,
            },
            app_password_url: p.app_password_url,
        };
    }

    // Unknown domain (often a custom domain): fall back to the most common convention.
    ProviderPreset {
        id: "custom",
        name: "IMAP",
        known: false,
        servers: ServerSettings {
            imap_host: format!("imap.{domain}"),
            imap_port: 993,
            imap_security: Tls,
            smtp_host: format!("smtp.{domain}"),
            smtp_port: 465,
            smtp_security: Tls,
        },
        app_password_url: None,
    }
}

/// Local bridges (e.g. Proton Mail Bridge) use self-signed certificates.
pub fn is_local_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_known_and_custom_domains() {
        let gmail = detect("Someone@GMail.com");
        assert_eq!(gmail.id, "gmail");
        assert_eq!(gmail.servers.imap_host, "imap.gmail.com");

        let custom = detect("me@example.org");
        assert!(!custom.known);
        assert_eq!(custom.servers.imap_host, "imap.example.org");
    }
}
