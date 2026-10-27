//! IMAP and SMTP connections.

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls as SmtpTls, TlsParameters};
use lettre::{Message, SmtpTransport, Transport};
use native_tls::{TlsConnector, TlsStream};

use crate::providers::{is_local_host, Security};
use crate::store::Account;

pub type ImapSession = imap::Session<TlsStream<TcpStream>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const IO_TIMEOUT: Duration = Duration::from_secs(120);

/// Errors are returned as short codes the UI translates, optionally followed
/// by `: <technical detail>`.
fn err(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{code}: {detail}")
}

fn tls_connector(host: &str) -> Result<TlsConnector, String> {
    TlsConnector::builder()
        // Local bridges such as Proton Mail Bridge use self-signed certificates.
        .danger_accept_invalid_certs(is_local_host(host))
        .build()
        .map_err(|e| err("tls_failed", e))
}

fn tcp_connect(host: &str, port: u16) -> Result<TcpStream, String> {
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| err("connect_failed", e))?;
    let mut last = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(stream) => {
                stream.set_read_timeout(Some(IO_TIMEOUT)).ok();
                stream.set_write_timeout(Some(IO_TIMEOUT)).ok();
                return Ok(stream);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(err(
        "connect_failed",
        last.map(|e| e.to_string())
            .unwrap_or_else(|| format!("{host}:{port}")),
    ))
}

pub fn imap_login(account: &Account, password: &str) -> Result<ImapSession, String> {
    let s = &account.servers;
    let tls = tls_connector(&s.imap_host)?;
    let stream = tcp_connect(&s.imap_host, s.imap_port)?;

    let client = match s.imap_security {
        Security::Tls => {
            let tls_stream = tls
                .connect(&s.imap_host, stream)
                .map_err(|e| err("tls_failed", e))?;
            let mut client = imap::Client::new(tls_stream);
            client
                .read_greeting()
                .map_err(|e| err("connect_failed", e))?;
            client
        }
        Security::Starttls => {
            let mut client = imap::Client::new(stream);
            client
                .read_greeting()
                .map_err(|e| err("connect_failed", e))?;
            client
                .secure(&s.imap_host, &tls)
                .map_err(|e| err("tls_failed", e))?
        }
    };

    client
        .login(&account.username, password)
        .map_err(|(e, _)| match e {
            imap::Error::No(msg) | imap::Error::Bad(msg) => err("auth_failed", msg),
            other => err("connect_failed", other),
        })
}

pub struct Smtp {
    transport: SmtpTransport,
    from: Mailbox,
}

impl Smtp {
    pub fn new(account: &Account, password: &str) -> Result<Self, String> {
        let s = &account.servers;
        let params = TlsParameters::builder(s.smtp_host.clone())
            .dangerous_accept_invalid_certs(is_local_host(&s.smtp_host))
            .build()
            .map_err(|e| err("tls_failed", e))?;
        let tls = match s.smtp_security {
            Security::Tls => SmtpTls::Wrapper(params),
            Security::Starttls => SmtpTls::Required(params),
        };
        let transport = SmtpTransport::builder_dangerous(&s.smtp_host)
            .port(s.smtp_port)
            .tls(tls)
            .credentials(Credentials::new(
                account.username.clone(),
                password.to_string(),
            ))
            .timeout(Some(Duration::from_secs(30)))
            .build();
        let from = account
            .email
            .parse()
            .map_err(|e| err("invalid_address", e))?;
        Ok(Self { transport, from })
    }

    pub fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), String> {
        let to: Mailbox = to.parse().map_err(|e| err("invalid_address", e))?;
        let message = Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(subject)
            .body(body.to_string())
            .map_err(|e| err("send_failed", e))?;
        self.transport
            .send(&message)
            .map(|_| ())
            .map_err(|e| err("send_failed", e))
    }
}
