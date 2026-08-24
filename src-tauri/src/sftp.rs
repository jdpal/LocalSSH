use std::{
    fs,
    io::{Read, Write},
    path::Path,
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


fn quote_sftp_literal(value: &str) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err("SFTP_UNSAFE_PATH: File paths containing control characters are not supported".into());
    }

    let mut escaped = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '*' | '?' | '[' | ']' | '{' | '}' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            _ => escaped.push(ch),
        }
    }

    Ok(format!("\"{escaped}\""))
}

fn normalize_remote_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.trim().split('/') {
        match part {
            "" | "." => {},
            ".." => { parts.pop(); },
            value => parts.push(value),
        }
    }
    if parts.is_empty() { "/".into() } else { format!("/{}", parts.join("/")) }
}

fn remote_join(dir: &str, name: &str) -> String {
    normalize_remote_path(&format!("{}/{}", normalize_remote_path(dir).trim_end_matches('/'), name.trim_start_matches('/')))
}

fn remote_parent_path(path: &str) -> String {
    let canonical = normalize_remote_path(path);
    if canonical == "/" { return "/".into(); }
    let mut parts: Vec<&str> = canonical.split('/').filter(|part| !part.is_empty()).collect();
    parts.pop();
    if parts.is_empty() { "/".into() } else { format!("/{}", parts.join("/")) }
}

fn remote_entry_path(parent: &str, raw_name: &str) -> (String, String) {
    let parent = normalize_remote_path(parent);
    let raw = raw_name.trim();

    let path = if raw.starts_with('/') {
        normalize_remote_path(raw)
    } else {
        let candidate = normalize_remote_path(&format!("/{raw}"));
        let parent_relative = parent.trim_start_matches('/');
        let candidate_relative = candidate.trim_start_matches('/');
        if !parent_relative.is_empty()
            && (candidate_relative == parent_relative
                || candidate_relative.starts_with(&format!("{parent_relative}/")))
        {
            candidate
        } else {
            remote_join(&parent, raw)
        }
    };

    let name = path.rsplit('/').find(|part| !part.is_empty()).unwrap_or("/").to_string();
    (name, path)
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
    let mut raw_name = trimmed.get(seen..)?.trim().to_string();
    if let Some((left, _target)) = raw_name.split_once(" -> ") { raw_name = left.to_string(); }
    if raw_name == "." || raw_name == ".." || raw_name.is_empty() { return None; }
    let (name, path) = remote_entry_path(parent, &raw_name);
    let canonical_parent = normalize_remote_path(parent);
    if path == canonical_parent || path == remote_parent_path(&canonical_parent) { return None; }
    let kind = match mode.as_bytes().first().copied() {
        Some(b'd') => "directory",
        Some(b'l') => "symlink",
        _ => "file",
    }.to_string();
    Some(RemoteEntry { name, path, kind, size, modified: None })
}

fn output_is_missing(output: &str) -> bool {
    let lower = output.to_lowercase();
    lower.contains("no such file") || lower.contains("not found") || lower.contains("can't ls") || lower.contains("couldn't stat")
}

fn looks_like_long_listing_entry(line: &str) -> bool {
    let Some(mode) = line.trim().split_whitespace().next() else { return false; };
    mode.len() >= 10 && matches!(mode.as_bytes().first().copied(), Some(b'-' | b'd' | b'l' | b'c' | b'b' | b'p' | b's'))
}

fn remote_exists(server: &ServerProfile, username: &str, password: Option<&str>, remote_path: &str) -> Result<bool, String> {
    let canonical_path = normalize_remote_path(remote_path);
    let parent = remote_parent_path(&canonical_path);
    let output = run_sftp_command(
        server,
        username,
        password,
        &format!("ls -lan {}", quote_sftp_literal(&parent)?),
    )?;

    if output_is_missing(&output) {
        return Err(format!(
            "SFTP_EXISTS_CHECK_FAILED: Could not inspect remote parent directory: {parent}. Server response: {}",
            output.trim()
        ));
    }

    let mut saw_listing_entry = false;
    for line in output.lines() {
        saw_listing_entry |= looks_like_long_listing_entry(line);
        if let Some(entry) = parse_ls_line(line, &parent) {
            if entry.path == canonical_path { return Ok(true); }
        }
    }

    if saw_listing_entry { return Ok(false); }

    Err(format!(
        "SFTP_EXISTS_CHECK_FAILED: Could not confirm whether the remote path exists: {canonical_path}. Server response: {}",
        output.trim()
    ))
}

pub fn list_remote(
    _manager: &SftpManager,
    server: &ServerProfile,
    username: &str,
    path: &str,
    password: Option<&str>,
) -> Result<Vec<RemoteEntry>, String> {
    let canonical_path = normalize_remote_path(path);
    let output = run_sftp_command(server, username, password, &format!("ls -lan {}", quote_sftp(&canonical_path)?))?;
    if output_is_missing(&output) { return Err(format!("SFTP_PATH_NOT_FOUND: {canonical_path}")); }
    Ok(output.lines().filter_map(|line| parse_ls_line(line, &canonical_path)).collect())
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
    let remote_path = remote_join(&normalize_remote_path(remote_dir), &name);
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
    let canonical_remote_path = normalize_remote_path(remote_path);
    let name = Path::new(&canonical_remote_path).file_name().and_then(|v| v.to_str())
        .ok_or_else(|| "Could not determine remote filename".to_string())?.to_string();
    let local_path = local_dir.join(&name);
    if local_path.exists() { return Err(format!("SFTP_LOCAL_FILE_EXISTS:{}", local_path.display())); }
    let command = format!("get {} {}", quote_sftp(&canonical_remote_path)?, quote_sftp(&local_path.to_string_lossy())?);
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

    #[test]
    fn normalizes_remote_paths_and_prefixed_listing_names() {
        assert_eq!(normalize_remote_path("/etc//ssh/"), "/etc/ssh");
        assert_eq!(normalize_remote_path("/etc/../var/log"), "/var/log");
        assert_eq!(remote_entry_path("/", "/etc"), ("etc".into(), "/etc".into()));
        assert_eq!(remote_entry_path("/etc", "/etc/ssh"), ("ssh".into(), "/etc/ssh".into()));
        assert_eq!(remote_entry_path("/etc", "etc/ssh"), ("ssh".into(), "/etc/ssh".into()));
    }

    #[test]
    fn parses_prefixed_sftp_listing_without_duplicating_parent_path() {
        let line = "drwxr-xr-x 2 0 0 4096 Aug 23 12:34 /etc/ssh";
        let entry = parse_ls_line(line, "/etc").expect("entry");
        assert_eq!(entry.name, "ssh");
        assert_eq!(entry.path, "/etc/ssh");
    }

    #[test]
    fn filters_absolute_dot_and_dot_dot_entries_after_normalization() {
        let current_dir_line = "drwxr-xr-x 2 1000 1000 4096 Aug 23 22:44 /home/jatin/Downloads/.";
        let parent_dir_line = "drwxr-xr-x 3 1000 1000 4096 Aug 18 11:48 /home/jatin/Downloads/..";
        assert!(parse_ls_line(current_dir_line, "/home/jatin/Downloads").is_none());
        assert!(parse_ls_line(parent_dir_line, "/home/jatin/Downloads").is_none());
    }

    #[test]
    fn keeps_real_children_even_when_their_name_matches_the_current_directory_basename() {
        let line = "drwxr-xr-x 2 1000 1000 4096 Aug 23 22:44 /home/jatin/Downloads/Downloads";
        let entry = parse_ls_line(line, "/home/jatin/Downloads").expect("entry");
        assert_eq!(entry.name, "Downloads");
        assert_eq!(entry.path, "/home/jatin/Downloads/Downloads");
    }

    #[test]
    fn literal_exists_probe_escapes_sftp_glob_characters() {
        assert_eq!(quote_sftp_literal("/tmp/report[1]*?.txt").unwrap(), "\"/tmp/report\\[1\\]\\*\\?.txt\"");
    }
    #[test]
    fn parent_listing_probe_recognizes_valid_long_entries() {
        assert!(looks_like_long_listing_entry("-rw-r--r-- 1 501 20 42 Aug 24 12:34 file.txt"));
        assert!(looks_like_long_listing_entry("drwxr-xr-x 2 501 20 64 Aug 24 12:34 folder"));
        assert!(!looks_like_long_listing_entry("ls: Invalid flag -d"));
        assert!(!looks_like_long_listing_entry("Failure"));
    }


    #[test]
    fn missing_output_is_recognized_without_treating_generic_failure_as_missing() {
        assert!(output_is_missing("Can't ls: No such file or directory"));
        assert!(!output_is_missing("Failure"));
        assert!(!output_is_missing("Permission denied"));
    }

}
