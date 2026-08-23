use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::Duration,
};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;

use crate::{openssh, server::ServerProfile};

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

#[derive(Default)]
pub struct SftpManager;

impl SftpManager {
    pub fn close(&self, _server_id: &str) -> Result<(), String> { Ok(()) }
    pub fn close_all(&self) {}
}

fn quote_sftp(value: &str) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err("SFTP_UNSAFE_PATH: File paths containing control characters are not supported".into());
    }
    Ok(format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\"")))
}

fn remote_join(dir: &str, name: &str) -> String {
    if dir == "/" { format!("/{name}") } else { format!("{}/{name}", dir.trim_end_matches('/')) }
}

fn classify_transport_error(output: &str) -> String {
    let lower = output.to_lowercase();
    if lower.contains("host key verification failed") || lower.contains("no hostkey") {
        return "SFTP_HOST_KEY_FAILED: Host key verification failed. Connect in Terminal first and verify the host key.".into();
    }
    if lower.contains("connection refused") || lower.contains("connection timed out") || lower.contains("could not resolve hostname") || lower.contains("connection closed") {
        return format!("SFTP_CONNECTION_FAILED: {}", output.trim());
    }
    format!("SFTP_COMMAND_FAILED: {}", output.trim())
}

fn run_sftp_command(
    server: &ServerProfile,
    username: &str,
    password: Option<&str>,
    sftp_command: &str,
) -> Result<String, String> {
    let pty = native_pty_system();
    let pair = pty.openpty(PtySize { rows: 28, cols: 160, pixel_width: 0, pixel_height: 0 })
        .map_err(|error| format!("Could not create SFTP terminal: {error}"))?;

    let mut command = CommandBuilder::new("/usr/bin/sftp");
    for arg in openssh::sftp_args(server, username) { command.arg(arg); }
    let mut child = pair.slave.spawn_command(command)
        .map_err(|error| format!("Could not start /usr/bin/sftp: {error}"))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()
        .map_err(|error| format!("Could not read SFTP process: {error}"))?;
    let mut writer = pair.master.take_writer()
        .map_err(|error| format!("Could not write SFTP process: {error}"))?;

    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if tx.send(String::from_utf8_lossy(&buffer[..count]).to_string()).is_err() { break; }
                }
            }
        }
    });

    let mut transcript = String::new();
    let mut command_output = String::new();
    let mut password_sent = false;
    let mut command_sent = false;

    for _ in 0..240 {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(chunk) => {
                transcript.push_str(&chunk.replace('\r', ""));
                let lower = transcript.to_lowercase();

                let password_prompts = lower.matches("password:").count();
                if (!password_sent && password_prompts >= 1) || (password_sent && password_prompts >= 2) {
                    if password_sent {
                        let _ = child.kill();
                        return Err("SFTP_AUTH_FAILED: Password was rejected".into());
                    }
                    let Some(value) = password.filter(|value| !value.is_empty()) else {
                        let _ = child.kill();
                        return Err("SFTP_AUTH_REQUIRED: No usable key, agent identity, or saved password was available".into());
                    };
                    writer.write_all(value.as_bytes()).map_err(|e| format!("Could not answer SFTP password prompt: {e}"))?;
                    writer.write_all(b"\n").map_err(|e| format!("Could not answer SFTP password prompt: {e}"))?;
                    writer.flush().map_err(|e| format!("Could not answer SFTP password prompt: {e}"))?;
                    password_sent = true;
                    transcript.clear();
                    continue;
                }

                if lower.contains("permission denied") || lower.contains("authentication failed") {
                    let _ = child.kill();
                    return Err("SFTP_AUTH_FAILED: Authentication failed".into());
                }

                if !command_sent {
                    if transcript.contains("sftp> ") || transcript.ends_with("sftp>") {
                        writer.write_all(sftp_command.as_bytes()).map_err(|e| format!("Could not send SFTP command: {e}"))?;
                        writer.write_all(b"\n").map_err(|e| format!("Could not send SFTP command: {e}"))?;
                        writer.flush().map_err(|e| format!("Could not send SFTP command: {e}"))?;
                        command_sent = true;
                        transcript.clear();
                    }
                    continue;
                }

                if let Some(prompt) = transcript.find("sftp> ").or_else(|| transcript.rfind("\nsftp>")) {
                    command_output.push_str(&transcript[..prompt]);
                    let _ = writer.write_all(b"quit\n");
                    let _ = writer.flush();
                    let _ = child.wait();
                    return Ok(clean_command_output(&command_output, sftp_command));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.wait();
                if command_sent && !transcript.trim().is_empty() {
                    return Err(classify_transport_error(&transcript));
                }
                return Err(classify_transport_error(&transcript));
            }
        }
    }

    let _ = child.kill();
    Err("SFTP_TIMEOUT: SFTP command did not complete within 60 seconds".into())
}

fn clean_command_output(output: &str, command: &str) -> String {
    output
        .lines()
        .filter(|line| line.trim() != command.trim())
        .filter(|line| !line.trim_start().starts_with("sftp>"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_ls_line(line: &str, parent: &str) -> Option<RemoteEntry> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("total ") || trimmed.starts_with("Can't ls") || trimmed.starts_with("Couldn't") { return None; }
    let mut iter = trimmed.split_whitespace();
    let mode = iter.next()?;
    if mode.len() < 10 { return None; }
    let _links = iter.next()?;
    let _uid = iter.next()?;
    let _gid = iter.next()?;
    let size = iter.next()?.parse::<u64>().ok();
    let _month = iter.next()?;
    let _day = iter.next()?;
    let _time_or_year = iter.next()?;
    let consumed = trimmed.split_whitespace().take(8).map(str::len).sum::<usize>();
    let mut seen = 0usize;
    let mut fields = 0usize;
    let bytes = trimmed.as_bytes();
    while seen < bytes.len() && fields < 8 {
        while seen < bytes.len() && bytes[seen].is_ascii_whitespace() { seen += 1; }
        while seen < bytes.len() && !bytes[seen].is_ascii_whitespace() { seen += 1; }
        fields += 1;
    }
    while seen < bytes.len() && bytes[seen].is_ascii_whitespace() { seen += 1; }
    let _ = consumed;
    let mut name = trimmed.get(seen..)?.trim().to_string();
    if let Some((left, _target)) = name.split_once(" -> ") { name = left.to_string(); }
    if name == "." || name == ".." || name.is_empty() { return None; }
    let kind = match mode.as_bytes().first().copied() {
        Some(b'd') => "directory",
        Some(b'l') => "symlink",
        _ => "file",
    }.to_string();
    Some(RemoteEntry { name: name.clone(), path: remote_join(parent, &name), kind, size, modified: None })
}

fn output_is_missing(output: &str) -> bool {
    let lower = output.to_lowercase();
    lower.contains("no such file") || lower.contains("not found") || lower.contains("can't ls") || lower.contains("couldn't stat")
}

fn remote_exists(server: &ServerProfile, username: &str, password: Option<&str>, remote_path: &str) -> Result<bool, String> {
    let output = run_sftp_command(server, username, password, &format!("ls -ld {}", quote_sftp(remote_path)?))?;
    Ok(!output_is_missing(&output))
}

pub fn list_remote(
    _manager: &SftpManager,
    server: &ServerProfile,
    username: &str,
    path: &str,
    password: Option<&str>,
) -> Result<Vec<RemoteEntry>, String> {
    let output = run_sftp_command(server, username, password, &format!("ls -lan {}", quote_sftp(path)?))?;
    if output_is_missing(&output) { return Err(format!("SFTP_PATH_NOT_FOUND: {path}")); }
    Ok(output.lines().filter_map(|line| parse_ls_line(line, path)).collect())
}

pub fn upload_remote(
    _manager: &SftpManager,
    server: &ServerProfile,
    username: &str,
    local_path: &Path,
    remote_dir: &str,
    password: Option<&str>,
    replace: bool,
) -> Result<RemoteUpload, String> {
    let metadata = fs::metadata(local_path).map_err(|e| format!("Could not read local file: {e}"))?;
    if metadata.is_dir() { return Err("SFTP_DIRECTORY_UNSUPPORTED: Folder upload is not supported yet".into()); }
    let name = local_path.file_name().and_then(|v| v.to_str()).ok_or_else(|| "Could not determine local filename".to_string())?.to_string();
    let remote_path = remote_join(remote_dir, &name);
    if !replace && remote_exists(server, username, password, &remote_path)? {
        return Err(format!("SFTP_FILE_EXISTS:{remote_path}"));
    }
    let command = format!("put {} {}", quote_sftp(&local_path.to_string_lossy())?, quote_sftp(&remote_path)?);
    let output = run_sftp_command(server, username, password, &command)?;
    if output.to_lowercase().contains("failure") || output.to_lowercase().contains("permission denied") {
        return Err(format!("SFTP_UPLOAD_FAILED: {}", output.trim()));
    }
    Ok(RemoteUpload { name, path: remote_path, size: metadata.len() })
}

pub fn download_remote(
    _manager: &SftpManager,
    server: &ServerProfile,
    username: &str,
    remote_path: &str,
    local_dir: &Path,
    password: Option<&str>,
) -> Result<RemoteDownload, String> {
    let name = Path::new(remote_path).file_name().and_then(|v| v.to_str())
        .ok_or_else(|| "Could not determine remote filename".to_string())?.to_string();
    let local_path = local_dir.join(&name);
    if local_path.exists() { return Err(format!("SFTP_LOCAL_FILE_EXISTS:{}", local_path.display())); }
    let command = format!("get {} {}", quote_sftp(remote_path)?, quote_sftp(&local_path.to_string_lossy())?);
    let output = run_sftp_command(server, username, password, &command)?;
    if output.to_lowercase().contains("not a regular file") || output.to_lowercase().contains("is a directory") {
        return Err("SFTP_DIRECTORY_DOWNLOAD_UNSUPPORTED: Folder download is not supported yet".into());
    }
    if output.to_lowercase().contains("failure") || output.to_lowercase().contains("permission denied") {
        return Err(format!("SFTP_DOWNLOAD_FAILED: {}", output.trim()));
    }
    let size = fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);
    Ok(RemoteDownload { name, path: local_path.display().to_string(), size })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_long_listing_with_spaces() {
        let line = "-rw-r--r-- 1 501 20 42 Aug 23 12:34 hello world.txt";
        let entry = parse_ls_line(line, "/tmp").expect("entry");
        assert_eq!(entry.name, "hello world.txt");
        assert_eq!(entry.path, "/tmp/hello world.txt");
        assert_eq!(entry.kind, "file");
        assert_eq!(entry.size, Some(42));
    }

    #[test]
    fn rejects_control_characters_in_sftp_paths() {
        assert!(quote_sftp("/safe/path").is_ok());
        assert!(quote_sftp("/tmp/evil\n!rm -rf /").is_err());
        assert!(quote_sftp("/tmp/evil\rquit").is_err());
    }

    #[test]
    fn sftp_quotes_paths() {
        assert_eq!(quote_sftp("a b\"c").unwrap(), "\"a b\\\"c\"");
    }
}
