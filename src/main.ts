import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
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
  | { kind: "remove-account" }
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
  working: null as null | { phase: "unsubscribe" | "trash"; done: number; total: number },
  report: null as null | { outcomes: Outcome[]; opened: Set<string>; perMonth: number },
  error: null as string | null,
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

/** Emails a month these senders send, from the scanned period. */
function perMonth(list: Sender[]): number {
  const months = state.scan?.months || 1;
  return Math.round(list.reduce((n, s) => n + s.count, 0) / months);
}

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

const initial = (name: string) => esc((name.trim()[0] ?? "?").toUpperCase());

function errorBox(err: unknown) {
  const { message, detail } = errorText(err);
  return `<div class="error" role="alert">${icons.warning}<div>${esc(message)}${detail ? `<small>${esc(detail)}</small>` : ""}</div></div>`;
}

const progressBar = (done: number, total: number) =>
  `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><div style="--p:${
    total ? done / total : 0
  }"></div></div>`;

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
  state.error = null;
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

// ---------- shared chrome ----------

function footer() {
  return `
    <footer class="site">
      <div class="container">
        <div class="meta">
          <span>Quit List</span>
          <span>${t.license}</span>
          <a href="#" class="link" data-open="${REPO_URL}">${t.sourceCode}</a>
        </div>
        <div class="lang" role="group" aria-label="Lingua / Language">
          <button type="button" data-action="lang" data-lang="it" aria-pressed="${lang === "it"}">Italiano</button>
          <button type="button" data-action="lang" data-lang="en" aria-pressed="${lang === "en"}">English</button>
        </div>
      </div>
    </footer>`;
}

// ---------- connect view ----------

function renderConnect() {
  const hasAccounts = state.accounts.length > 0;
  app.innerHTML = `
    <main class="container connect">
      <section class="intro">
        <div class="wordmark"><img src="/logo.svg" alt="" width="28" height="28" /><span>Quit List</span></div>
        <h1>${t.tagline}</h1>
        <p>${t.intro}</p>
        <ul class="facts">
          <li>${icons.newspaper}${t.factHeaders}</li>
          <li>${icons.lock}${t.factLocal}</li>
          <li>${icons.heart}${t.factFree}</li>
        </ul>
      </section>
      <form id="connect-form" class="connect-card" autocomplete="off" novalidate>
        ${hasAccounts ? `<button type="button" class="btn quiet small back" data-action="cancel-add">${icons.back}${t.back}</button>` : ""}
        <h2>${t.connectTitle}</h2>
        <label class="field">${t.email}
          <input name="email" type="email" inputmode="email" autocomplete="email" required autofocus placeholder="nome@esempio.it" />
        </label>
        <div id="provider-hint" class="hint" hidden></div>
        <label class="field"><span id="password-label">${t.password}</span>
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <details>
          <summary>${t.advanced}</summary>
          <label class="field">${t.username}<input name="username" type="text" autocomplete="username" /></label>
          ${serverFields("imap", t.imapServer)}
          ${serverFields("smtp", t.smtpServer)}
        </details>
        <div id="connect-error"></div>
        <button class="btn primary large wide" type="submit">${t.connect}</button>
        <p class="fineprint">${icons.shield}<span>${t.privacy}</span></p>
      </form>
    </main>
    ${footer()}`;

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
      ? `<span><strong>${esc(p.name)}.</strong> ${esc(text)}</span>${
          p.appPasswordUrl
            ? `<a href="#" class="link" data-open="${esc(p.appPasswordUrl)}">${t.createAppPassword}${icons.external}</a>`
            : ""
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
    const errorEl = document.querySelector<HTMLDivElement>("#connect-error")!;
    const email = field("email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.innerHTML = errorBox("invalid_address");
      field("email").focus();
      return;
    }
    if (!field("password").value) {
      field("password").focus();
      return;
    }
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
    button.disabled = true;
    button.textContent = t.connecting;
    errorEl.innerHTML = "";
    try {
      const res = await api.connectAccount(email, field("username").value, field("password").value, servers);
      await loadAccounts();
      state.current = res.account.id;
      state.addingAccount = false;
      state.report = null;
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
      <input name="${prefix}Host" type="text" required aria-label="${label}" />
      <input name="${prefix}Port" type="number" min="1" max="65535" required aria-label="${t.port}" />
      <select name="${prefix}Security" aria-label="${t.security}">
        <option value="tls">SSL/TLS</option>
        <option value="starttls">STARTTLS</option>
      </select>
    </fieldset>`;
}

// ---------- main view ----------

function renderMain() {
  const acc = account()!;
  app.innerHTML = `
    <header class="topbar">
      <div class="container">
        <div class="wordmark"><img src="/logo.svg" alt="" width="28" height="28" /><span>Quit List</span></div>
        <div class="topbar-actions">
          <select id="account-select" aria-label="Account">
            ${state.accounts
              .map((a) => `<option value="${esc(a.id)}" ${a.id === acc.id ? "selected" : ""}>${esc(a.email)}</option>`)
              .join("")}
            <option value="__add">${t.addAccount}</option>
          </select>
          <button type="button" class="btn icon-only" data-action="remove-account" aria-label="${t.removeAccount}" title="${t.removeAccount}">${icons.userMinus}</button>
          <button type="button" class="btn" data-action="donate">${icons.heart.replace('class="icon"', 'class="icon heart"')}${t.donate}</button>
        </div>
      </div>
    </header>
    <main class="content container">
      <section id="summary" aria-live="polite"></section>
      <section id="report"></section>
      <section id="list-section"></section>
    </main>
    ${footer()}`;

  document.querySelector<HTMLSelectElement>("#account-select")!.addEventListener("change", async (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value === "__add") {
      state.addingAccount = true;
    } else {
      state.current = value;
      state.report = null;
      await loadAccountState();
    }
    render();
  });

  renderSummary();
  renderReport();
  renderList();
}

function monthSelect() {
  return `
    <select id="months" aria-label="${t.scanPeriod}">
      ${MONTH_OPTIONS.map((m) => `<option value="${m}" ${m === state.months ? "selected" : ""}>${t.months(m)}</option>`).join("")}
    </select>`;
}

function renderSummary() {
  const el = document.querySelector<HTMLElement>("#summary");
  if (!el) return;

  if (state.scanning) {
    const { done, total, lists } = state.scanning;
    el.innerHTML = `
      <div class="summary">
        <h1>${t.scanning}</h1>
        ${progressBar(done, total)}
        <p class="meta">${t.scanProgress(done, total, lists)}</p>
      </div>`;
    return;
  }

  if (state.working) {
    const { phase, done, total } = state.working;
    el.innerHTML = `
      <div class="summary">
        <h1>${phase === "trash" ? t.workingTrash : t.working}</h1>
        ${progressBar(done, total)}
        <p class="meta">${done} / ${total}</p>
      </div>`;
    return;
  }

  if (!state.scan) {
    el.innerHTML = `
      <div class="empty-state">
        <h1>${t.scanTitle}</h1>
        <p class="muted">${t.scanBody}</p>
        ${state.error ? errorBox(state.error) : ""}
        <div class="row">${monthSelect()}<button type="button" class="btn primary large" data-action="scan">${t.scan}</button></div>
      </div>`;
  } else {
    const pending = todo();
    const scan = state.scan;
    el.innerHTML = `
      <div class="summary">
        <h1>${pending.length ? t.summaryLine(pending.length, perMonth(pending)) : t.nothingLeft}</h1>
        <p class="meta">
          <span>${t.summaryMeta(scan.messagesScanned, scan.folders?.length || 1, t.months(scan.months))}</span>
          <span>${t.lastScan(dateFmt(scan.scannedAt))}</span>
        </p>
        ${state.error ? errorBox(state.error) : ""}
        <div class="actions">
          ${pending.length ? `<button type="button" class="btn primary large" data-action="quit-all">${t.quitAll(pending.length)}</button>` : ""}
          <span class="period">
            ${monthSelect()}
            <button type="button" class="btn" data-action="scan">${icons.refresh}${t.rescan}</button>
          </span>
        </div>
      </div>`;
  }
  document.querySelector<HTMLSelectElement>("#months")!.addEventListener("change", (e) => {
    state.months = Number((e.target as HTMLSelectElement).value);
  });
}

function renderReport() {
  const el = document.querySelector<HTMLElement>("#report");
  if (!el) return;
  const r = state.report;
  if (!r || state.working) {
    el.innerHTML = "";
    return;
  }
  const done = r.outcomes.filter((o) => o.status === "done");
  const manual = r.outcomes.filter((o) => o.status === "manual");
  const failed = r.outcomes.filter((o) => o.status === "failed");
  const trashed = r.outcomes.reduce((n, o) => n + o.trashed, 0);
  const outcome = (cls: string, icon: string, n: number, label: string) => `
    <li class="outcome ${cls}">
      <span class="ring">${icon}</span>
      <div><strong>${n.toLocaleString(lang)}</strong><span>${label}</span></div>
    </li>`;

  el.innerHTML = `
    <div class="report">
      <div class="report-head">
        <div>
          <h2>${t.reportTitle}</h2>
          <p>${t.reportSaved(r.perMonth)}</p>
        </div>
        <button type="button" class="btn quiet icon-only" data-action="close-report" aria-label="${t.close}" title="${t.close}">${icons.x}</button>
      </div>
      <ul class="outcomes">
        ${outcome("", icons.check, done.length, t.resultsDone(done.length))}
        ${trashed ? outcome("", icons.trash, trashed, t.resultsTrashed(trashed)) : ""}
        ${manual.length ? outcome("pending", icons.external, manual.length, t.resultsManual(manual.length)) : ""}
        ${failed.length ? outcome("failed", icons.x, failed.length, t.resultsFailed(failed.length)) : ""}
      </ul>
      ${
        manual.length
          ? `<div class="section">
              <h3>${t.resultsManualTitle}</h3>
              <p class="muted small">${t.resultsManualBody}</p>
              <ul class="plain-list">
                ${manual
                  .map((o) => {
                    const opened = r.opened.has(o.key);
                    return `<li>
                      <span class="avatar">${initial(o.name)}</span>
                      <span class="grow"><strong>${esc(o.name)}</strong><span class="muted small">${esc(o.key)}</span></span>
                      ${
                        opened
                          ? `<span class="stamp link">${t.opened}</span>`
                          : `<button type="button" class="btn primary small" data-action="open-manual" data-key="${esc(o.key)}">${t.open}${icons.external}</button>`
                      }
                    </li>`;
                  })
                  .join("")}
              </ul>
              ${manual.length > 1 ? `<div><button type="button" class="btn small" data-action="open-all-manual">${t.openAll}${icons.external}</button></div>` : ""}
            </div>`
          : ""
      }
      ${
        failed.length
          ? `<div class="section">
              <h3>${t.resultsFailedTitle}</h3>
              <ul class="plain-list">
                ${failed
                  .map(
                    (o) => `<li>
                      <span class="avatar">${initial(o.name)}</span>
                      <span class="grow"><strong>${esc(o.name)}</strong><span class="muted small">${esc(errorText(o.error).message)}</span></span>
                    </li>`,
                  )
                  .join("")}
              </ul>
            </div>`
          : ""
      }
    </div>`;
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
        <div class="tabs" id="tabs" role="tablist"></div>
        <div class="filters">
          <label class="search">${icons.search}
            <input id="search" type="search" placeholder="${t.search}" aria-label="${t.search}" value="${esc(state.query)}" />
          </label>
          <select id="method" aria-label="${t.methodFilter}">
            <option value="all">${t.methodAll}</option>
            <option value="noClick">${t.methodNoClick}</option>
            <option value="oneClick">${t.methodOneClick}</option>
            <option value="email">${t.methodEmail}</option>
            <option value="link">${t.methodLink}</option>
          </select>
          <select id="sort" aria-label="${t.sortCount}">
            <option value="count">${t.sortCount}</option>
            <option value="recent">${t.sortRecent}</option>
            <option value="name">${t.sortName}</option>
          </select>
        </div>
      </div>
      <div id="rows" role="tabpanel"></div>
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
        `<button type="button" class="tab" role="tab" aria-selected="${state.tab === tab}" data-action="tab" data-tab="${tab}">
          ${{ todo: t.tabTodo, other: t.tabOther, kept: t.tabKept, done: t.tabDone }[tab]}<span class="count">${counts[tab]}</span>
        </button>`,
    )
    .join("");

  section.querySelector("#rows")!.innerHTML = `
    ${state.tab === "other" ? `<p class="tab-hint">${t.otherHint}</p>` : ""}
    <div class="senders ${selectable ? "" : "no-select"}" role="table">
      <div class="head" role="row">
        ${
          selectable
            ? `<span class="select-head" role="columnheader"><input type="checkbox" data-action="select-all" aria-label="${t.selectAll}" ${allSelected ? "checked" : ""} ${rows.length ? "" : "disabled"}/></span>`
            : ""
        }
        <span role="columnheader">${t.colSender}</span>
        <span role="columnheader" class="col-subject">${t.colSubject}</span>
        <span role="columnheader" class="num col-num">${t.colEmails}</span>
        <span role="columnheader" class="col-when">${t.colLast}</span>
        <span role="columnheader" class="col-method">${t.colMethod}</span>
        <span role="columnheader"><span class="visually-hidden">${t.keep}</span></span>
      </div>
      ${rows.map(senderRow).join("") || `<p class="empty-row">${t.emptyFilter}</p>`}
    </div>`;

  const n = actionable().filter((s) => state.selected.has(s.key)).length;
  section.querySelector("#actionbar")!.innerHTML =
    selectable && n
      ? `<div class="actionbar" role="region" aria-label="${t.selected(n)}">
          <strong>${t.selected(n)}</strong>
          <label class="check"><input type="checkbox" data-action="toggle-trash" ${state.trash ? "checked" : ""}/> ${t.alsoTrash}</label>
          <button type="button" class="btn primary" data-action="unsubscribe-selected">${t.unsubscribe}</button>
        </div>`
      : "";
}

function methodTag(s: Sender) {
  const m = methodOf(s);
  const [label, tip, icon] = {
    oneClick: [t.methodOneClick, t.methodOneClickTip, icons.oneClick],
    email: [t.methodEmail, t.methodEmailTip, icons.email],
    link: [t.methodLink, t.methodLinkTip, icons.link],
  }[m];
  return `<span class="tag ${m === "link" ? "manual" : ""}" title="${esc(tip)}">${icon}${label}</span>`;
}

function senderRow(s: Sender) {
  const { entry, stillSending, kept } = senderStatus(s);
  const key = esc(s.key);
  const selected = state.selected.has(s.key);

  let method = methodTag(s);
  let action = "";
  if (isActionTab(state.tab)) {
    action = `<button type="button" class="btn quiet small" data-action="keep" data-key="${key}">${icons.star}${t.keep}</button>`;
  } else if (state.tab === "kept") {
    action = `<button type="button" class="btn quiet small" data-action="unkeep" data-key="${key}">${icons.starFill}${t.unkeep}</button>`;
  } else if (entry) {
    method = `<span class="stamp ${entry.method === "link" ? "link" : ""}" title="${esc(t.unsubscribedOn(dateFmt(entry.at)))}">${t.stampDone}<span>${dateFmt(entry.at)}</span></span>`;
    action = `<button type="button" class="btn quiet small" data-action="undo" data-key="${key}">${t.undo}</button>`;
  }

  return `
    <div class="sender ${selected ? "selected" : ""}" role="row">
      ${isActionTab(state.tab) ? `<span role="cell"><input type="checkbox" data-action="select" data-key="${key}" aria-label="${esc(s.name)}" ${selected ? "checked" : ""}/></span>` : ""}
      <div class="who" role="cell">
        <span class="avatar">${initial(s.name)}</span>
        <div class="text">
          <div class="name"><span>${esc(s.name)}</span>${kept ? `<span class="kept-mark" title="${t.tabKept}">${icons.starFill}</span>` : ""}${
            stillSending ? `<span class="tag warn" title="${esc(t.stillSendingTip)}">${icons.warning}${t.stillSending}</span>` : ""
          }</div>
          <div class="email">${esc(s.email)}</div>
        </div>
      </div>
      <span class="subject col-subject" role="cell" title="${esc(s.lastSubject)}">${esc(s.lastSubject)}</span>
      <span class="num col-num" role="cell">${s.count.toLocaleString(lang)}</span>
      <span class="when col-when" role="cell">${relative(s.lastSeen)}</span>
      <span class="col-method" role="cell">${method}</span>
      <span class="act" role="cell">${action}</span>
    </div>`;
}

// ---------- dialogs ----------

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
        <h2 id="dialog-title">${t.confirmTitle(chosen.length)}</h2>
        <p>${t.confirmBody(chosen.length - manual, manual)}</p>
        <label class="check"><input type="checkbox" data-action="toggle-trash" ${state.trash ? "checked" : ""}/> ${t.alsoTrash}</label>
        <div class="row end">
          <button type="button" class="btn" data-action="close-modal">${t.cancel}</button>
          <button type="button" class="btn primary" data-action="run-unsubscribe" autofocus>${t.confirm}</button>
        </div>`;
      break;
    }
    case "remove-account": {
      const acc = account();
      body = `
        <h2 id="dialog-title">${t.removeTitle}</h2>
        <p>${acc ? esc(t.removeConfirm(acc.email)) : ""}</p>
        <div class="row end">
          <button type="button" class="btn" data-action="close-modal" autofocus>${t.cancel}</button>
          <button type="button" class="btn primary" data-action="confirm-remove">${t.remove}</button>
        </div>`;
      break;
    }
    case "password":
      body = `
        <h2 id="dialog-title">${t.passwordNeeded}</h2>
        <p>${t.passwordNeededBody(esc(m.account.email))}</p>
        <form id="password-form" class="field">
          <input name="password" type="password" autocomplete="current-password" aria-label="${t.password}" required autofocus />
          ${m.error ? errorBox(m.error) : ""}
          <div class="row end">
            <button type="button" class="btn" data-action="close-modal">${t.cancel}</button>
            <button type="submit" class="btn primary" ${m.busy ? "disabled" : ""}>${m.busy ? t.connecting : t.connect}</button>
          </div>
        </form>`;
      break;
    case "donate":
      body = `
        <h2 id="dialog-title">${t.donate}</h2>
        <p>${t.donateLong}</p>
        <div class="donate-links">
          ${DONATION_LINKS.map((d) => `<button type="button" class="btn primary" data-open="${esc(d.url)}">${icons.heart}${esc(d.label)}${icons.external}</button>`).join("")}
        </div>
        <div class="row end"><button type="button" class="btn" data-action="close-modal">${t.close}</button></div>`;
      break;
  }
  modalRoot.innerHTML = `<div class="overlay" data-action="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">${body}</div></div>`;
  modalRoot.querySelector<HTMLElement>("[autofocus]")?.focus();

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
    el.setAttribute("role", "status");
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
  state.error = null;
  state.report = null;
  renderSummary();
  renderReport();
  renderList();
  const unlisten = await onScanProgress((p) => {
    state.scanning = p;
    renderSummary();
  });
  try {
    state.scan = await api.scanInbox(acc.id, state.months);
    state.selected.clear();
    state.tab = "todo";
  } catch (e) {
    state.error = String(e);
  } finally {
    unlisten();
    state.scanning = null;
    render();
  }
}

async function runUnsubscribe(keys: string[]) {
  const acc = account();
  if (!acc || !keys.length || !(await requireUnlocked())) return;
  showModal(null);
  const leaving = senders().filter((s) => keys.includes(s.key));
  state.working = { phase: "unsubscribe", done: 0, total: keys.length };
  state.report = null;
  state.error = null;
  render();
  window.scrollTo({ top: 0 });
  const unlisten = await onUnsubProgress((p) => {
    state.working = p;
    renderSummary();
  });
  try {
    const outcomes = await api.unsubscribe(acc.id, keys, state.trash);
    await loadAccountState();
    const left = leaving.filter((s) => outcomes.some((o) => o.key === s.key && o.status === "done"));
    state.report = { outcomes, opened: new Set(), perMonth: perMonth(left) };
  } catch (e) {
    state.error = String(e);
  } finally {
    unlisten();
    state.working = null;
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
    case "close-report":
      state.report = null;
      renderReport();
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
    case "remove-account":
      showModal({ kind: "remove-account" });
      break;
    case "confirm-remove": {
      const acc = account();
      showModal(null);
      if (acc) {
        await api.removeAccount(acc.id);
        state.report = null;
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
      renderSummary();
      renderList();
      break;
    case "undo":
      await api.forgetUnsubscribed(id, key);
      state.history.delete(key);
      renderSummary();
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
      const r = state.report;
      if (!r) break;
      const targets = r.outcomes.filter(
        (o) => o.status === "manual" && (action === "open-all-manual" ? !r.opened.has(o.key) : o.key === key),
      );
      for (const o of targets) await openManual(o, r.opened);
      renderReport();
      renderList();
      break;
    }
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && state.modal) showModal(null);
});

// ---------- boot ----------

function render() {
  if (!state.current || state.addingAccount) renderConnect();
  else renderMain();
  renderModal();
}

async function boot() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
    await (await import("./demo")).installDemo();
  }
  setLang(lang);
  await loadAccounts();
  await loadAccountState();
  render();
}

void boot();
