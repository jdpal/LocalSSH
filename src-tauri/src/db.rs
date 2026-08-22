use std::{fs, path::Path, sync::Mutex};

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::server::{validate_server, ServerInput, ServerProfile};

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not create app data directory: {e}"))?;
        }
        let conn = Connection::open(path).map_err(|e| format!("Could not open LocalSSH database: {e}"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS servers (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                group_name TEXT NOT NULL,
                favourite INTEGER NOT NULL DEFAULT 0,
                identity_file TEXT,
                last_connected_at TEXT
            );"
        ).map_err(|e| format!("Could not initialise LocalSSH database: {e}"))?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn list_servers(&self) -> Result<Vec<ServerProfile>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock is unavailable".to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, host, port, username, group_name, favourite, identity_file, last_connected_at
             FROM servers ORDER BY group_name COLLATE NOCASE, favourite DESC, name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok(ServerProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, i64>(3)? as u16,
                username: row.get(4)?,
                group_name: row.get(5)?,
                favourite: row.get::<_, i64>(6)? != 0,
                identity_file: row.get(7)?,
                last_connected_at: row.get(8)?,
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_server(&self, id: &str) -> Result<ServerProfile, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock is unavailable".to_string())?;
        conn.query_row(
            "SELECT id, name, host, port, username, group_name, favourite, identity_file, last_connected_at FROM servers WHERE id = ?1",
            [id],
            |row| Ok(ServerProfile {
                id: row.get(0)?, name: row.get(1)?, host: row.get(2)?, port: row.get::<_, i64>(3)? as u16,
                username: row.get(4)?, group_name: row.get(5)?, favourite: row.get::<_, i64>(6)? != 0,
                identity_file: row.get(7)?, last_connected_at: row.get(8)?,
            })
        ).map_err(|_| "Server profile not found".to_string())
    }

    pub fn upsert_server(&self, input: ServerInput) -> Result<ServerProfile, String> {
        validate_server(&input)?;
        let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let identity = input.identity_file.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        });
        let conn = self.conn.lock().map_err(|_| "Database lock is unavailable".to_string())?;
        conn.execute(
            "INSERT INTO servers (id, name, host, port, username, group_name, favourite, identity_file)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, host=excluded.host, port=excluded.port,
             username=excluded.username, group_name=excluded.group_name, favourite=excluded.favourite, identity_file=excluded.identity_file",
            params![id, input.name.trim(), input.host.trim(), i64::from(input.port), input.username.trim(), input.group_name.trim(), input.favourite as i64, identity]
        ).map_err(|e| format!("Could not save server: {e}"))?;
        drop(conn);
        self.get_server(&id)
    }

    pub fn delete_server(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock is unavailable".to_string())?;
        conn.execute("DELETE FROM servers WHERE id = ?1", [id]).map_err(|e| format!("Could not delete server: {e}"))?;
        Ok(())
    }

    pub fn mark_connected(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock is unavailable".to_string())?;
        conn.execute("UPDATE servers SET last_connected_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?1", [id])
            .map_err(|e| format!("Could not update recent connection: {e}"))?;
        Ok(())
    }
}
