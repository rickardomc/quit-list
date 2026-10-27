//! IMAP and SMTP connections.

use std::future::Future;
use std::time::Duration;

use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls as SmtpTls, TlsParameters};
use lettre::{Message, SmtpTransport, Transport};
use tokio::net::TcpStream;
use tokio_native_tls::{native_tls, TlsConnector, TlsStream};

use crate::providers::{is_local_host, Security};
use crate::store::Account;

pub type ImapSession = async_imap::Session<TlsStream<TcpStream>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
pub const IO_TIMEOUT: Duration = Duration::from_secs(120);

/// Errors are returned as short codes the UI translates, optionally followed
/// by `: <technical detail>`.
fn err(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{code}: {detail}")
}

/// Runs an IMAP operation with a deadline, so a stalled server can't hang the app.
pub async fn timed<T, E: std::fmt::Display>(
    code: &str,
    limit: Duration,
    fut: impl Future<Output = Result<T, E>>,
) -> Result<T, String> {
    match tokio::time::timeout(limit, fut).await {
        Ok(result) => result.map_err(|e| err(code, e)),
        Err(_) => Err(err(code, "timed out")),
    }
}

fn tls_connector(host: &str) -> Result<TlsConnector, String> {
    native_tls::TlsConnector::builder()
        // Local bridges such as Proton Mail Bridge use self-signed certificates.
        .danger_accept_invalid_certs(is_local_host(host))
        .build()
        .map(TlsConnector::from)
        .map_err(|e| err("tls_failed", e))
}

pub async fn imap_login(account: &Account, password: &str) -> Result<ImapSession, String> {
    let s = &account.servers;
    let host = s.imap_host.as_str();
    let tls = tls_connector(host)?;
    let stream = timed(
        "connect_failed",
        CONNECT_TIMEOUT,
        TcpStream::connect((host, s.imap_port)),
    )
    .await?;

    let client = match s.imap_security {
        Security::Tls => {
            let tls_stream =
                timed("tls_failed", CONNECT_TIMEOUT, tls.connect(host, stream)).await?;
            let mut client = async_imap::Client::new(tls_stream);
            read_greeting(&mut client).await?;
            client
        }
        Security::Starttls => {
            let mut client = async_imap::Client::new(stream);
            read_greeting(&mut client).await?;
            timed(
                "tls_failed",
                CONNECT_TIMEOUT,
                client.run_command_and_check_ok("STARTTLS", None),
            )
            .await?;
            let tls_stream = timed(
                "tls_failed",
                CONNECT_TIMEOUT,
                tls.connect(host, client.into_inner()),
            )
            .await?;
            // No new greeting is sent after STARTTLS.
            async_imap::Client::new(tls_stream)
        }
    };

    match tokio::time::timeout(CONNECT_TIMEOUT, client.login(&account.username, password)).await {
        Ok(Ok(session)) => Ok(session),
        Ok(Err((async_imap::error::Error::No(msg) | async_imap::error::Error::Bad(msg), _))) => {
            Err(err("auth_failed", msg))
        }
        Ok(Err((other, _))) => Err(err("connect_failed", other)),
        Err(_) => Err(err("connect_failed", "timed out")),
    }
}

async fn read_greeting<T>(client: &mut async_imap::Client<T>) -> Result<(), String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send,
{
    match tokio::time::timeout(CONNECT_TIMEOUT, client.read_response()).await {
        Ok(Ok(Some(_))) => Ok(()),
        Ok(Ok(None)) => Err(err("connect_failed", "connection closed before greeting")),
        Ok(Err(e)) => Err(err("connect_failed", e)),
        Err(_) => Err(err("connect_failed", "timed out")),
    }
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
