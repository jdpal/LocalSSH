mod db;
mod file_grants;
mod host_keys;
mod keychain;
mod openssh;
mod server;
mod sftp;
mod terminal;

use std::{path::PathBuf, process::Command};

use tauri::{Emitter, Manager, State};

use db::Database;
use file_grants::{FileGrantStore, LocalDirectoryGrant, LocalFileGrant};
use host_keys::HostKeyCheck;
use keychain::{CredentialKind, CredentialStore};
use server::{ServerInput, ServerProfile};
use sftp::{RemoteDownload, RemoteEntry, RemoteUpload, SftpManager};
use terminal::TerminalManager;

pub struct AppState {
    db: Database,
    terminals: TerminalManager,
    credentials: CredentialStore,
    sftp: SftpManager,
    grants: FileGrantStore,
}

fn with_credential_flags(state: &AppState, mut server: ServerProfile) -> Result<ServerProfile, String> {
    server.has_ssh_password = state.credentials.get(&server.id, CredentialKind::Ssh)?.is_some();
    server.has_sftp_password = state.credentials.get(&server.id, CredentialKind::Sftp)?.is_some();
    Ok(server)
}

#[tauri::command]
fn list_servers(state: State<'_, AppState>) -> Result<Vec<ServerProfile>, String> {
    state.db.list_servers()?.into_iter().map(|server| with_credential_flags(state.inner(), server)).collect()
}

#[tauri::command]
fn upsert_server(
    state: State<'_, AppState>, input: ServerInput, ssh_password: Option<String>, clear_ssh_password: bool,
    sftp_password: Option<String>, clear_sftp_password: bool,
) -> Result<ServerProfile, String> {
    let saved = state.db.upsert_server(input)?;
    if clear_ssh_password {
        state.credentials.delete(&saved.id, CredentialKind::Ssh)?;
    } else if let Some(password) = ssh_password.as_deref().filter(|value| !value.is_empty()) {
        state.credentials.set(&saved.id, CredentialKind::Ssh, password)?;
    }
    if saved.use_ssh_credentials_for_sftp {
        state.credentials.delete(&saved.id, CredentialKind::Sftp)?;
    } else if clear_sftp_password {
        state.credentials.delete(&saved.id, CredentialKind::Sftp)?;
    } else if let Some(password) = sftp_password.as_deref().filter(|value| !value.is_empty()) {
        state.credentials.set(&saved.id, CredentialKind::Sftp, password)?;
    }
    with_credential_flags(state.inner(), saved)
}

#[tauri::command]
fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.sftp.close(&id)?;
    state.credentials.delete_server(&id)?;
    state.db.delete_server(&id)
}

#[tauri::command]
fn clear_local_data(state: State<'_, AppState>) -> Result<(), String> {
    state.terminals.close_all();
    state.sftp.close_all();
    for server in state.db.list_servers()? { state.credentials.delete_server(&server.id)?; }
    state.db.clear_servers()?;
    state.grants.clear();
    Ok(())
}


#[tauri::command]
fn host_key_check(state: State<'_, AppState>, server_id: String) -> Result<HostKeyCheck, String> {
    let server = state.db.get_server(&server_id)?;
    host_keys::check(&server)
}

#[tauri::command]
fn host_key_trust(state: State<'_, AppState>, server_id: String, expected_fingerprints: Vec<String>) -> Result<HostKeyCheck, String> {
    let server = state.db.get_server(&server_id)?;
    host_keys::trust(&server, &expected_fingerprints)
}

#[tauri::command]
fn start_ssh(app: tauri::AppHandle, state: State<'_, AppState>, server_id: String, cols: u16, rows: u16) -> Result<String, String> {
    let server = state.db.get_server(&server_id)?;
    let password = state.credentials.get(&server_id, CredentialKind::Ssh)?;
    let session_id = state.terminals.start(app, &server, cols, rows, password)?;
    let _ = state.db.mark_connected(&server_id);
    Ok(session_id)
}

#[tauri::command]
fn write_ssh(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> { state.terminals.write(&session_id, &data) }

#[tauri::command]
fn resize_ssh(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> { state.terminals.resize(&session_id, cols, rows) }

#[tauri::command]
fn stop_ssh(state: State<'_, AppState>, session_id: String) -> Result<(), String> { state.terminals.stop(&session_id) }

#[tauri::command]
fn sftp_close(state: State<'_, AppState>, server_id: String) -> Result<(), String> { state.sftp.close(&server_id) }

fn sftp_password(state: &AppState, server: &ServerProfile, manual: Option<String>) -> Result<Option<String>, String> {
    if manual.as_deref().is_some_and(|value| !value.is_empty()) { return Ok(manual); }
    let kind = if server.use_ssh_credentials_for_sftp { CredentialKind::Ssh } else { CredentialKind::Sftp };
    state.credentials.get(&server.id, kind)
}

#[tauri::command]
fn sftp_list(state: State<'_, AppState>, server_id: String, path: String, password: Option<String>) -> Result<Vec<RemoteEntry>, String> {
    let server = state.db.get_server(&server_id)?;
    let username = server.sftp_username().to_string();
    let credential = sftp_password(state.inner(), &server, password)?;
    sftp::list_remote(&state.sftp, &server, &username, &path, credential.as_deref())
}

#[tauri::command]
fn sftp_upload(
    state: State<'_, AppState>, server_id: String, local_file_id: String, remote_dir: String,
    password: Option<String>, replace: bool,
) -> Result<RemoteUpload, String> {
    let server = state.db.get_server(&server_id)?;
    let username = server.sftp_username().to_string();
    let credential = sftp_password(state.inner(), &server, password)?;
    let local_path = state.grants.resolve_file(&local_file_id)?;
    sftp::upload_remote(&state.sftp, &server, &username, &local_path, &remote_dir, credential.as_deref(), replace)
}

#[tauri::command]
fn sftp_download(
    state: State<'_, AppState>, server_id: String, remote_path: String, local_directory_id: String,
    password: Option<String>,
) -> Result<RemoteDownload, String> {
    let server = state.db.get_server(&server_id)?;
    let username = server.sftp_username().to_string();
    let credential = sftp_password(state.inner(), &server, password)?;
    let local_dir = state.grants.resolve_directory(&local_directory_id)?;
    sftp::download_remote(&state.sftp, &server, &username, &remote_path, &local_dir, credential.as_deref())
}

#[tauri::command]
fn pick_download_directory(state: State<'_, AppState>) -> Result<Option<LocalDirectoryGrant>, String> {
    #[cfg(target_os = "macos")]
    {
        let script = r#"set selectedFolder to choose folder with prompt "Choose download destination"
return POSIX path of selectedFolder"#;
        let output = Command::new("/usr/bin/osascript").arg("-e").arg(script).output()
            .map_err(|e| format!("Could not open the macOS folder picker: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("User canceled") || stderr.contains("-128") { return Ok(None); }
            return Err(format!("Folder picker failed: {}", stderr.trim()));
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() { return Ok(None); }
        return state.grants.register_directory(PathBuf::from(path)).map(Some);
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = state; Err("LocalSSH download destination picking is currently supported on macOS only".into()) }
}

#[tauri::command]
fn pick_local_files(state: State<'_, AppState>) -> Result<Vec<LocalFileGrant>, String> {
    #[cfg(target_os = "macos")]
    {
        let script = r#"set selectedFiles to choose file with prompt "Choose files to upload" with multiple selections allowed
set outputText to ""
repeat with selectedFile in selectedFiles
set outputText to outputText & POSIX path of selectedFile & linefeed
end repeat
return outputText"#;
        let output = Command::new("/usr/bin/osascript").arg("-e").arg(script).output()
            .map_err(|e| format!("Could not open the macOS file picker: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("User canceled") || stderr.contains("-128") { return Ok(Vec::new()); }
            return Err(format!("File picker failed: {}", stderr.trim()));
        }
        let paths = String::from_utf8_lossy(&output.stdout).lines().map(str::trim).filter(|line| !line.is_empty())
            .map(PathBuf::from).collect::<Vec<_>>();
        return state.grants.register_files(paths);
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = state; Err("LocalSSH file picking is currently supported on macOS only".into()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let db = Database::open(&app_data.join("localssh.sqlite3")).map_err(std::io::Error::other)?;
            app.manage(AppState { db, terminals: TerminalManager::default(), credentials: CredentialStore, sftp: SftpManager, grants: FileGrantStore::default() });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let state = window.state::<AppState>();
                if let Ok(grants) = state.grants.register_files(paths.clone()) {
                    let _ = window.emit("local-files-dropped", grants);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_servers, upsert_server, delete_server, clear_local_data,
            host_key_check, host_key_trust,
            start_ssh, write_ssh, resize_ssh, stop_ssh,
            sftp_close, sftp_list, sftp_upload, sftp_download,
            pick_local_files, pick_download_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running LocalSSH");
}
