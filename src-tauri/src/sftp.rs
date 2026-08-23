use std::{
    collections::HashMap,
    fs::{self, File},
    io,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use ssh2::{CheckResult, KnownHostFileKind, Session, Sftp};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDownload {
    pub name: String,
    pub path: String,
    pub size: u64,
}

struct ManagedSession {
    connection_key: String,
    session: Session,
    sftp: Sftp,
}

#[derive(Default)]
pub struct SftpManager {
    sessions: Mutex<HashMap<String, ManagedSession>>,
}

impl SftpManager {
    fn connection_key(server: &ServerProfile, username: &str) -> String {
        format!("{}:{}@{}:{}", server.id, username, server.host, server.port)
    }

    fn sessions(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, ManagedSession>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "SFTP session manager lock was poisoned".to_string())
    }

    fn ensure_session<'a>(
        sessions: &'a mut HashMap<String, ManagedSession>,
        server: &ServerProfile,
        username: &str,
        password: Option<&str>,
    ) -> Result<&'a mut ManagedSession, String> {
        let key = Self::connection_key(server, username);
        let replace = sessions
            .get(&server.id)
            .map(|managed| managed.connection_key != key)
            .unwrap_or(true);
        if replace {
            sessions.remove(&server.id);
            let session = connected_session(server, username, password)?;
            let sftp = session
                .sftp()
                .map_err(|e| format!("Could not start SFTP subsystem: {e}"))?;
            sessions.insert(
                server.id.clone(),
                ManagedSession {
                    connection_key: key,
                    session,
                    sftp,
                },
            );
        }
        sessions
            .get_mut(&server.id)
            .ok_or_else(|| "Could not retain SFTP session".to_string())
    }

    fn with_session<T, F>(
        &self,
        server: &ServerProfile,
        username: &str,
        password: Option<&str>,
        operation: F,
    ) -> Result<T, String>
    where
        F: Fn(&Sftp) -> Result<T, String>,
    {
        let mut sessions = self.sessions()?;
        let first_result = {
            let managed = Self::ensure_session(&mut sessions, server, username, password)?;
            operation(&managed.sftp)
        };

        match first_result {
            Ok(value) => Ok(value),
            Err(first_error) => {
                let stale = sessions
                    .get_mut(&server.id)
                    .map(|managed| {
                        managed.session.keepalive_send().is_err()
                            || managed.sftp.realpath(Path::new(".")).is_err()
                    })
                    .unwrap_or(true);
                if !stale {
                    return Err(first_error);
                }

                sessions.remove(&server.id);
                let managed = Self::ensure_session(&mut sessions, server, username, password)?;
                operation(&managed.sftp)
            }
        }
    }

    pub fn close(&self, server_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions()?;
        if let Some(managed) = sessions.remove(server_id) {
            let _ = managed.session.disconnect(None, "LocalSSH SFTP session closed", None);
        }
        Ok(())
    }

    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, managed) in sessions.drain() {
                let _ = managed.session.disconnect(None, "LocalSSH closed", None);
            }
        }
    }
}

impl Drop for SftpManager {
    fn drop(&mut self) {
        self.close_all();
    }
}

fn expand_tilde(value: &str) -> PathBuf {
    if value == "~" {
        return std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(value));
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
        .to_socket_addrs()
        .map_err(|e| format!("Could not resolve {}: {e}", server.host))?;
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
    Err(format!(
        "Could not connect to {}:{}: {}",
        server.host,
        server.port,
        last_error
            .map(|e| e.to_string())
            .unwrap_or_else(|| "no address found".into())
    ))
}

fn verify_known_host(session: &Session, server: &ServerProfile) -> Result<(), String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME is not available; cannot locate ~/.ssh/known_hosts".to_string())?;
    let known_hosts_path = Path::new(&home).join(".ssh/known_hosts");
    if !known_hosts_path.exists() {
        return Err("No ~/.ssh/known_hosts file exists. Connect in the Terminal tab first so OpenSSH can verify and save the server host key.".into());
    }
    let mut known_hosts = session
        .known_hosts()
        .map_err(|e| format!("Could not initialise known_hosts verification: {e}"))?;
    known_hosts
        .read_file(&known_hosts_path, KnownHostFileKind::OpenSSH)
        .map_err(|e| format!("Could not read ~/.ssh/known_hosts: {e}"))?;
    let (host_key, _) = session
        .host_key()
        .ok_or_else(|| "SSH server did not provide a host key".to_string())?;
    match known_hosts.check_port(&server.host, server.port, host_key) {
        CheckResult::Match => Ok(()),
        CheckResult::NotFound => Err("Server host key is not in ~/.ssh/known_hosts. Connect in the Terminal tab first and verify the fingerprint.".into()),
        CheckResult::Mismatch => Err("Server host key does not match ~/.ssh/known_hosts. Refusing the SFTP connection.".into()),
        CheckResult::Failure => Err("Could not verify the server host key against ~/.ssh/known_hosts".into()),
    }
}

fn authenticate(
    session: &Session,
    server: &ServerProfile,
    username: &str,
    password: Option<&str>,
) -> Result<(), String> {
    if session.userauth_agent(username).is_ok() && session.authenticated() {
        return Ok(());
    }
    if let Some(identity) = server
        .identity_file
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let key = expand_tilde(identity.trim());
        if session
            .userauth_pubkey_file(username, None, &key, None)
            .is_ok()
            && session.authenticated()
        {
            return Ok(());
        }
    }
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        return session
            .userauth_password(username, password)
            .map_err(|_| "SFTP_AUTH_FAILED: password rejected".to_string())
            .and_then(|_| {
                if session.authenticated() {
                    Ok(())
                } else {
                    Err("SFTP_AUTH_FAILED: password rejected".into())
                }
            });
    }
    Err("SFTP_AUTH_REQUIRED: key, ssh-agent, and saved password authentication were unavailable".into())
}

fn connected_session(
    server: &ServerProfile,
    username: &str,
    password: Option<&str>,
) -> Result<Session, String> {
    let tcp = connect_tcp(server)?;
    let mut session = Session::new()
        .map_err(|e| format!("Could not initialise SSH session: {e}"))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|e| format!("SSH handshake failed: {e}"))?;
    verify_known_host(&session, server)?;
    authenticate(&session, server, username, password)?;
    session.set_keepalive(true, 30);
    Ok(session)
}

pub fn list_remote(
    manager: &SftpManager,
    server: &ServerProfile,
    username: &str,
    path: &str,
    password: Option<&str>,
) -> Result<Vec<RemoteEntry>, String> {
    manager.with_session(server, username, password, |sftp| {
        let remote_path = if path.trim().is_empty() { "/" } else { path.trim() };
        let mut entries = sftp
            .readdir(Path::new(remote_path))
            .map_err(|e| format!("Could not list {remote_path}: {e}"))?
            .into_iter()
            .map(|(path, stat)| {
                let file_type = stat.file_type();
                let kind = if file_type.is_dir() {
                    "directory"
                } else if file_type.is_symlink() {
                    "symlink"
                } else {
                    "file"
                };
                RemoteEntry {
                    name: path
                        .file_name()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_else(|| path.to_string_lossy().to_string()),
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
            b_dir
                .cmp(&a_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    })
}

pub fn upload_remote(
    manager: &SftpManager,
    server: &ServerProfile,
    username: &str,
    local_path: &str,
    remote_dir: &str,
    password: Option<&str>,
    replace: bool,
) -> Result<RemoteUpload, String> {
    let local = Path::new(local_path);
    let metadata = fs::metadata(local)
        .map_err(|e| format!("Could not read local file {local_path}: {e}"))?;
    if metadata.is_dir() {
        return Err(format!("SFTP_DIRECTORY_UNSUPPORTED:{local_path}"));
    }
    let file_name = local
        .file_name()
        .ok_or_else(|| format!("Could not determine local filename for {local_path}"))?
        .to_os_string();
    let remote_base = if remote_dir.trim().is_empty() { "/" } else { remote_dir.trim() };
    let remote_path = Path::new(remote_base).join(&file_name);

    manager.with_session(server, username, password, |sftp| {
        if let Ok(stat) = sftp.stat(&remote_path) {
            if stat.file_type().is_dir() {
                return Err(format!("Remote target is a directory: {}", remote_path.to_string_lossy()));
            }
            if !replace {
                return Err(format!("SFTP_FILE_EXISTS:{}", remote_path.to_string_lossy()));
            }
        }

        let mut source = File::open(local)
            .map_err(|e| format!("Could not open local file {local_path}: {e}"))?;
        let mut target = sftp.create(&remote_path).map_err(|e| {
            format!("Could not create remote file {}: {e}", remote_path.to_string_lossy())
        })?;
        io::copy(&mut source, &mut target)
            .map_err(|e| format!("Could not upload {}: {e}", remote_path.to_string_lossy()))?;

        Ok(RemoteUpload {
            name: file_name.to_string_lossy().to_string(),
            path: remote_path.to_string_lossy().to_string(),
            size: metadata.len(),
        })
    })
}

pub fn download_remote(
    manager: &SftpManager,
    server: &ServerProfile,
    username: &str,
    remote_path: &str,
    local_dir: &str,
    password: Option<&str>,
) -> Result<RemoteDownload, String> {
    let remote = Path::new(remote_path);
    let file_name = remote
        .file_name()
        .ok_or_else(|| format!("Could not determine remote filename for {remote_path}"))?
        .to_os_string();

    let destination_dir = Path::new(local_dir);
    if !destination_dir.is_dir() {
        return Err(format!("Download destination is not a directory: {local_dir}"));
    }
    let local_path = destination_dir.join(&file_name);
    if local_path.exists() {
        return Err(format!("SFTP_LOCAL_FILE_EXISTS:{}", local_path.to_string_lossy()));
    }

    manager.with_session(server, username, password, |sftp| {
        let stat = sftp
            .stat(remote)
            .map_err(|e| format!("Could not stat remote file {remote_path}: {e}"))?;
        if stat.file_type().is_dir() {
            return Err(format!("SFTP_DIRECTORY_DOWNLOAD_UNSUPPORTED:{remote_path}"));
        }

        let mut source = sftp
            .open(remote)
            .map_err(|e| format!("Could not open remote file {remote_path}: {e}"))?;
        let mut target = File::create(&local_path)
            .map_err(|e| format!("Could not create local file {}: {e}", local_path.to_string_lossy()))?;
        let copied = io::copy(&mut source, &mut target)
            .map_err(|e| format!("Could not download {remote_path}: {e}"))?;

        Ok(RemoteDownload {
            name: file_name.to_string_lossy().to_string(),
            path: local_path.to_string_lossy().to_string(),
            size: stat.size.unwrap_or(copied),
        })
    })
}
