//! Local persistence. Everything stays on the user's computer: settings and
//! scan results go to a JSON file in the app data directory, passwords go to
//! the operating system keychain.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::providers::ServerSettings;
use crate::scan::ScanResult;

const KEYRING_SERVICE: &str = "quit-list";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// Lowercased email address; doubles as the account id.
    pub id: String,
    pub email: String,
    /// IMAP/SMTP login, usually the email address itself.
    pub username: String,
    #[serde(flatten)]
    pub servers: ServerSettings,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UnsubMethod {
    OneClick,
    Email,
    Link,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub sender: String,
    pub name: String,
    pub method: UnsubMethod,
    /// Unix timestamp (seconds).
    pub at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Data {
    pub accounts: Vec<Account>,
    /// Senders the user wants to keep receiving, per account.
    pub kept: BTreeMap<String, BTreeSet<String>>,
    /// Lists the user left, per account, keyed by sender address.
    pub history: BTreeMap<String, BTreeMap<String, HistoryEntry>>,
    pub last_scan: BTreeMap<String, ScanResult>,
}

pub struct Store {
    path: PathBuf,
    pub data: Mutex<Data>,
    /// Passwords for accounts whose keychain entry could not be written
    /// (e.g. no Secret Service on Linux). Lives only until the app quits.
    session_passwords: Mutex<HashMap<String, String>>,
}

impl Store {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("quit-list.json");
        let data = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            data: Mutex::new(data),
            session_passwords: Mutex::new(HashMap::new()),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let json = {
            let data = self.data.lock().unwrap();
            serde_json::to_vec(&*data).map_err(|e| e.to_string())?
        };
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // Write atomically so a crash never leaves a truncated file behind.
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }

    pub fn account(&self, id: &str) -> Result<Account, String> {
        self.data
            .lock()
            .unwrap()
            .accounts
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .ok_or_else(|| "account_not_found".to_string())
    }

    /// Stores the password, preferring the OS keychain. Returns whether it was
    /// persisted (false means it will be asked again after a restart).
    pub fn set_password(&self, id: &str, password: &str) -> bool {
        let saved = keyring::Entry::new(KEYRING_SERVICE, id)
            .and_then(|e| e.set_password(password))
            .is_ok();
        self.session_passwords
            .lock()
            .unwrap()
            .insert(id.to_string(), password.to_string());
        saved
    }

    pub fn password(&self, id: &str) -> Option<String> {
        if let Some(p) = self.session_passwords.lock().unwrap().get(id) {
            return Some(p.clone());
        }
        let p = keyring::Entry::new(KEYRING_SERVICE, id)
            .ok()?
            .get_password()
            .ok()?;
        self.session_passwords
            .lock()
            .unwrap()
            .insert(id.to_string(), p.clone());
        Some(p)
    }

    pub fn delete_password(&self, id: &str) {
        self.session_passwords.lock().unwrap().remove(id);
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, id) {
            let _ = entry.delete_credential();
        }
    }
}
