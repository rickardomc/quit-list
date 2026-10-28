# Quit List

**Esci da tutte le mailing list. In un click.**
*Quit every mailing list. In one click.* — [English below](#english)

Quit List è un'app desktop gratuita e open source che trova nella tua casella tutte le newsletter e le mailing list e ti disiscrive da tutte insieme. Niente abbonamenti, niente versione "Pro", niente pubblicità: il progetto vive solo di donazioni.

<img src="docs/screenshots/inbox.png" alt="Elenco delle mailing list trovate" width="640" />

## Come funziona

1. **Connetti la tua email** (Gmail, Outlook, Yahoo, iCloud, Libero, Virgilio, Proton Mail Bridge, Fastmail, GMX… o qualsiasi server IMAP).
2. **Scansiona**: l'app legge solo le *intestazioni* delle email (mittente, oggetto, `List-Unsubscribe`), mai il contenuto, e raggruppa i messaggi per mittente. Su Gmail analizza "Tutti i messaggi", quindi trova anche le newsletter archiviate; sugli altri provider la Posta in arrivo più l'eventuale cartella Archivio.
   Molte aziende mettono il link di disiscrizione anche su ordini, ricevute e avvisi di sicurezza: l'app li riconosce (oggetto, intestazioni come `Precedence: bulk`, categorie di Gmail) e li separa nella scheda **Notifiche e ricevute**, esclusa da "Esci da tutte".
3. **Premi "Esci da tutte"**. Per ogni mailing list Quit List usa il metodo migliore disponibile:

| Metodo | Come | Serve fare qualcosa? |
| --- | --- | --- |
| **Automatica** | Richiesta *one-click* [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058) (`List-Unsubscribe-Post`) | No |
| **Via email** | Invia l'email di disiscrizione (`mailto:` di `List-Unsubscribe`) dal tuo account | No |
| **Sul sito** | Il mittente offre solo una pagina web | Un click: l'app ti dà la lista dei link da aprire |

Se la richiesta automatica fallisce, l'app ripiega da sola sull'email e poi sul link.

Altre funzioni:

- **Tieni** i mittenti che vuoi continuare a ricevere: "Esci da tutte" li salta.
- **Filtra per metodo** di disiscrizione (automatica, via email, sul sito, o solo quelle senza click).
- **Sposta nel cestino** (opzionale) tutte le email già ricevute dalle liste che lasci.
- **Controllo "continua a scrivere"**: alla scansione successiva vedi chi ha ignorato la disiscrizione e puoi riprovare.
- Più account, interfaccia in italiano e inglese, tema chiaro/scuro.

<img src="docs/screenshots/results.png" alt="Risultato della disiscrizione" width="640" />

<img src="docs/screenshots/dark.png" alt="Tema scuro" width="640" />

## Privacy

- **Tutto in locale.** Nessun server di Quit List, nessuna telemetria, nessun account da creare.
- La password è salvata nel **portachiavi del sistema** (Keychain su macOS, Credential Manager su Windows, Secret Service su Linux). Se il portachiavi non è disponibile resta solo in memoria fino alla chiusura.
- Le uniche connessioni in uscita sono verso il tuo provider email (IMAP/SMTP) e verso gli indirizzi di disiscrizione indicati dai mittenti stessi.
- La scansione apre la posta in sola lettura (`EXAMINE` + `BODY.PEEK`): nessuna email viene segnata come letta.

## Accesso: password per le app

Quit List si collega via IMAP/SMTP. Molti provider non accettano la password normale e richiedono una **password per le app**: l'app lo rileva dall'indirizzo e ti porta alla pagina giusta.

| Provider | Cosa serve |
| --- | --- |
| Gmail | [Password per le app](https://myaccount.google.com/apppasswords) (richiede la verifica in due passaggi) |
| Yahoo, iCloud, Fastmail, Zoho, Yandex | Password per le app |
| Libero, Virgilio, TIM/Alice, Tiscali, GMX, Posteo, mailbox.org | Password normale (IMAP attivo) |
| Proton Mail | [Proton Mail Bridge](https://proton.me/mail/bridge) avviato, con le credenziali del Bridge |
| Outlook / Hotmail personali | Microsoft sta eliminando le password per le app: serve OAuth, non ancora supportato (vedi roadmap) |

Perché non "Accedi con Google"? L'accesso OAuth alla posta Gmail richiede una verifica di sicurezza annuale a pagamento per ogni app pubblicata: è proprio il costo che spinge app simili verso gli abbonamenti. Le password per le app permettono di restare gratuiti.

## Installazione

Scarica l'installer per il tuo sistema dalla pagina [Releases](https://github.com/rickardomc/quit-list/releases) (macOS, Windows, Linux).

### Compilare dal sorgente

Requisiti: [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) stabile e le [dipendenze di sistema di Tauri](https://v2.tauri.app/start/prerequisites/) (su Linux anche `libdbus-1-dev` e `libssl-dev`).

```bash
npm install
```

```bash
npm run tauri dev
```

Per creare l'installer:

```bash
npm run tauri build
```

Per lavorare sull'interfaccia senza un account email c'è una modalità demo, solo in sviluppo: avvia `npm run dev` e apri `http://localhost:1420/?demo` (account con una scansione già fatta) oppure `?demo=new` (primo avvio). Usa dati di esempio e non finisce mai nella build di produzione.

Test del backend:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Struttura

```
src/                 interfaccia (TypeScript + Vite, nessun framework)
  main.ts            viste e azioni
  i18n.ts            testi italiano/inglese
  styles.css         componenti; token e base in styles/
  icons.ts           icone Phosphor
  demo.ts            backend simulato per la modalità demo
  config.ts          link a sorgente e donazioni
src-tauri/src/       backend (Rust)
  providers.rs       server IMAP/SMTP noti per dominio
  scan.rs            scansione della casella e spostamento nel cestino
  listunsub.rs       parsing di List-Unsubscribe / List-Unsubscribe-Post / mailto
  unsub.rs           esecuzione delle disiscrizioni (one-click, email, link)
  mail.rs            connessioni IMAP e SMTP
  store.rs           dati locali (JSON) e portachiavi
```

Per pubblicare una release: crea un tag `vX.Y.Z` e fai push; il workflow `release.yml` compila gli installer e crea una release in bozza.

## Design

L'interfaccia segue le skill di design in [`.claude/skills`](.claude/skills/README.md) (Impeccable, Hallmark, landing-page-design): tema "Dose" di Hallmark adattato a un'app, font Geist e Geist Mono inclusi nell'app, icone Phosphor, tema chiaro e scuro. Il linter di Hallmark si lancia così, con il dev server avviato:

```bash
node .claude/skills/hallmark/scripts/sloplint.mjs src/styles.css index.html --genre modern-minimal --scope app --url "http://localhost:1420/?demo"
```

## Roadmap

- Accesso OAuth per Outlook/Microsoft 365 (PKCE, nessun segreto da distribuire)
- Scansione di altre cartelle (es. "Tutti i messaggi" di Gmail, Spam)
- Rilevamento dei link di disiscrizione nel corpo delle email che non hanno `List-Unsubscribe`

Contributi benvenuti: apri una issue o una pull request.

## Supporta il progetto

Quit List è e resterà gratuito. Se ti ha fatto risparmiare tempo puoi supportarlo con una donazione: [GitHub Sponsors](https://github.com/sponsors/rickardomc). Le donazioni coprono la firma del codice per macOS/Windows e il tempo di sviluppo.

## Licenza

[GPL-3.0-or-later](LICENSE). Puoi usare, studiare, modificare e redistribuire l'app; le versioni modificate distribuite devono restare open source con la stessa licenza.

Ispirato da [Paperweight](https://github.com/wslyvh/paperweight) di wslyvh. Quit List è una riscrittura indipendente con Tauri focalizzata sulla disiscrizione; non contiene codice di Paperweight.

---

## English

Quit List is a free, open source desktop app that finds every newsletter and mailing list in your inbox and unsubscribes you from all of them at once. No subscriptions, no "Pro" tier, no ads: the project is funded by donations only.

- **Connect** any IMAP account (Gmail and others via app passwords, Proton Mail via Bridge).
- **Scan**: only headers are read (`From`, `Subject`, `List-Unsubscribe`), never message bodies, and the mailbox is opened read-only. On Gmail it scans "All Mail", so archived newsletters are found too.
- **Newsletters vs. notifications**: receipts, orders and security alerts that carry an unsubscribe link anyway are detected and kept out of "Quit all".
- **Quit all**: RFC 8058 one-click when available, otherwise the `mailto:` unsubscribe email sent from your own account, otherwise a list of links for you to open. Failed one-click requests fall back automatically.
- **Filter** by unsubscribe method, **keep** the senders you like, optionally **move** past emails to the trash, and see who **keeps sending** after you unsubscribed.
- **Local-first**: no Quit List servers, no telemetry; passwords live in the OS keychain.

Build with `npm install` and `npm run tauri dev` (see the requirements above). Licensed under GPL-3.0-or-later. Donations: [GitHub Sponsors](https://github.com/sponsors/rickardomc).
