const it = {
  tagline: "Esci da tutte le mailing list. In un click.",
  intro:
    "Quit List cerca nella tua casella newsletter e mailing list e ti disiscrive da tutte insieme. Gratis, open source, senza abbonamenti.",
  email: "Indirizzo email",
  password: "Password",
  appPassword: "Password per le app",
  connect: "Connetti",
  connecting: "Connessione in corso…",
  advanced: "Impostazioni avanzate",
  username: "Nome utente (se diverso dall'email)",
  imapServer: "Server IMAP",
  smtpServer: "Server SMTP",
  port: "Porta",
  security: "Sicurezza",
  privacy:
    "Tutto resta sul tuo computer: la password va nel portachiavi del sistema e l'app parla solo con il tuo provider email.",
  hint_gmail:
    "Gmail richiede una password per le app (serve la verifica in due passaggi attiva). Creala e incollala qui sotto.",
  hint_outlook:
    "Microsoft sta disattivando le password per le app sugli account personali Outlook/Hotmail: se l'accesso fallisce, il tuo account non è ancora supportato.",
  hint_yahoo: "Yahoo richiede una password per le app: generala dalla sicurezza dell'account.",
  hint_icloud: "iCloud richiede una password specifica per le app, creata dal tuo account Apple.",
  hint_proton:
    "Avvia Proton Mail Bridge e usa il nome utente e la password che ti mostra il Bridge (non quella di Proton).",
  hint_fastmail: "Fastmail richiede una password per le app con accesso IMAP e SMTP.",
  hint_zoho: "Se usi la verifica in due passaggi, Zoho richiede una password per le app.",
  hint_yandex: "Yandex richiede una password per le app con accesso alla posta.",
  hint_libero: "Usa la password normale di Libero Mail.",
  hint_virgilio: "Usa la password normale di Virgilio Mail.",
  hint_custom:
    "Non conosciamo questo provider: controlla i server nelle impostazioni avanzate se l'accesso fallisce.",
  createAppPassword: "Crea la password per le app →",

  scanTitle: "Scansiona la tua casella",
  scanBody: "Leggiamo solo le intestazioni delle email (mittente, oggetto, link di disiscrizione), mai il contenuto.",
  scanPeriod: "Periodo",
  months: (n: number) => (n === 1 ? "Ultimo mese" : n >= 12 && n % 12 === 0 ? (n === 12 ? "Ultimo anno" : `Ultimi ${n / 12} anni`) : `Ultimi ${n} mesi`),
  scan: "Scansiona",
  rescan: "Scansiona di nuovo",
  scanning: "Scansione in corso…",
  scanProgress: (done: number, total: number, lists: number) =>
    `${done.toLocaleString()} di ${total.toLocaleString()} email · ${lists} mailing list trovate`,

  statLists: "mailing list",
  statEmails: "email ricevute",
  statAuto: "automatiche",
  quitAll: (n: number) => `Esci da tutte (${n})`,
  nothingLeft: "Nessuna mailing list da gestire. Casella pulita! 🎉",
  tabTodo: "Da gestire",
  tabKept: "Tenute",
  tabDone: "Disiscritte",
  search: "Cerca mittente…",
  sortCount: "Più email",
  sortRecent: "Più recenti",
  sortName: "Nome",
  selectAll: "Seleziona tutte",
  selected: (n: number) => `${n} selezionate`,
  unsubscribe: "Disiscrivi",
  alsoTrash: "Sposta anche le loro email nel cestino",
  keep: "Tieni",
  kept: "Tenuta",
  unkeep: "Non tenere",
  emails: (n: number) => (n === 1 ? "1 email" : `${n} email`),
  lastSeen: "ultima",
  methodOneClick: "Automatica",
  methodEmail: "Via email",
  methodLink: "Sul sito",
  methodOneClickTip: "Disiscrizione immediata con un click (RFC 8058)",
  methodEmailTip: "Inviamo noi l'email di disiscrizione dal tuo account",
  methodLinkTip: "Il mittente richiede una conferma sul suo sito: lo apriamo per te",
  unsubscribedOn: (d: string) => `Disiscritta il ${d}`,
  stillSending: "Continua a scrivere",
  stillSendingTip: "Hai ricevuto email dopo la disiscrizione",
  retry: "Riprova",
  undo: "Annulla",
  emptyFilter: "Nessun risultato.",

  confirmTitle: (n: number) => (n === 1 ? "Uscire da 1 mailing list?" : `Uscire da ${n} mailing list?`),
  confirmBody: (auto: number, manual: number) =>
    (auto === 1 ? "1 verrà disiscritta automaticamente." : `${auto} verranno disiscritte automaticamente.`) +
    (manual > 0 ? ` Per ${manual} serve una conferma sul sito del mittente: ti mostreremo i link da aprire.` : ""),
  cancel: "Annulla",
  confirm: "Procedi",
  working: "Disiscrizione in corso…",
  workingTrash: "Sposto le email nel cestino…",

  resultsTitle: "Fatto!",
  resultsDone: (n: number) => (n === 1 ? "1 disiscrizione completata" : `${n} disiscrizioni completate`),
  resultsTrashed: (n: number) => `${n.toLocaleString()} email spostate nel cestino`,
  resultsManual: (n: number) => `Per ${n} serve un click sul sito del mittente`,
  resultsManualBody: "Apri ogni link e conferma la disiscrizione nella pagina del mittente.",
  resultsFailed: (n: number) => (n === 1 ? "1 non riuscita" : `${n} non riuscite`),
  open: "Apri",
  opened: "Aperto",
  openAll: "Apri tutti",
  close: "Chiudi",

  passwordNeeded: "Inserisci la password",
  passwordNeededBody: (email: string) =>
    `Il portachiavi di sistema non è disponibile, quindi la password di ${email} non è stata salvata.`,
  passwordNotSaved: "Portachiavi di sistema non disponibile: la password ti verrà chiesta al prossimo avvio.",
  addAccount: "+ Aggiungi account",
  removeAccount: "Rimuovi account",
  removeConfirm: (email: string) => `Rimuovere ${email} da Quit List? Verranno cancellati i dati locali di questo account.`,
  back: "← Indietro",

  donate: "Supporta il progetto",
  donateLong:
    "Quit List è gratis e open source, per sempre: niente abbonamenti, niente pubblicità, niente dati venduti. Se ti ha fatto risparmiare tempo, offri un caffè agli sviluppatori.",
  sourceCode: "Codice sorgente",
  lastScan: (d: string) => `Ultima scansione: ${d}`,

  err_auth_failed: "Accesso rifiutato: controlla email e password (molti provider richiedono una password per le app).",
  err_connect_failed: "Impossibile raggiungere il server. Controlla la connessione e le impostazioni del server.",
  err_tls_failed: "Connessione sicura non riuscita. Controlla porta e tipo di sicurezza.",
  err_scan_failed: "Errore durante la scansione della casella.",
  err_trash_failed: "Non è stato possibile spostare le email nel cestino.",
  err_send_failed: "Invio dell'email di disiscrizione non riuscito.",
  err_http_failed: "Il sito del mittente non ha accettato la richiesta.",
  err_no_method: "Nessun metodo di disiscrizione disponibile.",
  err_password_required: "Serve la password dell'account.",
  err_account_not_found: "Account non trovato.",
  err_invalid_address: "Indirizzo email non valido.",
  err_unknown: "Si è verificato un errore.",
};

type Dict = typeof it;

const en: Dict = {
  tagline: "Quit every mailing list. In one click.",
  intro:
    "Quit List finds the newsletters and mailing lists in your inbox and unsubscribes you from all of them at once. Free, open source, no subscriptions.",
  email: "Email address",
  password: "Password",
  appPassword: "App password",
  connect: "Connect",
  connecting: "Connecting…",
  advanced: "Advanced settings",
  username: "Username (if different from email)",
  imapServer: "IMAP server",
  smtpServer: "SMTP server",
  port: "Port",
  security: "Security",
  privacy:
    "Everything stays on your computer: your password goes into the system keychain and the app only talks to your email provider.",
  hint_gmail: "Gmail needs an app password (2-Step Verification must be on). Create one and paste it below.",
  hint_outlook:
    "Microsoft is phasing out app passwords for personal Outlook/Hotmail accounts: if sign-in fails, your account is not supported yet.",
  hint_yahoo: "Yahoo needs an app password: generate one from your account security page.",
  hint_icloud: "iCloud needs an app-specific password, created from your Apple Account.",
  hint_proton: "Start Proton Mail Bridge and use the username and password the Bridge shows you (not your Proton password).",
  hint_fastmail: "Fastmail needs an app password with IMAP and SMTP access.",
  hint_zoho: "If you use two-factor authentication, Zoho needs an app password.",
  hint_yandex: "Yandex needs an app password with mail access.",
  hint_libero: "Use your regular Libero Mail password.",
  hint_virgilio: "Use your regular Virgilio Mail password.",
  hint_custom: "We don't know this provider: check the servers in advanced settings if sign-in fails.",
  createAppPassword: "Create an app password →",

  scanTitle: "Scan your inbox",
  scanBody: "We only read email headers (sender, subject, unsubscribe links), never the content.",
  scanPeriod: "Period",
  months: (n: number) => (n === 1 ? "Last month" : n >= 12 && n % 12 === 0 ? (n === 12 ? "Last year" : `Last ${n / 12} years`) : `Last ${n} months`),
  scan: "Scan",
  rescan: "Scan again",
  scanning: "Scanning…",
  scanProgress: (done: number, total: number, lists: number) =>
    `${done.toLocaleString()} of ${total.toLocaleString()} emails · ${lists} mailing lists found`,

  statLists: "mailing lists",
  statEmails: "emails received",
  statAuto: "automatic",
  quitAll: (n: number) => `Quit all (${n})`,
  nothingLeft: "No mailing lists left to handle. Clean inbox! 🎉",
  tabTodo: "To do",
  tabKept: "Kept",
  tabDone: "Unsubscribed",
  search: "Search sender…",
  sortCount: "Most emails",
  sortRecent: "Most recent",
  sortName: "Name",
  selectAll: "Select all",
  selected: (n: number) => `${n} selected`,
  unsubscribe: "Unsubscribe",
  alsoTrash: "Also move their emails to the trash",
  keep: "Keep",
  kept: "Kept",
  unkeep: "Don't keep",
  emails: (n: number) => (n === 1 ? "1 email" : `${n} emails`),
  lastSeen: "last",
  methodOneClick: "Automatic",
  methodEmail: "Via email",
  methodLink: "On website",
  methodOneClickTip: "Instant one-click unsubscribe (RFC 8058)",
  methodEmailTip: "We send the unsubscribe email from your account",
  methodLinkTip: "The sender asks for confirmation on their website: we open it for you",
  unsubscribedOn: (d: string) => `Unsubscribed on ${d}`,
  stillSending: "Still sending",
  stillSendingTip: "You received emails after unsubscribing",
  retry: "Retry",
  undo: "Undo",
  emptyFilter: "No results.",

  confirmTitle: (n: number) => (n === 1 ? "Quit 1 mailing list?" : `Quit ${n} mailing lists?`),
  confirmBody: (auto: number, manual: number) =>
    `${auto} will be unsubscribed automatically.` +
    (manual > 0 ? ` ${manual} need${manual === 1 ? "s" : ""} a confirmation on the sender's website: we'll show you the links to open.` : ""),
  cancel: "Cancel",
  confirm: "Go",
  working: "Unsubscribing…",
  workingTrash: "Moving emails to the trash…",

  resultsTitle: "Done!",
  resultsDone: (n: number) => (n === 1 ? "1 unsubscribe completed" : `${n} unsubscribes completed`),
  resultsTrashed: (n: number) => `${n.toLocaleString()} emails moved to the trash`,
  resultsManual: (n: number) => `${n} need${n === 1 ? "s" : ""} a click on the sender's website`,
  resultsManualBody: "Open each link and confirm the unsubscribe on the sender's page.",
  resultsFailed: (n: number) => `${n} failed`,
  open: "Open",
  opened: "Opened",
  openAll: "Open all",
  close: "Close",

  passwordNeeded: "Enter your password",
  passwordNeededBody: (email: string) =>
    `The system keychain is not available, so the password for ${email} was not saved.`,
  passwordNotSaved: "System keychain not available: you'll be asked for the password next time.",
  addAccount: "+ Add account",
  removeAccount: "Remove account",
  removeConfirm: (email: string) => `Remove ${email} from Quit List? Local data for this account will be deleted.`,
  back: "← Back",

  donate: "Support the project",
  donateLong:
    "Quit List is free and open source, forever: no subscriptions, no ads, no data sold. If it saved you time, buy the developers a coffee.",
  sourceCode: "Source code",
  lastScan: (d: string) => `Last scan: ${d}`,

  err_auth_failed: "Sign-in refused: check email and password (many providers need an app password).",
  err_connect_failed: "Can't reach the server. Check your connection and server settings.",
  err_tls_failed: "Secure connection failed. Check port and security type.",
  err_scan_failed: "Error while scanning the inbox.",
  err_trash_failed: "Could not move emails to the trash.",
  err_send_failed: "Could not send the unsubscribe email.",
  err_http_failed: "The sender's website did not accept the request.",
  err_no_method: "No unsubscribe method available.",
  err_password_required: "The account password is needed.",
  err_account_not_found: "Account not found.",
  err_invalid_address: "Invalid email address.",
  err_unknown: "Something went wrong.",
};

const dicts = { it, en };
export type Lang = keyof typeof dicts;

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "it" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language.toLowerCase().startsWith("it") ? "it" : "en";
}

export let lang: Lang = initialLang();
export let t: Dict = dicts[lang];

export function setLang(next: Lang) {
  lang = next;
  t = dicts[next];
  document.documentElement.lang = next;
  try {
    localStorage.setItem("lang", next);
  } catch {
    /* storage unavailable */
  }
}

/** Backend errors look like `code: technical detail`. */
export function errorText(err: unknown): { message: string; detail: string } {
  const raw = String(err ?? "");
  const [code, ...rest] = raw.split(": ");
  const key = `err_${code}` as keyof Dict;
  const known = typeof t[key] === "string";
  return {
    message: known ? (t[key] as string) : t.err_unknown,
    detail: known ? rest.join(": ") : raw,
  };
}

export function hintFor(providerId: string): string | null {
  const key = `hint_${providerId}` as keyof Dict;
  return typeof t[key] === "string" ? (t[key] as string) : null;
}

export const dateFmt = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });

export function relative(ts: number): string {
  const days = Math.round((ts * 1000 - Date.now()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Math.abs(days) < 30) return rtf.format(days, "day");
  if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), "month");
  return rtf.format(Math.round(days / 365), "year");
}
