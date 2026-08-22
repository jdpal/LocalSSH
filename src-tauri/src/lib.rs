mod db;
mod server;
mod sftp;
mod terminal;

use tauri::{Manager, State};

use db::Database;
use server::{ServerInput, ServerProfile};
use sftp::RemoteEntry;
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
fn sftp_list(state: State<'_, AppState>, server_id: String, path: String) -> Result<Vec<RemoteEntry>, String> {
    let server = state.db.get_server(&server_id)?;
    sftp::list_remote(&server, &path)
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
            sftp_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running LocalSSH");
}
