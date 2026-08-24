use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::PathBuf,
    process::Command,
};

use serde::Serialize;
use uuid::Uuid;

use crate::server::ServerProfile;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HostKeyState {
    Trusted,
    Unknown,
    Mismatch,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyInfo {
    pub key_type: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyCheck {
    pub state: HostKeyState,
    pub host: String,
    pub port: u16,
    pub fingerprints: Vec<HostKeyInfo>,
    pub known_fingerprints: Vec<HostKeyInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct KeyRecord {
    key_type: String,
    key_data: String,
}

fn known_host_token(server: &ServerProfile) -> String {
    if server.port == 22 {
        server.host.clone()
    } else {
        format!("[{}]:{}", server.host, server.port)
    }
}

fn known_hosts_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not available; cannot locate ~/.ssh/known_hosts".to_string())?;
    Ok(PathBuf::from(home).join(".ssh").join("known_hosts"))
}

fn parse_key_fields(line: &str) -> Option<KeyRecord> {
    let fields = line.split_whitespace().collect::<Vec<_>>();
    if fields.is_empty() || fields[0].starts_with('#') {
        return None;
    }
    let offset = if fields[0].starts_with('@') { 1 } else { 0 };
    if fields.len() < offset + 3 {
        return None;
    }
    Some(KeyRecord {
        key_type: fields[offset + 1].to_string(),
        key_data: fields[offset + 2].to_string(),
    })
}

fn fingerprint(record: &KeyRecord) -> Result<String, String> {
    let path = PathBuf::from("/tmp").join(format!("lssh-hostkey-{}.pub", Uuid::new_v4().simple()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&path)
        .map_err(|error| format!("Could not prepare host-key fingerprint input: {error}"))?;
    writeln!(file, "{} {} LocalSSH", record.key_type, record.key_data)
        .map_err(|error| format!("Could not prepare host-key fingerprint input: {error}"))?;
    drop(file);

    let output = Command::new("/usr/bin/ssh-keygen")
        .arg("-lf")
        .arg(&path)
        .args(["-E", "sha256"])
        .output()
        .map_err(|error| format!("Could not start ssh-keygen: {error}"));
    let _ = fs::remove_file(&path);
    let output = output?;

    if !output.status.success() {
        return Err(format!("Could not fingerprint host key: {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .nth(1)
        .map(str::to_string)
        .ok_or_else(|| "ssh-keygen did not return a SHA-256 fingerprint".to_string())
}

fn describe(records: &BTreeSet<KeyRecord>) -> Result<Vec<HostKeyInfo>, String> {
    records.iter().map(|record| {
        Ok(HostKeyInfo { key_type: record.key_type.clone(), fingerprint: fingerprint(record)? })
    }).collect()
}

fn scan_keys(server: &ServerProfile) -> Result<BTreeSet<KeyRecord>, String> {
    let port = server.port.to_string();
    let output = Command::new("/usr/bin/ssh-keyscan")
        .args([
            "-T", "5",
            "-p", port.as_str(),
            "-t", "ed25519,ecdsa,rsa",
            server.host.as_str(),
        ])
        .output()
        .map_err(|error| format!("Could not start ssh-keyscan: {error}"))?;

    let records = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_key_fields)
        .collect::<BTreeSet<_>>();

    if records.is_empty() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("Could not retrieve an SSH host key from {}:{}", server.host, server.port)
        } else {
            format!("Could not retrieve an SSH host key from {}:{}: {detail}", server.host, server.port)
        });
    }
    Ok(records)
}

fn known_keys(server: &ServerProfile) -> Result<BTreeSet<KeyRecord>, String> {
    let path = known_hosts_path()?;
    if !path.exists() {
        return Ok(BTreeSet::new());
    }
    let token = known_host_token(server);
    let output = Command::new("/usr/bin/ssh-keygen")
        .args(["-F", &token, "-f"])
        .arg(&path)
        .output()
        .map_err(|error| format!("Could not inspect known_hosts: {error}"))?;

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_key_fields)
        .collect())
}

pub fn check(server: &ServerProfile) -> Result<HostKeyCheck, String> {
    let scanned = scan_keys(server)?;
    let known = known_keys(server)?;
    let state = if known.is_empty() {
        HostKeyState::Unknown
    } else if scanned.iter().any(|key| known.contains(key)) {
        HostKeyState::Trusted
    } else {
        HostKeyState::Mismatch
    };

    Ok(HostKeyCheck {
        state,
        host: server.host.clone(),
        port: server.port,
        fingerprints: describe(&scanned)?,
        known_fingerprints: describe(&known)?,
    })
}

fn ensure_ssh_dir() -> Result<PathBuf, String> {
    let path = known_hosts_path()?;
    let dir = path.parent().ok_or_else(|| "Could not resolve ~/.ssh directory".to_string())?;
    if !dir.exists() {
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(dir).map_err(|error| format!("Could not create ~/.ssh: {error}"))?;
    }
    Ok(path)
}

pub fn trust(server: &ServerProfile, expected_fingerprints: &[String]) -> Result<HostKeyCheck, String> {
    let current = check(server)?;
    match current.state {
        HostKeyState::Trusted => return Ok(current),
        HostKeyState::Mismatch => {
            return Err("HOST_KEY_MISMATCH: The saved host key does not match the key currently presented by the server.".into());
        }
        HostKeyState::Unknown => {}
    }

    let expected = expected_fingerprints.iter().cloned().collect::<BTreeSet<_>>();
    let actual = current.fingerprints.iter().map(|item| item.fingerprint.clone()).collect::<BTreeSet<_>>();
    if expected.is_empty() || expected != actual {
        return Err("HOST_KEY_CHANGED_DURING_TRUST: The server host key changed before it could be saved. Connection was not trusted.".into());
    }

    // Re-scan immediately before writing so the trusted key material is the same
    // material whose fingerprint the user approved.
    let scanned = scan_keys(server)?;
    let rescanned = describe(&scanned)?.into_iter().map(|item| item.fingerprint).collect::<BTreeSet<_>>();
    if rescanned != expected {
        return Err("HOST_KEY_CHANGED_DURING_TRUST: The server host key changed before it could be saved. Connection was not trusted.".into());
    }

    let path = ensure_ssh_dir()?;
    let token = known_host_token(server);
    let existing = known_keys(server)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&path)
        .map_err(|error| format!("Could not open {}: {error}", path.display()))?;

    for key in scanned.iter().filter(|key| !existing.contains(*key)) {
        writeln!(file, "{} {} {}", token, key.key_type, key.key_data)
            .map_err(|error| format!("Could not update {}: {error}", path.display()))?;
    }
    file.flush().map_err(|error| format!("Could not flush {}: {error}", path.display()))?;

    let verified = check(server)?;
    if verified.state != HostKeyState::Trusted {
        return Err("HOST_KEY_TRUST_FAILED: The host key was written but OpenSSH could not verify it afterward.".into());
    }
    Ok(verified)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_handles_known_hosts_markers_and_plain_lines() {
        let plain = parse_key_fields("example.com ssh-ed25519 AAAATEST").unwrap();
        assert_eq!(plain.key_type, "ssh-ed25519");
        assert_eq!(plain.key_data, "AAAATEST");

        let marked = parse_key_fields("@cert-authority *.example.com ssh-ed25519 BBBTEST").unwrap();
        assert_eq!(marked.key_type, "ssh-ed25519");
        assert_eq!(marked.key_data, "BBBTEST");
    }
}
