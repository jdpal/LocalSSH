use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::Mutex,
    thread,
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::server::ServerProfile;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
}

#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: String,
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

pub fn build_ssh_args(server: &ServerProfile) -> Vec<String> {
    let mut args = vec!["-p".to_string(), server.port.to_string()];
    if let Some(identity) = server.identity_file.as_deref().filter(|v| !v.trim().is_empty()) {
        args.push("-i".to_string());
        args.push(expand_tilde(identity.trim()));
    }
    args.push(format!("{}@{}", server.username, server.host));
    args
}

impl TerminalManager {
    pub fn start(&self, app: AppHandle, server: &ServerProfile, cols: u16, rows: u16) -> Result<String, String> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Could not create terminal: {e}"))?;

        let mut command = CommandBuilder::new("/usr/bin/ssh");
        for arg in build_ssh_args(server) {
            command.arg(arg);
        }

        let child = pair.slave.spawn_command(command)
            .map_err(|e| format!("Could not start /usr/bin/ssh: {e}"))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| format!("Could not read terminal: {e}"))?;
        let writer = pair.master.take_writer()
            .map_err(|e| format!("Could not write terminal: {e}"))?;

        let session_id = Uuid::new_v4().to_string();
        let event_session_id = session_id.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                        let _ = app.emit("terminal-output", TerminalOutput {
                            session_id: event_session_id.clone(),
                            data,
                        });
                    }
                    Err(_) => break,
                }
            }
            let _ = app.emit("terminal-exit", TerminalExit { session_id: event_session_id });
        });

        let session = TerminalSession { master: pair.master, writer, child };
        self.sessions.lock().map_err(|_| "Terminal session lock is unavailable".to_string())?
            .insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "Terminal session lock is unavailable".to_string())?;
        let session = sessions.get_mut(session_id).ok_or_else(|| "Terminal session not found".to_string())?;
        session.writer.write_all(data.as_bytes()).map_err(|e| format!("Could not write to terminal: {e}"))?;
        session.writer.flush().map_err(|e| format!("Could not flush terminal input: {e}"))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "Terminal session lock is unavailable".to_string())?;
        let session = sessions.get(session_id).ok_or_else(|| "Terminal session not found".to_string())?;
        session.master.resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Could not resize terminal: {e}"))
    }

    pub fn stop(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "Terminal session lock is unavailable".to_string())?;
        if let Some(mut session) = sessions.remove(session_id) {
            session.child.kill().map_err(|e| format!("Could not stop terminal: {e}"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(identity: Option<&str>) -> ServerProfile {
        ServerProfile {
            id: "1".into(), name: "Web".into(), host: "10.20.0.15".into(), port: 2222,
            username: "jd".into(), group_name: "Production".into(), favourite: false,
            identity_file: identity.map(str::to_string), last_connected_at: None,
        }
    }

    #[test]
    fn builds_direct_ssh_arguments_without_shell_text() {
        assert_eq!(build_ssh_args(&profile(None)), vec!["-p", "2222", "jd@10.20.0.15"]);
    }

    #[test]
    fn includes_identity_file_as_separate_arguments() {
        let args = build_ssh_args(&profile(Some("/tmp/test key")));
        assert_eq!(args, vec!["-p", "2222", "-i", "/tmp/test key", "jd@10.20.0.15"]);
    }
}
