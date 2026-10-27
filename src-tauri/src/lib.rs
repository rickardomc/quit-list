mod listunsub;
mod mail;
mod providers;
mod scan;
mod store;
mod unsub;

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use providers::{ProviderPreset, ServerSettings};
use scan::{ScanProgress, ScanResult};
use store::{Account, HistoryEntry, Store, UnsubMethod};
use unsub::{Outcome, Status};

type AppStore = Arc<Store>;

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("internal: {e}"))?
}

fn password_for(store: &Store, id: &str) -> Result<String, String> {
    store
        .password(id)
        .ok_or_else(|| "password_required".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountView {
    #[serde(flatten)]
    account: Account,
    unlocked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectResult {
    account: Account,
    password_saved: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountState {
    last_scan: Option<ScanResult>,
    kept: Vec<String>,
    history: Vec<HistoryEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnsubProgress {
    phase: &'static str,
    done: usize,
    total: usize,
}

#[tauri::command]
fn detect_provider(email: String) -> ProviderPreset {
    providers::detect(&email)
}

#[tauri::command]
fn list_accounts(store: State<AppStore>) -> Vec<AccountView> {
    let accounts = store.data.lock().unwrap().accounts.clone();
    accounts
        .into_iter()
        .map(|account| AccountView {
            unlocked: store.password(&account.id).is_some(),
            account,
        })
        .collect()
}

/// Verifies the credentials with a real IMAP login, then saves the account.
#[tauri::command]
async fn connect_account(
    store: State<'_, AppStore>,
    email: String,
    username: String,
    password: String,
    servers: ServerSettings,
) -> Result<ConnectResult, String> {
    let email = email.trim().to_string();
    let username = if username.trim().is_empty() {
        email.clone()
    } else {
        username.trim().to_string()
    };
    let account = Account {
        id: email.to_lowercase(),
        email,
        username,
        servers,
    };

    let (acc, pw) = (account.clone(), password.clone());
    blocking(move || {
        let mut session = mail::imap_login(&acc, &pw)?;
        let _ = session.logout();
        Ok(())
    })
    .await?;

    let password_saved = store.set_password(&account.id, &password);
    {
        let mut data = store.data.lock().unwrap();
        data.accounts.retain(|a| a.id != account.id);
        data.accounts.push(account.clone());
    }
    store.save()?;
    Ok(ConnectResult {
        account,
        password_saved,
    })
}

#[tauri::command]
fn remove_account(store: State<AppStore>, id: String) -> Result<(), String> {
    {
        let mut data = store.data.lock().unwrap();
        data.accounts.retain(|a| a.id != id);
        data.kept.remove(&id);
        data.history.remove(&id);
        data.last_scan.remove(&id);
    }
    store.delete_password(&id);
    store.save()
}

#[tauri::command]
fn account_state(store: State<AppStore>, id: String) -> AccountState {
    let data = store.data.lock().unwrap();
    AccountState {
        last_scan: data.last_scan.get(&id).cloned(),
        kept: data
            .kept
            .get(&id)
            .map(|k| k.iter().cloned().collect())
            .unwrap_or_default(),
        history: data
            .history
            .get(&id)
            .map(|h| h.values().cloned().collect())
            .unwrap_or_default(),
    }
}

#[tauri::command]
async fn scan_inbox(
    app: AppHandle,
    store: State<'_, AppStore>,
    id: String,
    months: u32,
) -> Result<ScanResult, String> {
    let account = store.account(&id)?;
    let password = password_for(&store, &id)?;
    let months = months.clamp(1, 120);

    let result = blocking(move || {
        let mut session = mail::imap_login(&account, &password)?;
        let result = scan::scan(&mut session, months, |p: ScanProgress| {
            let _ = app.emit("scan-progress", p);
        });
        let _ = session.logout();
        result
    })
    .await?;

    store
        .data
        .lock()
        .unwrap()
        .last_scan
        .insert(id, result.clone());
    store.save()?;
    Ok(result)
}

#[tauri::command]
fn set_kept(store: State<AppStore>, id: String, key: String, kept: bool) -> Result<(), String> {
    {
        let mut data = store.data.lock().unwrap();
        let set = data.kept.entry(id).or_default();
        if kept {
            set.insert(key);
        } else {
            set.remove(&key);
        }
    }
    store.save()
}

fn record(store: &Store, id: &str, key: &str, name: &str, method: UnsubMethod) {
    store
        .data
        .lock()
        .unwrap()
        .history
        .entry(id.to_string())
        .or_default()
        .insert(
            key.to_string(),
            HistoryEntry {
                sender: key.to_string(),
                name: name.to_string(),
                method,
                at: chrono::Utc::now().timestamp(),
            },
        );
}

/// Called when the user opens a manual unsubscribe page.
#[tauri::command]
fn mark_unsubscribed(
    store: State<AppStore>,
    id: String,
    key: String,
    name: String,
) -> Result<(), String> {
    record(&store, &id, &key, &name, UnsubMethod::Link);
    store.save()
}

#[tauri::command]
fn forget_unsubscribed(store: State<AppStore>, id: String, key: String) -> Result<(), String> {
    if let Some(h) = store.data.lock().unwrap().history.get_mut(&id) {
        h.remove(&key);
    }
    store.save()
}

#[tauri::command]
async fn unsubscribe(
    app: AppHandle,
    store: State<'_, AppStore>,
    id: String,
    keys: Vec<String>,
    trash: bool,
) -> Result<Vec<Outcome>, String> {
    let account = store.account(&id)?;
    let password = password_for(&store, &id)?;
    let senders: Vec<scan::Sender> = {
        let data = store.data.lock().unwrap();
        let by_key: HashMap<&str, &scan::Sender> = data
            .last_scan
            .get(&id)
            .map(|s| s.senders.iter().map(|s| (s.key.as_str(), s)).collect())
            .unwrap_or_default();
        keys.iter()
            .filter_map(|k| by_key.get(k.as_str()).map(|s| (*s).clone()))
            .collect()
    };
    let total = senders.len();
    let progress = |phase: &'static str, done: usize| {
        let _ = app.emit("unsub-progress", UnsubProgress { phase, done, total });
    };

    // 1. One-click requests, in parallel.
    let mut clicked = 0;
    progress("unsubscribe", 0);
    let one_click = unsub::run_one_click(&senders, || {
        clicked += 1;
        progress("unsubscribe", clicked);
    })
    .await;

    // 2. Email fallbacks and (optionally) cleanup over IMAP; both are blocking.
    let app2 = app.clone();
    let outcomes = blocking(move || {
        let emit = |phase: &'static str, done: usize| {
            let _ = app2.emit("unsub-progress", UnsubProgress { phase, done, total });
        };
        let mut smtp = None;
        let connect_smtp = || mail::Smtp::new(&account, &password);
        let mut outcomes: Vec<Outcome> = senders
            .iter()
            .zip(one_click)
            .map(|(sender, result)| unsub::finish(sender, result, &mut smtp, &connect_smtp))
            .collect();
        emit("unsubscribe", total);

        if trash {
            emit("trash", 0);
            // Cleanup is best effort: a failure here must not hide the
            // unsubscribe results above, which have already happened.
            let cleanup = mail::imap_login(&account, &password).and_then(|mut session| {
                let folder = scan::find_trash(&mut session)?;
                for (i, outcome) in outcomes.iter_mut().enumerate() {
                    match scan::move_to_trash(&mut session, &folder, &outcome.key) {
                        Ok(n) => outcome.trashed = n,
                        Err(e) => {
                            outcome.error.get_or_insert(e);
                        }
                    }
                    emit("trash", i + 1);
                }
                let _ = session.logout();
                Ok(())
            });
            if let Err(e) = cleanup {
                for outcome in &mut outcomes {
                    outcome.error.get_or_insert_with(|| e.clone());
                }
            }
        }
        Ok(outcomes)
    })
    .await?;

    for o in &outcomes {
        if let (Status::Done, Some(method)) = (o.status, o.method) {
            record(&store, &id, &o.key, &o.name, method);
        }
    }
    store.save()?;
    Ok(outcomes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(Arc::new(Store::load(dir)) as AppStore);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_provider,
            list_accounts,
            connect_account,
            remove_account,
            account_state,
            scan_inbox,
            set_kept,
            mark_unsubscribed,
            forget_unsubscribed,
            unsubscribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quit List");
}
