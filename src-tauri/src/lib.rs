mod db;
mod server;
mod sftp;
mod terminal;

use std::process::Command;

use tauri::{Manager, State};

use db::Database;
use server::{ServerInput, ServerProfile};
use sftp::{RemoteEntry, RemoteUpload};
use terminal::TerminalManager;

pub struct AppState {
    db: Database,
    terminals: TerminalManager,
}

#[tauri::command]
fn list_servers(state: State<'_, AppState>) -> Result<Vec<ServerProfile>, String> {
    state.db.list_servers()
}

#[tauri::command]
fn upsert_server(state: State<'_, AppState>, input: ServerInput) -> Result<ServerProfile, String> {
    state.db.upsert_server(input)
}

#[tauri::command]
fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_server(&id)
}

#[tauri::command]
fn start_ssh(app: tauri::AppHandle, state: State<'_, AppState>, server_id: String, cols: u16, rows: u16) -> Result<String, String> {
    let server = state.db.get_server(&server_id)?;
    let session_id = state.terminals.start(app, &server, cols, rows)?;
    let _ = state.db.mark_connected(&server_id);
    Ok(session_id)
}

#[tauri::command]
fn write_ssh(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    state.terminals.write(&session_id, &data)
}

#[tauri::command]
fn resize_ssh(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.terminals.resize(&session_id, cols, rows)
}

#[tauri::command]
fn stop_ssh(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.terminals.stop(&session_id)
}

#[tauri::command]
fn sftp_list(state: State<'_, AppState>, server_id: String, path: String, password: Option<String>) -> Result<Vec<RemoteEntry>, String> {
    let server = state.db.get_server(&server_id)?;
    sftp::list_remote(&server, &path, password.as_deref())
}

#[tauri::command]
fn sftp_upload(
    state: State<'_, AppState>,
    server_id: String,
    local_path: String,
    remote_dir: String,
    password: Option<String>,
    replace: bool,
) -> Result<RemoteUpload, String> {
    let server = state.db.get_server(&server_id)?;
    sftp::upload_remote(&server, &local_path, &remote_dir, password.as_deref(), replace)
}

#[tauri::command]
fn pick_local_files() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let script = r#"
set selectedFiles to choose file with prompt "Choose files to upload" with multiple selections allowed
set outputText to ""
repeat with selectedFile in selectedFiles
    set outputText to outputText & POSIX path of selectedFile & linefeed
end repeat
return outputText
"#;
        let output = Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("Could not open the macOS file picker: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("User canceled") || stderr.contains("-128") {
                return Ok(Vec::new());
            }
            return Err(format!("File picker failed: {}", stderr.trim()));
        }
        return Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect());
    }

    #[cfg(not(target_os = "macos"))]
    Err("LocalSSH file picking is currently supported on macOS only".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let db = Database::open(&app_data.join("localssh.sqlite3"))
                .map_err(std::io::Error::other)?;
            app.manage(AppState { db, terminals: TerminalManager::default() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_servers,
            upsert_server,
            delete_server,
            start_ssh,
            write_ssh,
            resize_ssh,
            stop_ssh,
            sftp_list,
            sftp_upload,
            pick_local_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running LocalSSH");
}
