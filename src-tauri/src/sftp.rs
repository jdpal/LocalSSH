use std::{
    fs::{self, File},
    io,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    time::Duration,
};

use serde::Serialize;
use ssh2::{CheckResult, KnownHostFileKind, Session};

use crate::server::ServerProfile;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteUpload {
    pub name: String,
    pub path: String,
    pub size: u64,
}

fn expand_tilde(value: &str) -> PathBuf {
    if value == "~" {
        return std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

fn connect_tcp(server: &ServerProfile) -> Result<TcpStream, String> {
    let addresses = format!("{}:{}", server.host, server.port)
        .to_socket_addrs().map_err(|e| format!("Could not resolve {}: {e}", server.host))?;
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, Duration::from_secs(10)) {
            Ok(stream) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(20)));
                return Ok(stream);
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(format!("Could not connect to {}:{}: {}", server.host, server.port, last_error.map(|e| e.to_string()).unwrap_or_else(|| "no address found".into())))
}

fn verify_known_host(session: &Session, server: &ServerProfile) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not available; cannot locate ~/.ssh/known_hosts".to_string())?;
    let known_hosts_path = Path::new(&home).join(".ssh/known_hosts");
    if !known_hosts_path.exists() {
        return Err("No ~/.ssh/known_hosts file exists. Connect in the Terminal tab first so OpenSSH can verify and save the server host key.".into());
    }
    let mut known_hosts = session.known_hosts().map_err(|e| format!("Could not initialise known_hosts verification: {e}"))?;
    known_hosts.read_file(&known_hosts_path, KnownHostFileKind::OpenSSH)
        .map_err(|e| format!("Could not read ~/.ssh/known_hosts: {e}"))?;
    let (host_key, _) = session.host_key().ok_or_else(|| "SSH server did not provide a host key".to_string())?;
    match known_hosts.check_port(&server.host, server.port, host_key) {
        CheckResult::Match => Ok(()),
        CheckResult::NotFound => Err("Server host key is not in ~/.ssh/known_hosts. Connect in the Terminal tab first and verify the fingerprint.".into()),
        CheckResult::Mismatch => Err("Server host key does not match ~/.ssh/known_hosts. Refusing the SFTP connection.".into()),
        CheckResult::Failure => Err("Could not verify the server host key against ~/.ssh/known_hosts".into()),
    }
}

fn authenticate(session: &Session, server: &ServerProfile, password: Option<&str>) -> Result<(), String> {
    if session.userauth_agent(&server.username).is_ok() && session.authenticated() {
        return Ok(());
    }
    if let Some(identity) = server.identity_file.as_deref().filter(|v| !v.trim().is_empty()) {
        let key = expand_tilde(identity.trim());
        if session.userauth_pubkey_file(&server.username, None, &key, None).is_ok() && session.authenticated() {
            return Ok(());
        }
    }
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        return session.userauth_password(&server.username, password)
            .map_err(|_| "SFTP_AUTH_FAILED: password rejected".to_string())
            .and_then(|_| if session.authenticated() { Ok(()) } else { Err("SFTP_AUTH_FAILED: password rejected".to_string()) });
    }
    Err("SFTP_AUTH_REQUIRED: key and ssh-agent authentication were unavailable".into())
}

fn connected_session(server: &ServerProfile, password: Option<&str>) -> Result<Session, String> {
    let tcp = connect_tcp(server)?;
    let mut session = Session::new().map_err(|e| format!("Could not initialise SSH session: {e}"))?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| format!("SSH handshake failed: {e}"))?;
    verify_known_host(&session, server)?;
    authenticate(&session, server, password)?;
    Ok(session)
}

pub fn list_remote(server: &ServerProfile, path: &str, password: Option<&str>) -> Result<Vec<RemoteEntry>, String> {
    let session = connected_session(server, password)?;

    let sftp = session.sftp().map_err(|e| format!("Could not start SFTP subsystem: {e}"))?;
    let remote_path = if path.trim().is_empty() { "/" } else { path.trim() };
    let mut entries = sftp.readdir(Path::new(remote_path))
        .map_err(|e| format!("Could not list {remote_path}: {e}"))?
        .into_iter()
        .map(|(path, stat)| {
            let file_type = stat.file_type();
            let kind = if file_type.is_dir() { "directory" } else if file_type.is_symlink() { "symlink" } else { "file" };
            RemoteEntry {
                name: path.file_name().map(|v| v.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string_lossy().to_string()),
                path: path.to_string_lossy().to_string(),
                kind: kind.to_string(),
                size: stat.size,
                modified: stat.mtime,
            }
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        let a_dir = a.kind == "directory";
        let b_dir = b.kind == "directory";
        b_dir.cmp(&a_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn upload_remote(
    server: &ServerProfile,
    local_path: &str,
    remote_dir: &str,
    password: Option<&str>,
    replace: bool,
) -> Result<RemoteUpload, String> {
    let local = Path::new(local_path);
    let metadata = fs::metadata(local).map_err(|e| format!("Could not read local file {local_path}: {e}"))?;
    if metadata.is_dir() {
        return Err(format!("SFTP_DIRECTORY_UNSUPPORTED:{local_path}"));
    }

    let file_name = local.file_name()
        .ok_or_else(|| format!("Could not determine local filename for {local_path}"))?;
    let remote_base = if remote_dir.trim().is_empty() { "/" } else { remote_dir.trim() };
    let remote_path = Path::new(remote_base).join(file_name);

    let session = connected_session(server, password)?;
    let sftp = session.sftp().map_err(|e| format!("Could not start SFTP subsystem: {e}"))?;

    if let Ok(stat) = sftp.stat(&remote_path) {
        if stat.file_type().is_dir() {
            return Err(format!("Remote target is a directory: {}", remote_path.to_string_lossy()));
        }
        if !replace {
            return Err(format!("SFTP_FILE_EXISTS:{}", remote_path.to_string_lossy()));
        }
    }

    let mut source = File::open(local).map_err(|e| format!("Could not open local file {local_path}: {e}"))?;
    let mut target = sftp.create(&remote_path)
        .map_err(|e| format!("Could not create remote file {}: {e}", remote_path.to_string_lossy()))?;
    io::copy(&mut source, &mut target)
        .map_err(|e| format!("Could not upload {}: {e}", remote_path.to_string_lossy()))?;

    Ok(RemoteUpload {
        name: file_name.to_string_lossy().to_string(),
        path: remote_path.to_string_lossy().to_string(),
        size: metadata.len(),
    })
}
