/**
 * Development-only demo backend: `npm run dev`, then open `/?demo` (an
 * account with a finished scan) or `/?demo=new` (first launch). It mocks the
 * Tauri IPC so the UI can be designed and checked in a plain browser. It is
 * never bundled in production builds.
 */
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { AccountView, HistoryEntry, Outcome, ScanResult, Sender } from "./api";

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sender(
  name: string,
  email: string,
  count: number,
  daysAgo: number,
  subject: string,
  method: "oneClick" | "email" | "link",
  kind: "newsletter" | "other" = "newsletter",
): Sender {
  const url = `https://${email.split("@")[1]}/unsubscribe`;
  return {
    key: email,
    name,
    email,
    count,
    firstSeen: now() - 360 * DAY,
    lastSeen: now() - daysAgo * DAY,
    lastSubject: subject,
    methods: {
      oneClick: method === "oneClick" ? url : null,
      mailto: method === "email" ? `mailto:leave@${email.split("@")[1]}` : null,
      link: method !== "email" ? url : null,
    },
    kind,
  };
}

const SENDERS: Sender[] = [
  sender("Libreria Fenice", "novita@libreriafenice.example", 104, 1, "Le uscite di novembre e tre incontri con gli autori", "oneClick"),
  sender("Mercato Verde", "offerte@mercatoverde.example", 87, 0, "Sconto del 20% sulla spesa del weekend", "oneClick"),
  sender("Viaggi Altrove", "newsletter@altrove.example", 52, 3, "Lisbona a 79 euro: ultimi posti per dicembre", "email"),
  sender("Palestra Moto", "info@palestramoto.example", 49, 2, "Nuovi orari dei corsi di pilates", "link"),
  sender("CodeLetter", "weekly@codeletter.example", 47, 4, "Rust 1.97, async closures e un'intervista", "oneClick"),
  sender("Cinema Odeon", "programma@odeon.example", 38, 6, "In sala questa settimana", "email"),
  sender("Arredo Casa Bianchi", "promo@arredobianchi.example", 31, 9, "Black Friday: fino al 40% sui divani", "oneClick"),
  sender("Il Giardiniere", "consigli@ilgiardiniere.example", 12, 21, "Cosa piantare a novembre", "link"),
  sender("Banca Orizzonte", "avvisi@bancaorizzonte.example", 23, 2, "Il tuo estratto conto di ottobre è disponibile", "oneClick", "other"),
  sender("Spedizioni Rapide", "tracking@spedizionirapide.example", 16, 5, "Il tuo pacco è stato consegnato", "link", "other"),
  sender("Gas e Luce Nord", "bollette@gasluce.example", 6, 12, "La tua bolletta di ottobre", "email", "other"),
];

export async function installDemo() {
  const fresh = new URLSearchParams(location.search).get("demo") === "new";
  const account: AccountView = {
    id: "mario.rossi@gmail.com",
    email: "mario.rossi@gmail.com",
    username: "mario.rossi@gmail.com",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecurity: "tls",
    unlocked: true,
  };
  let accounts: AccountView[] = fresh ? [] : [account];
  const scanResult = (): ScanResult => ({
    scannedAt: now() - 3600,
    months: 12,
    messagesScanned: 14_382,
    folders: ["[Gmail]/Tutti i messaggi"],
    senders: SENDERS,
  });
  let lastScan: ScanResult | null = fresh ? null : scanResult();
  const kept = new Set<string>(fresh ? [] : ["consigli@ilgiardiniere.example"]);
  const history = new Map<string, HistoryEntry>();

  mockIPC(
    async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "detect_provider": {
          const gmail = String(a.email).endsWith("@gmail.com");
          return {
            id: gmail ? "gmail" : "custom",
            name: gmail ? "Gmail" : "IMAP",
            known: gmail,
            servers: { imapHost: "imap.gmail.com", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecurity: "tls" },
            appPasswordUrl: gmail ? "https://myaccount.google.com/apppasswords" : null,
          };
        }
        case "list_accounts":
          return accounts;
        case "connect_account":
          await sleep(700);
          if (a.password === "wrong") throw "auth_failed: [AUTHENTICATIONFAILED] Invalid credentials";
          accounts = [{ ...account, email: String(a.email), id: String(a.email).toLowerCase() }];
          return { account: accounts[0], passwordSaved: true };
        case "remove_account":
          accounts = [];
          lastScan = null;
          return null;
        case "account_state":
          return { lastScan, kept: [...kept], history: [...history.values()] };
        case "scan_inbox": {
          const total = 14_382;
          for (let done = 0; done <= total; done += 1_500) {
            await emit("scan-progress", { done: Math.min(done, total), total, lists: Math.round((done / total) * SENDERS.length) });
            await sleep(120);
          }
          lastScan = scanResult();
          return lastScan;
        }
        case "set_kept":
          a.kept ? kept.add(String(a.key)) : kept.delete(String(a.key));
          return null;
        case "mark_unsubscribed":
          history.set(String(a.key), { sender: String(a.key), name: String(a.name), method: "link", at: now() });
          return null;
        case "forget_unsubscribed":
          history.delete(String(a.key));
          return null;
        case "unsubscribe": {
          const keys = a.keys as string[];
          const outcomes: Outcome[] = [];
          for (const [i, key] of keys.entries()) {
            const s = SENDERS.find((x) => x.key === key)!;
            const method = s.methods.oneClick ? "oneClick" : s.methods.mailto ? "email" : "link";
            const failed = key.startsWith("programma@");
            outcomes.push({
              key,
              name: s.name,
              status: failed ? "failed" : method === "link" ? "manual" : "done",
              method: failed ? null : method,
              url: method === "link" ? s.methods.link : null,
              error: failed ? "send_failed: 550 mailbox unavailable" : null,
              trashed: a.trash ? s.count : 0,
            });
            if (!failed && method !== "link") history.set(key, { sender: key, name: s.name, method, at: now() });
            await emit("unsub-progress", { phase: "unsubscribe", done: i + 1, total: keys.length });
            await sleep(90);
          }
          return outcomes;
        }
        case "plugin:opener|open_url":
          return null;
      }
      throw `unknown demo command ${cmd}`;
    },
    { shouldMockEvents: true },
  );
}
