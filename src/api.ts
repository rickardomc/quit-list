import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Security = "tls" | "starttls";

export interface ServerSettings {
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
}

export interface ProviderPreset {
  id: string;
  name: string;
  known: boolean;
  servers: ServerSettings;
  appPasswordUrl: string | null;
}

export interface Account extends ServerSettings {
  id: string;
  email: string;
  username: string;
}

export interface AccountView extends Account {
  unlocked: boolean;
}

export interface UnsubscribeMethods {
  oneClick: string | null;
  mailto: string | null;
  link: string | null;
}

export interface Sender {
  key: string;
  name: string;
  email: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  lastSubject: string;
  methods: UnsubscribeMethods;
}

export interface ScanResult {
  scannedAt: number;
  months: number;
  messagesScanned: number;
  senders: Sender[];
}

export type UnsubMethod = "oneClick" | "email" | "link";

export interface HistoryEntry {
  sender: string;
  name: string;
  method: UnsubMethod;
  at: number;
}

export interface AccountState {
  lastScan: ScanResult | null;
  kept: string[];
  history: HistoryEntry[];
}

export interface Outcome {
  key: string;
  name: string;
  status: "done" | "manual" | "failed";
  method: UnsubMethod | null;
  url: string | null;
  error: string | null;
  trashed: number;
}

export interface ScanProgress {
  done: number;
  total: number;
  lists: number;
}

export interface UnsubProgress {
  phase: "unsubscribe" | "trash";
  done: number;
  total: number;
}

export const api = {
  detectProvider: (email: string) => invoke<ProviderPreset>("detect_provider", { email }),
  listAccounts: () => invoke<AccountView[]>("list_accounts"),
  connectAccount: (email: string, username: string, password: string, servers: ServerSettings) =>
    invoke<{ account: Account; passwordSaved: boolean }>("connect_account", {
      email,
      username,
      password,
      servers,
    }),
  removeAccount: (id: string) => invoke<void>("remove_account", { id }),
  accountState: (id: string) => invoke<AccountState>("account_state", { id }),
  scanInbox: (id: string, months: number) => invoke<ScanResult>("scan_inbox", { id, months }),
  setKept: (id: string, key: string, kept: boolean) => invoke<void>("set_kept", { id, key, kept }),
  markUnsubscribed: (id: string, key: string, name: string) =>
    invoke<void>("mark_unsubscribed", { id, key, name }),
  forgetUnsubscribed: (id: string, key: string) => invoke<void>("forget_unsubscribed", { id, key }),
  unsubscribe: (id: string, keys: string[], trash: boolean) =>
    invoke<Outcome[]>("unsubscribe", { id, keys, trash }),
};

export const onScanProgress = (cb: (p: ScanProgress) => void): Promise<UnlistenFn> =>
  listen<ScanProgress>("scan-progress", (e) => cb(e.payload));

export const onUnsubProgress = (cb: (p: UnsubProgress) => void): Promise<UnlistenFn> =>
  listen<UnsubProgress>("unsub-progress", (e) => cb(e.payload));
