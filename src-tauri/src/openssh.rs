use std::{fs, path::PathBuf};

use crate::server::ServerProfile;

fn safe_component(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars().take(18) {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() { "user".into() } else { out }
}

pub fn control_path(server: &ServerProfile, username: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("localssh-control");
    let _ = fs::create_dir_all(&dir);
    let short_id = server.id.chars().take(12).collect::<String>();
    dir.join(format!("ctl-{short_id}-{}", safe_component(username)))
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
}
