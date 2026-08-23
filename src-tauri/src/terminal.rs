use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{openssh, server::ServerProfile};

const CONNECTED_MARKER: &str = "__LOCALSSH_CONNECTED__";

type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: SharedWriter,
    child: Box<dyn Child + Send>,
}

#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl Drop for TerminalManager {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.get_mut() {
            for (_, mut session) in sessions.drain() {
                let _ = session.child.kill();
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput { session_id: String, data: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit { session_id: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalConnected { session_id: String }

pub fn build_ssh_args(server: &ServerProfile) -> Vec<String> {
    let mut args = openssh::ssh_args(server);
    let target = args.pop().expect("OpenSSH target");
    args.push("-o".to_string());
    args.push("PermitLocalCommand=yes".to_string());
    args.push("-o".to_string());
    args.push(format!("LocalCommand=/usr/bin/printf {CONNECTED_MARKER}"));
    args.push(target);
    args
}

fn marker_tail_len(value: &str) -> usize {
    let max = CONNECTED_MARKER.len().saturating_sub(1).min(value.len());
    (1..=max).rev().find(|len| value.ends_with(&CONNECTED_MARKER[..*len])).unwrap_or(0)
}

impl TerminalManager {
    pub fn start(&self, app: AppHandle, server: &ServerProfile, cols: u16, rows: u16, password: Option<String>) -> Result<String, String> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Could not create terminal: {e}"))?;

        let mut command = CommandBuilder::new("/usr/bin/ssh");
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "LocalSSH");
        for arg in build_ssh_args(server) { command.arg(arg); }
        let child = pair.slave.spawn_command(command).map_err(|e| format!("Could not start /usr/bin/ssh: {e}"))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| format!("Could not read terminal: {e}"))?;
        let writer: SharedWriter = Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| format!("Could not write terminal: {e}"))?));

        let session_id = Uuid::new_v4().to_string();
        let event_session_id = session_id.clone();
        let reader_writer = Arc::clone(&writer);
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            let mut marker_tail = String::new();
            let mut auth_tail = String::new();
            let mut connected = false;
            let mut password_sent = false;

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        let chunk = String::from_utf8_lossy(&buffer[..count]).to_string();
                        let mut combined = format!("{marker_tail}{chunk}");
                        marker_tail.clear();

                        if combined.contains(CONNECTED_MARKER) {
                            combined = combined.replace(CONNECTED_MARKER, "");
                            if !connected {
                                connected = true;
                                let _ = app.emit("terminal-connected", TerminalConnected { session_id: event_session_id.clone() });
                            }
                        }

                        let tail_len = marker_tail_len(&combined);
                        if tail_len > 0 {
                            let split_at = combined.len() - tail_len;
                            marker_tail = combined[split_at..].to_string();
                            combined.truncate(split_at);
                        }

                        if !connected && !password_sent {
                            let auth_probe = format!("{auth_tail}{combined}").to_lowercase();
                            if auth_probe.contains("password:") {
                                if let Some(value) = password.as_deref().filter(|value| !value.is_empty()) {
                                    if let Ok(mut input) = reader_writer.lock() {
                                        let _ = input.write_all(value.as_bytes());
                                        let _ = input.write_all(b"\n");
                                        let _ = input.flush();
                                        password_sent = true;
                                    }
                                }
                            }
                            auth_tail = auth_probe.chars().rev().take(128).collect::<String>().chars().rev().collect();
                        }

                        if !combined.is_empty() {
                            let _ = app.emit("terminal-output", TerminalOutput { session_id: event_session_id.clone(), data: combined });
                        }
                    }
                    Err(_) => break,
                }
            }
            if !marker_tail.is_empty() && marker_tail != CONNECTED_MARKER {
                let _ = app.emit("terminal-output", TerminalOutput { session_id: event_session_id.clone(), data: marker_tail });
            }
            let _ = app.emit("terminal-exit", TerminalExit { session_id: event_session_id });
        });

        let session = TerminalSession { master: pair.master, writer, child };
        self.sessions.lock().map_err(|_| "Terminal session lock is unavailable".to_string())?.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "Terminal session lock is unavailable".to_string())?;
        let session = sessions.get(session_id).ok_or_else(|| "Terminal session not found".to_string())?;
        let mut writer = session.writer.lock().map_err(|_| "Terminal writer lock is unavailable".to_string())?;
        writer.write_all(data.as_bytes()).map_err(|e| format!("Could not write to terminal: {e}"))?;
        writer.flush().map_err(|e| format!("Could not flush terminal input: {e}"))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "Terminal session lock is unavailable".to_string())?;
        let session = sessions.get(session_id).ok_or_else(|| "Terminal session not found".to_string())?;
        session.master.resize(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 }).map_err(|e| format!("Could not resize terminal: {e}"))
    }

    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut session) in sessions.drain() { let _ = session.child.kill(); }
        }
    }

    pub fn stop(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "Terminal session lock is unavailable".to_string())?;
        if let Some(mut session) = sessions.remove(session_id) { session.child.kill().map_err(|e| format!("Could not stop terminal: {e}"))?; }
        Ok(())
    }
}
