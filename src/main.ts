import { openUrl } from "@tauri-apps/plugin-opener";
import {
  api,
  onScanProgress,
  onUnsubProgress,
  type AccountView,
  type HistoryEntry,
  type Outcome,
  type ProviderPreset,
  type ScanResult,
  type Sender,
  type ServerSettings,
} from "./api";
import { DONATION_LINKS, REPO_URL } from "./config";
import { icons } from "./icons";
import { dateFmt, errorText, hintFor, lang, relative, setLang, t } from "./i18n";

// A sender still mailing this long after unsubscribing has ignored the request.
const GRACE_SECONDS = 3 * 86_400;
const MONTH_OPTIONS = [1, 3, 6, 12, 24, 60];

type Tab = "todo" | "other" | "kept" | "done";
type Sort = "count" | "recent" | "name";
type Method = "oneClick" | "email" | "link";
type MethodFilter = "all" | "noClick" | Method;

type Modal =
  | { kind: "confirm"; keys: string[] }
  | { kind: "working"; phase: "unsubscribe" | "trash"; done: number; total: number }
  | { kind: "results"; outcomes: Outcome[]; opened: Set<string> }
  | { kind: "password"; account: AccountView; error?: string; busy?: boolean }
  | { kind: "donate" };

const state = {
  accounts: [] as AccountView[],
  current: null as string | null,
  addingAccount: false,
  scan: null as ScanResult | null,
  kept: new Set<string>(),
  history: new Map<string, HistoryEntry>(),
  tab: "todo" as Tab,
  query: "",
  sort: "count" as Sort,
  method: "all" as MethodFilter,
  selected: new Set<string>(),
  trash: false,
  months: 12,
  scanning: null as null | { done: number; total: number; lists: number },
  scanError: null as string | null,
  modal: null as Modal | null,
};

const app = document.querySelector<HTMLDivElement>("#app")!;
const modalRoot = document.querySelector<HTMLDivElement>("#modal-root")!;

// ---------- helpers ----------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const account = () => state.accounts.find((a) => a.id === state.current) ?? null;

const methodOf = (s: Sender): Method => (s.methods.oneClick ? "oneClick" : s.methods.mailto ? "email" : "link");

function senderStatus(s: Sender) {
  const entry = state.history.get(s.key);
  const stillSending = !!entry && s.lastSeen > entry.at + GRACE_SECONDS;
  return { entry, stillSending, kept: state.kept.has(s.key) };
}

function tabOf(s: Sender): Tab {
  const { entry, stillSending, kept } = senderStatus(s);
  if (kept) return "kept";
  if (entry && !stillSending) return "done";
  return s.kind === "other" ? "other" : "todo";
}

/** Tabs whose senders can still be selected and unsubscribed. */
const isActionTab = (tab: Tab) => tab === "todo" || tab === "other";

function matchesMethod(s: Sender): boolean {
  const m = methodOf(s);
  if (state.method === "all") return true;
  if (state.method === "noClick") return m !== "link";
  return m === state.method;
}

const senders = () => state.scan?.senders ?? [];
/** Newsletters still to handle: what "Quit all" acts on. */
const todo = () => senders().filter((s) => tabOf(s) === "todo");
const actionable = () => senders().filter((s) => isActionTab(tabOf(s)));

function visibleSenders(): Sender[] {
  const q = state.query.trim().toLowerCase();
  const list = senders().filter(
    (s) =>
      tabOf(s) === state.tab &&
      matchesMethod(s) &&
      (!q || s.name.toLowerCase().includes(q) || s.email.includes(q) || s.lastSubject.toLowerCase().includes(q)),
  );
  const by: Record<Sort, (a: Sender, b: Sender) => number> = {
    count: (a, b) => b.count - a.count || b.lastSeen - a.lastSeen,
    recent: (a, b) => b.lastSeen - a.lastSeen,
    name: (a, b) => a.name.localeCompare(b.name, lang),
  };
  return list.sort(by[state.sort]);
}

function errorBox(err: unknown) {
  const { message, detail } = errorText(err);
  return `<div class="error">${esc(message)}${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
}

async function open(url: string) {
  try {
    await openUrl(url);
  } catch (e) {
    console.error(e);
  }
}

// ---------- data ----------

async function loadAccounts() {
  state.accounts = await api.listAccounts();
  if (!state.accounts.some((a) => a.id === state.current)) {
    state.current = state.accounts[0]?.id ?? null;
  }
}

async function loadAccountState() {
  state.selected.clear();
  state.scanError = null;
  if (!state.current) {
    state.scan = null;
    return;
  }
  const s = await api.accountState(state.current);
  state.scan = s.lastScan;
  state.kept = new Set(s.kept);
  state.history = new Map(s.history.map((h) => [h.sender, h]));
  if (s.lastScan) state.months = s.lastScan.months;
}

async function requireUnlocked(): Promise<boolean> {
  const acc = account();
  if (!acc) return false;
  if (acc.unlocked) return true;
  showModal({ kind: "password", account: acc });
  return false;
}

// ---------- connect view ----------

function renderConnect() {
  const hasAccounts = state.accounts.length > 0;
  app.innerHTML = `
    <main class="connect">
      <div class="connect-card">
        ${hasAccounts ? `<button class="link back" data-action="cancel-add">${t.back}</button>` : ""}
        <div class="brand big"><img src="/logo.svg" alt="" /><span>Quit List</span></div>
        <h1>${t.tagline}</h1>
        <p class="muted">${t.intro}</p>
        <form id="connect-form" autocomplete="off">
          <label>${t.email}
            <input name="email" type="email" required autofocus placeholder="nome@esempio.it" />
          </label>
          <div id="provider-hint" class="hint" hidden></div>
          <label><span id="password-label">${t.password}</span>
            <input name="password" type="password" required />
          </label>
          <details>
            <summary>${t.advanced}</summary>
            <label>${t.username}<input name="username" type="text" /></label>
            ${serverFields("imap", t.imapServer)}
            ${serverFields("smtp", t.smtpServer)}
          </details>
          <div id="connect-error"></div>
          <button class="primary wide" type="submit">${t.connect}</button>
          <p class="fineprint">🔒 ${t.privacy}</p>
        </form>
      </div>
      ${footer()}
    </main>`;

  const form = document.querySelector<HTMLFormElement>("#connect-form")!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  let preset: ProviderPreset | null = null;
  let timer: number | undefined;

  const applyPreset = (p: ProviderPreset) => {
    preset = p;
    const s = p.servers;
    field("imapHost").value = s.imapHost;
    field("imapPort").value = String(s.imapPort);
    field("imapSecurity").value = s.imapSecurity;
    field("smtpHost").value = s.smtpHost;
    field("smtpPort").value = String(s.smtpPort);
    field("smtpSecurity").value = s.smtpSecurity;
    const hint = document.querySelector<HTMLDivElement>("#provider-hint")!;
    const text = hintFor(p.id);
    hint.hidden = !text;
    hint.innerHTML = text
      ? `<strong>${esc(p.name)}</strong> — ${esc(text)}${
          p.appPasswordUrl ? ` <a href="#" data-open="${esc(p.appPasswordUrl)}">${t.createAppPassword}</a>` : ""
        }`
      : "";
    document.querySelector("#password-label")!.textContent = p.appPasswordUrl ? t.appPassword : t.password;
  };

  field("email").addEventListener("input", () => {
    clearTimeout(timer);
    const email = field("email").value.trim();
    if (!email.includes("@") || email.endsWith("@")) return;
    timer = window.setTimeout(async () => applyPreset(await api.detectProvider(email)), 250);
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = field("email").value.trim();
    if (!preset) applyPreset(await api.detectProvider(email));
    const servers: ServerSettings = {
      imapHost: field("imapHost").value.trim(),
      imapPort: Number(field("imapPort").value),
      imapSecurity: field("imapSecurity").value as ServerSettings["imapSecurity"],
      smtpHost: field("smtpHost").value.trim(),
      smtpPort: Number(field("smtpPort").value),
      smtpSecurity: field("smtpSecurity").value as ServerSettings["smtpSecurity"],
    };
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const errorEl = document.querySelector<HTMLDivElement>("#connect-error")!;
    button.disabled = true;
    button.textContent = t.connecting;
    errorEl.innerHTML = "";
    try {
      const res = await api.connectAccount(email, field("username").value, field("password").value, servers);
      await loadAccounts();
      state.current = res.account.id;
      state.addingAccount = false;
      await loadAccountState();
      render();
      if (!res.passwordSaved) toast(t.passwordNotSaved);
      if (!state.scan) void startScan();
    } catch (e) {
      errorEl.innerHTML = errorBox(e);
      button.disabled = false;
      button.textContent = t.connect;
    }
  });
}

function serverFields(prefix: "imap" | "smtp", label: string) {
  return `
    <fieldset class="server">
      <legend>${label}</legend>
      <input name="${prefix}Host" type="text" required />
      <input name="${prefix}Port" type="number" min="1" max="65535" required aria-label="${t.port}" />
      <select name="${prefix}Security" aria-label="${t.security}">
        <option value="tls">SSL/TLS</option>
        <option value="starttls">STARTTLS</option>
      </select>
    </fieldset>`;
}

// ---------- main view ----------

function footer() {
  return `
    <footer>
      <span>Quit List · GPL-3.0 · <a href="#" data-open="${REPO_URL}">${t.sourceCode}</a></span>
      <span class="lang">
        <button class="link ${lang === "it" ? "active" : ""}" data-action="lang" data-lang="it">IT</button> ·
        <button class="link ${lang === "en" ? "active" : ""}" data-action="lang" data-lang="en">EN</button>
      </span>
    </footer>`;
}

function renderMain() {
  const acc = account()!;
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><img src="/logo.svg" alt="" /><span>Quit List</span></div>
      <div class="topbar-right">
        <select id="account-select" aria-label="Account">
          ${state.accounts
            .map((a) => `<option value="${esc(a.id)}" ${a.id === acc.id ? "selected" : ""}>${esc(a.email)}</option>`)
            .join("")}
          <option value="__add">${t.addAccount}</option>
        </select>
        <button class="ghost" data-action="remove-account" title="${t.removeAccount}">⋯</button>
        <button class="donate" data-action="donate">♥ ${t.donate}</button>
      </div>
    </header>
    <main class="content">
      <section id="hero"></section>
      <section id="list-section"></section>
    </main>
    ${footer()}`;

  document.querySelector<HTMLSelectElement>("#account-select")!.addEventListener("change", async (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value === "__add") {
      state.addingAccount = true;
    } else {
      state.current = value;
      await loadAccountState();
    }
    render();
  });

  renderHero();
  renderList();
}

function renderHero() {
  const hero = document.querySelector<HTMLElement>("#hero");
  if (!hero) return;

  if (state.scanning) {
    const { done, total, lists } = state.scanning;
    const pct = total ? Math.round((done / total) * 100) : 0;
    hero.innerHTML = `
      <div class="card center">
        <h2>${t.scanning}</h2>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <p class="muted">${t.scanProgress(done, total, lists)}</p>
      </div>`;
    return;
  }

  const monthSelect = `
    <select id="months" aria-label="${t.scanPeriod}">
      ${MONTH_OPTIONS.map((m) => `<option value="${m}" ${m === state.months ? "selected" : ""}>${t.months(m)}</option>`).join("")}
    </select>`;

  if (!state.scan) {
    hero.innerHTML = `
      <div class="card center">
        <h2>${t.scanTitle}</h2>
        <p class="muted">${t.scanBody}</p>
        ${state.scanError ? errorBox(state.scanError) : ""}
        <div class="row center">${monthSelect}<button class="primary" data-action="scan">${t.scan}</button></div>
      </div>`;
  } else {
    const newsletters = senders().filter((s) => s.kind !== "other");
    const pending = todo();
    const auto = pending.filter((s) => methodOf(s) !== "link").length;
    const folders = state.scan.folders ?? [];
    hero.innerHTML = `
      <div class="card hero">
        <div class="stats">
          <div><strong>${newsletters.length}</strong><span>${t.statLists}</span></div>
          <div><strong>${state.scan.messagesScanned.toLocaleString()}</strong><span>${t.statEmails}</span></div>
          <div><strong>${auto}</strong><span>${t.statAuto}</span></div>
        </div>
        ${
          pending.length
            ? `<button class="primary huge" data-action="quit-all">${t.quitAll(pending.length)}</button>`
            : `<p class="success">${t.nothingLeft}</p>`
        }
        ${state.scanError ? errorBox(state.scanError) : ""}
        <div class="row small muted">
          <span>${t.lastScan(dateFmt(state.scan.scannedAt))}${
            folders.length ? ` · <span title="${esc(folders.join(", "))}">${t.scannedFolders(folders.length)}</span>` : ""
          }</span>
          ${monthSelect}
          <button class="link" data-action="scan">↻ ${t.rescan}</button>
        </div>
      </div>`;
  }
  document.querySelector<HTMLSelectElement>("#months")!.addEventListener("change", (e) => {
    state.months = Number((e.target as HTMLSelectElement).value);
  });
}

function renderList() {
  const section = document.querySelector<HTMLElement>("#list-section");
  if (!section) return;
  if (!state.scan || state.scanning) {
    section.innerHTML = "";
    return;
  }

  const counts: Record<Tab, number> = { todo: 0, other: 0, kept: 0, done: 0 };
  for (const s of senders()) counts[tabOf(s)]++;
  const rows = visibleSenders();
  const selectable = isActionTab(state.tab);
  const allSelected = selectable && rows.length > 0 && rows.every((s) => state.selected.has(s.key));

  // Only rebuild the toolbar once, so the search box keeps focus while typing.
  if (!section.querySelector("#toolbar")) {
    section.innerHTML = `
      <div id="toolbar">
        <nav class="tabs" id="tabs"></nav>
        <div class="filters">
          <input id="search" type="search" placeholder="${t.search}" value="${esc(state.query)}" />
          <select id="method" aria-label="${t.methodFilter}">
            <option value="all">${t.methodAll}</option>
            <option value="noClick">${t.methodNoClick}</option>
            <option value="oneClick">${t.methodOneClick}</option>
            <option value="email">${t.methodEmail}</option>
            <option value="link">${t.methodLink}</option>
          </select>
          <select id="sort">
            <option value="count">${t.sortCount}</option>
            <option value="recent">${t.sortRecent}</option>
            <option value="name">${t.sortName}</option>
          </select>
        </div>
      </div>
      <div id="rows"></div>
      <div id="actionbar"></div>`;
    const search = section.querySelector<HTMLInputElement>("#search")!;
    search.addEventListener("input", () => {
      state.query = search.value;
      renderList();
    });
    const method = section.querySelector<HTMLSelectElement>("#method")!;
    method.value = state.method;
    method.addEventListener("change", () => {
      state.method = method.value as MethodFilter;
      renderList();
    });
    const sort = section.querySelector<HTMLSelectElement>("#sort")!;
    sort.value = state.sort;
    sort.addEventListener("change", () => {
      state.sort = sort.value as Sort;
      renderList();
    });
  }

  section.querySelector("#tabs")!.innerHTML = (["todo", "other", "kept", "done"] as Tab[])
    .map(
      (tab) =>
        `<button class="tab ${state.tab === tab ? "active" : ""}" data-action="tab" data-tab="${tab}">
          ${{ todo: t.tabTodo, other: t.tabOther, kept: t.tabKept, done: t.tabDone }[tab]} <span class="count">${counts[tab]}</span>
        </button>`,
    )
    .join("");

  section.querySelector("#rows")!.innerHTML = `
    ${state.tab === "other" ? `<p class="muted small tab-hint">${t.otherHint}</p>` : ""}
    ${
      selectable && rows.length
        ? `<label class="select-all"><input type="checkbox" data-action="select-all" ${allSelected ? "checked" : ""}/> ${t.selectAll}</label>`
        : ""
    }
    <ul class="senders">
      ${rows.map(senderRow).join("") || `<li class="empty muted">${t.emptyFilter}</li>`}
    </ul>`;

  const n = actionable().filter((s) => state.selected.has(s.key)).length;
  section.querySelector("#actionbar")!.innerHTML =
    selectable && n
      ? `<div class="actionbar">
          <span>${t.selected(n)}</span>
          <label class="check"><input type="checkbox" data-action="toggle-trash" ${state.trash ? "checked" : ""}/> ${t.alsoTrash}</label>
          <button class="primary" data-action="unsubscribe-selected">${t.unsubscribe}</button>
        </div>`
      : "";
}

function methodBadge(s: Sender) {
  const m = methodOf(s);
  const [label, tip] = {
    oneClick: [t.methodOneClick, t.methodOneClickTip],
    email: [t.methodEmail, t.methodEmailTip],
    link: [t.methodLink, t.methodLinkTip],
  }[m];
  return `<span class="badge ${m}" title="${esc(tip)}">${label}</span>`;
}

function senderRow(s: Sender) {
  const { entry, stillSending, kept } = senderStatus(s);
  const initial = esc((s.name.trim()[0] ?? "?").toUpperCase());
  const key = esc(s.key);

  let actions = "";
  if (isActionTab(state.tab)) {
    actions = `${methodBadge(s)}<button class="ghost small" data-action="keep" data-key="${key}">☆ ${t.keep}</button>`;
  } else if (state.tab === "kept") {
    actions = `<button class="ghost small" data-action="unkeep" data-key="${key}">★ ${t.unkeep}</button>`;
  } else if (entry) {
    actions = `<span class="muted small">${t.unsubscribedOn(dateFmt(entry.at))}</span>
      <button class="ghost small" data-action="undo" data-key="${key}">${t.undo}</button>`;
  }

  return `
    <li class="sender ${state.selected.has(s.key) ? "selected" : ""}">
      ${isActionTab(state.tab) ? `<input type="checkbox" data-action="select" data-key="${key}" ${state.selected.has(s.key) ? "checked" : ""}/>` : ""}
      <div class="avatar" style="--h:${hue(s.email)}">${initial}</div>
      <div class="who">
        <div class="name">${esc(s.name)} ${stillSending ? `<span class="badge warn" title="${esc(t.stillSendingTip)}">${t.stillSending}</span>` : ""} ${kept ? "★" : ""}</div>
        <div class="meta">${esc(s.email)} · ${esc(s.lastSubject)}</div>
      </div>
      <div class="numbers">
        <strong>${t.emails(s.count)}</strong>
        <span class="muted small">${t.lastSeen} ${relative(s.lastSeen)}</span>
      </div>
      <div class="actions">${actions}</div>
    </li>`;
}

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// ---------- modals ----------

function showModal(m: Modal | null) {
  state.modal = m;
  renderModal();
}

function renderModal() {
  const m = state.modal;
  if (!m) {
    modalRoot.innerHTML = "";
    return;
  }
  let body = "";
  switch (m.kind) {
    case "confirm": {
      const chosen = senders().filter((s) => m.keys.includes(s.key));
      const manual = chosen.filter((s) => methodOf(s) === "link").length;
      body = `
        <h2>${t.confirmTitle(chosen.length)}</h2>
        <p>${t.confirmBody(chosen.length - manual, manual)}</p>
        <label class="check"><input type="checkbox" data-action="toggle-trash" ${state.trash ? "checked" : ""}/> ${t.alsoTrash}</label>
        <div class="row end">
          <button class="ghost" data-action="close-modal">${t.cancel}</button>
          <button class="primary" data-action="run-unsubscribe">${t.confirm}</button>
        </div>`;
      break;
    }
    case "working": {
      const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
      body = `
        <h2>${m.phase === "trash" ? t.workingTrash : t.working}</h2>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <p class="muted">${m.done} / ${m.total}</p>`;
      break;
    }
    case "results": {
      const done = m.outcomes.filter((o) => o.status === "done");
      const manual = m.outcomes.filter((o) => o.status === "manual");
      const failed = m.outcomes.filter((o) => o.status === "failed");
      const trashed = m.outcomes.reduce((n, o) => n + o.trashed, 0);
      const tile = (tone: string, icon: string, n: number, label: string) => `
        <div class="tile ${tone}">
          <span class="ico">${icon}</span>
          <strong>${n.toLocaleString()}</strong>
          <span>${label}</span>
        </div>`;
      const opener = (o: Outcome) => {
        const opened = m.opened.has(o.key);
        return `<li>
          <div class="avatar small" style="--h:${hue(o.key)}">${esc((o.name.trim()[0] ?? "?").toUpperCase())}</div>
          <span class="grow">${esc(o.name)}</span>
          <button class="${opened ? "ghost" : "primary"} small icon-btn" data-action="open-manual" data-key="${esc(o.key)}">
            ${opened ? `${icons.check} ${t.opened}` : `${t.open} ${icons.external}`}
          </button>
        </li>`;
      };
      body = `
        <div class="results-head">
          <span class="big-ico">${icons.check}</span>
          <h2>${t.resultsTitle}</h2>
        </div>
        <div class="result-grid">
          ${tile("ok", icons.check, done.length, t.resultsDone(done.length))}
          ${trashed ? tile("ok", icons.trash, trashed, t.resultsTrashed(trashed)) : ""}
          ${manual.length ? tile("warn", icons.external, manual.length, t.resultsManual(manual.length)) : ""}
          ${failed.length ? tile("err", icons.x, failed.length, t.resultsFailed(failed.length)) : ""}
        </div>
        ${
          manual.length
            ? `<h3>${t.resultsManualTitle}</h3>
               <p class="muted small">${t.resultsManualBody}</p>
               <ul class="manual-list">${manual.map(opener).join("")}</ul>
               ${manual.length > 1 ? `<button class="ghost small icon-btn" data-action="open-all-manual">${t.openAll} ${icons.external}</button>` : ""}`
            : ""
        }
        ${
          failed.length
            ? `<h3>${t.resultsFailedTitle}</h3>
               <ul class="failed-list">${failed
                 .map(
                   (o) => `<li><span class="mini-ico err">${icons.x}</span>
                     <span class="grow"><strong>${esc(o.name)}</strong><br /><span class="muted small">${esc(errorText(o.error).message)}</span></span></li>`,
                 )
                 .join("")}</ul>`
            : ""
        }
        <div class="row end"><button class="primary" data-action="close-modal">${t.close}</button></div>`;
      break;
    }
    case "password":
      body = `
        <h2>${t.passwordNeeded}</h2>
        <p class="muted">${t.passwordNeededBody(esc(m.account.email))}</p>
        <form id="password-form">
          <input name="password" type="password" required autofocus />
          ${m.error ? errorBox(m.error) : ""}
          <div class="row end">
            <button type="button" class="ghost" data-action="close-modal">${t.cancel}</button>
            <button class="primary" ${m.busy ? "disabled" : ""}>${m.busy ? t.connecting : t.connect}</button>
          </div>
        </form>`;
      break;
    case "donate":
      body = `
        <h2>♥ ${t.donate}</h2>
        <p>${t.donateLong}</p>
        <div class="donate-links">
          ${DONATION_LINKS.map((d) => `<button class="ghost" data-open="${esc(d.url)}">${esc(d.label)}</button>`).join("")}
        </div>
        <div class="row end"><button class="primary" data-action="close-modal">${t.close}</button></div>`;
      break;
  }
  const dismissable = m.kind !== "working";
  modalRoot.innerHTML = `<div class="overlay" ${dismissable ? 'data-action="overlay"' : ""}><div class="modal" role="dialog" aria-modal="true">${body}</div></div>`;

  if (m.kind === "password") {
    document.querySelector<HTMLFormElement>("#password-form")!.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const password = (ev.target as HTMLFormElement).querySelector<HTMLInputElement>("input")!.value;
      showModal({ ...m, busy: true, error: undefined });
      try {
        const a = m.account;
        await api.connectAccount(a.email, a.username, password, a);
        await loadAccounts();
        showModal(null);
        render();
      } catch (e) {
        showModal({ ...m, busy: false, error: String(e) });
      }
    });
  }
}

let toastTimer: number | undefined;
function toast(text: string) {
  let el = document.querySelector<HTMLDivElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.append(el);
  }
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.remove(), 6000);
}

// ---------- actions ----------

async function startScan() {
  const acc = account();
  if (!acc || state.scanning || !(await requireUnlocked())) return;
  state.scanning = { done: 0, total: 0, lists: 0 };
  state.scanError = null;
  renderHero();
  renderList();
  const unlisten = await onScanProgress((p) => {
    state.scanning = p;
    renderHero();
  });
  try {
    state.scan = await api.scanInbox(acc.id, state.months);
    state.selected.clear();
    state.tab = "todo";
  } catch (e) {
    state.scanError = String(e);
  } finally {
    unlisten();
    state.scanning = null;
    render();
  }
}

async function runUnsubscribe(keys: string[]) {
  const acc = account();
  if (!acc || !keys.length || !(await requireUnlocked())) return;
  showModal({ kind: "working", phase: "unsubscribe", done: 0, total: keys.length });
  const unlisten = await onUnsubProgress((p) => {
    if (state.modal?.kind === "working") showModal({ kind: "working", ...p });
  });
  try {
    const outcomes = await api.unsubscribe(acc.id, keys, state.trash);
    await loadAccountState();
    showModal({ kind: "results", outcomes, opened: new Set() });
  } catch (e) {
    showModal(null);
    state.scanError = String(e);
  } finally {
    unlisten();
    render();
  }
}

async function openManual(o: Outcome, opened: Set<string>) {
  if (!o.url || !state.current) return;
  await open(o.url);
  opened.add(o.key);
  await api.markUnsubscribed(state.current, o.key, o.name);
  state.history.set(o.key, { sender: o.key, name: o.name, method: "link", at: Math.floor(Date.now() / 1000) });
}

document.addEventListener("click", async (ev) => {
  const target = ev.target as HTMLElement;

  const opener = target.closest<HTMLElement>("[data-open]");
  if (opener) {
    ev.preventDefault();
    await open(opener.dataset.open!);
    return;
  }

  const el = target.closest<HTMLElement>("[data-action]");
  if (!el) return;
  const action = el.dataset.action!;
  const key = el.dataset.key ?? "";
  const id = state.current ?? "";

  switch (action) {
    case "overlay":
      if (target === el) showModal(null);
      break;
    case "close-modal":
      showModal(null);
      renderList();
      break;
    case "lang":
      setLang(el.dataset.lang as "it" | "en");
      render();
      break;
    case "cancel-add":
      state.addingAccount = false;
      render();
      break;
    case "donate":
      showModal({ kind: "donate" });
      break;
    case "remove-account": {
      const acc = account();
      if (acc && confirm(t.removeConfirm(acc.email))) {
        await api.removeAccount(acc.id);
        await loadAccounts();
        await loadAccountState();
        render();
      }
      break;
    }
    case "scan":
      void startScan();
      break;
    case "tab":
      state.tab = el.dataset.tab as Tab;
      renderList();
      break;
    case "select":
      (el as HTMLInputElement).checked ? state.selected.add(key) : state.selected.delete(key);
      renderList();
      break;
    case "select-all": {
      const rows = visibleSenders();
      if ((el as HTMLInputElement).checked) rows.forEach((s) => state.selected.add(s.key));
      else rows.forEach((s) => state.selected.delete(s.key));
      renderList();
      break;
    }
    case "toggle-trash":
      state.trash = (el as HTMLInputElement).checked;
      break;
    case "keep":
    case "unkeep":
      await api.setKept(id, key, action === "keep");
      action === "keep" ? state.kept.add(key) : state.kept.delete(key);
      state.selected.delete(key);
      renderHero();
      renderList();
      break;
    case "undo":
      await api.forgetUnsubscribed(id, key);
      state.history.delete(key);
      renderHero();
      renderList();
      break;
    case "quit-all":
      showModal({ kind: "confirm", keys: todo().map((s) => s.key) });
      break;
    case "unsubscribe-selected": {
      const keys = actionable()
        .map((s) => s.key)
        .filter((k) => state.selected.has(k));
      showModal({ kind: "confirm", keys });
      break;
    }
    case "run-unsubscribe":
      if (state.modal?.kind === "confirm") void runUnsubscribe(state.modal.keys);
      break;
    case "open-manual":
    case "open-all-manual": {
      const m = state.modal;
      if (m?.kind !== "results") break;
      const targets = m.outcomes.filter(
        (o) => o.status === "manual" && (action === "open-all-manual" ? !m.opened.has(o.key) : o.key === key),
      );
      for (const o of targets) await openManual(o, m.opened);
      renderModal();
      break;
    }
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && state.modal && state.modal.kind !== "working") showModal(null);
});

// ---------- boot ----------

function render() {
  if (!state.current || state.addingAccount) renderConnect();
  else renderMain();
  renderModal();
}

async function boot() {
  setLang(lang);
  await loadAccounts();
  await loadAccountState();
  render();
}

void boot();
