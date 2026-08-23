use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileGrant {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryGrant {
    pub id: String,
    pub name: String,
}

#[derive(Default)]
pub struct FileGrantStore {
    files: Mutex<HashMap<String, PathBuf>>,
    directories: Mutex<HashMap<String, PathBuf>>,
}

impl FileGrantStore {
    pub fn register_files<I>(&self, paths: I) -> Result<Vec<LocalFileGrant>, String>
    where I: IntoIterator<Item = PathBuf> {
        let mut store = self.files.lock().map_err(|_| "Local file grant lock is unavailable".to_string())?;
        let mut grants = Vec::new();
        for path in paths {
            if !path.is_file() { continue; }
            let id = Uuid::new_v4().to_string();
            let name = display_name(&path);
            store.insert(id.clone(), path);
            grants.push(LocalFileGrant { id, name });
        }
        Ok(grants)
    }

    pub fn register_directory(&self, path: PathBuf) -> Result<LocalDirectoryGrant, String> {
        if !path.is_dir() { return Err("Selected download destination is not a directory".into()); }
        let id = Uuid::new_v4().to_string();
        let name = display_name(&path);
        self.directories.lock().map_err(|_| "Local directory grant lock is unavailable".to_string())?
            .insert(id.clone(), path);
        Ok(LocalDirectoryGrant { id, name })
    }

    pub fn resolve_file(&self, id: &str) -> Result<PathBuf, String> {
        self.files.lock().map_err(|_| "Local file grant lock is unavailable".to_string())?
            .get(id).cloned().ok_or_else(|| "LOCAL_FILE_GRANT_INVALID: Select or drop the file again".to_string())
    }

    pub fn resolve_directory(&self, id: &str) -> Result<PathBuf, String> {
        self.directories.lock().map_err(|_| "Local directory grant lock is unavailable".to_string())?
            .get(id).cloned().ok_or_else(|| "LOCAL_DIRECTORY_GRANT_INVALID: Choose the destination folder again".to_string())
    }

    pub fn clear(&self) {
        if let Ok(mut files) = self.files.lock() { files.clear(); }
        if let Ok(mut directories) = self.directories.lock() { directories.clear(); }
    }
}

fn display_name(path: &Path) -> String {
    path.file_name().and_then(|name| name.to_str()).filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_str().unwrap_or("Selected item"))
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arbitrary_ids_do_not_resolve() {
        let store = FileGrantStore::default();
        assert!(store.resolve_file("/Users/example/.ssh/id_ed25519").is_err());
        assert!(store.resolve_directory("/Users/example").is_err());
    }
}
