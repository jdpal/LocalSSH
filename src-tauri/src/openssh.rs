use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use uuid::Uuid;

use crate::server::ServerProfile;

// macOS Unix-domain socket paths are short (sun_path is roughly 104 bytes),
// and OpenSSH may temporarily append a suffix while creating a control socket.
// Keep our configured ControlPath comfortably below that limit.
const MAX_CONTROL_PATH_BYTES: usize = 72;
static CONTROL_DIR: OnceLock<PathBuf> = OnceLock::new();

fn create_private_control_dir() -> PathBuf {
    for _ in 0..8 {
        let nonce = Uuid::new_v4().simple().to_string();
        let dir = PathBuf::from("/tmp").join(format!(
            "lssh-{}-{}",
            std::process::id(),
            &nonce[..8]
        ));

        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        match builder.create(&dir) {
            Ok(()) => return dir,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => continue,
        }
    }

    // Fail closed: return a short, non-existent parent. OpenSSH will report a
    // clear connection error rather than falling back to a shared/insecure dir.
    PathBuf::from("/tmp").join(format!("lssh-unavailable-{}", std::process::id()))
}

fn control_dir() -> &'static Path {
    CONTROL_DIR.get_or_init(create_private_control_dir).as_path()
}

fn control_key(server: &ServerProfile, username: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    server.id.hash(&mut hasher);
    server.host.hash(&mut hasher);
    server.port.hash(&mut hasher);
    username.hash(&mut hasher);
    hasher.finish()
}

pub fn control_path(server: &ServerProfile, username: &str) -> PathBuf {
    let path = control_dir().join(format!("c-{:016x}", control_key(server, username)));
    assert!(path.as_os_str().as_encoded_bytes().len() <= MAX_CONTROL_PATH_BYTES);
    path
}

pub fn common_options(server: &ServerProfile, username: &str) -> Vec<String> {
    let mut args = vec![
        "-o".into(), "ControlMaster=auto".into(),
        "-o".into(), format!("ControlPath={}", control_path(server, username).display()),
        "-o".into(), "StrictHostKeyChecking=yes".into(),
        "-o".into(), "ConnectTimeout=10".into(),
        "-o".into(), "ServerAliveInterval=30".into(),
        "-o".into(), "ServerAliveCountMax=3".into(),
    ];
    if let Some(identity) = server.identity_file.as_deref().filter(|value| !value.trim().is_empty()) {
        args.push("-i".into());
        args.push(expand_tilde(identity.trim()));
        args.push("-o".into());
        args.push("IdentitiesOnly=yes".into());
    }
    args
}

pub fn ssh_args(server: &ServerProfile) -> Vec<String> {
    let mut args = vec!["-p".into(), server.port.to_string()];
    args.extend(common_options(server, &server.username));
    args.push(format!("{}@{}", server.username, server.host));
    args
}

pub fn sftp_args(server: &ServerProfile, username: &str) -> Vec<String> {
    let mut args = vec!["-q".into(), "-P".into(), server.port.to_string()];
    args.extend(common_options(server, username));
    args.push(format!("{}@{}", username, server.host));
    args
}

fn expand_tilde(value: &str) -> String {
    if value == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| value.to_string());
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server() -> ServerProfile {
        ServerProfile {
            id: "12345678-abcd-4321-aaaa-bbbbbbbbbbbb".into(),
            name: "Test".into(), host: "example.com".into(), port: 22,
            username: "alice".into(), group_name: "Test".into(), favourite: false,
            identity_file: None, sftp_username: None, use_ssh_credentials_for_sftp: true,
            has_ssh_password: false, has_sftp_password: false, last_connected_at: None,
        }
    }

    #[test]
    fn terminal_and_sftp_share_control_path_when_username_matches() {
        let server = server();
        let ssh = ssh_args(&server).join(" ");
        let sftp = sftp_args(&server, "alice").join(" ");
        let path = control_path(&server, "alice").display().to_string();
        assert!(ssh.contains("ControlMaster=auto"));
        assert!(sftp.contains("ControlMaster=auto"));
        assert!(ssh.contains(&path));
        assert!(sftp.contains(&path));
    }

    #[test]
    fn control_path_stays_below_macos_unix_socket_limit() {
        let mut server = server();
        server.id = "12345678-1234-1234-1234-12345678901234567890".into();
        server.host = "very-long-hostname-that-must-not-leak-into-the-control-socket.example.com".into();
        let path = control_path(&server, "an-extremely-long-username-that-must-not-expand-the-socket-path");
        assert!(path.as_os_str().as_encoded_bytes().len() <= MAX_CONTROL_PATH_BYTES);
        assert!(path.starts_with("/tmp"));
    }
}
