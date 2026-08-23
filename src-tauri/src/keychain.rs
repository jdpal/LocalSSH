use std::process::Command;

const SERVICE: &str = "com.localssh.credentials";

#[derive(Debug, Clone, Copy)]
pub enum CredentialKind {
    Ssh,
    Sftp,
}

#[derive(Default)]
pub struct CredentialStore;

impl CredentialStore {
    fn account(server_id: &str, kind: CredentialKind) -> String {
        let suffix = match kind { CredentialKind::Ssh => "ssh", CredentialKind::Sftp => "sftp" };
        format!("server:{server_id}:{suffix}")
    }

    pub fn get(&self, server_id: &str, kind: CredentialKind) -> Result<Option<String>, String> {
        #[cfg(target_os = "macos")]
        {
            let account = Self::account(server_id, kind);
            let output = Command::new("/usr/bin/security")
                .args(["find-generic-password", "-a", &account, "-s", SERVICE, "-w"])
                .output()
                .map_err(|e| format!("Could not read macOS Keychain: {e}"))?;
            if !output.status.success() { return Ok(None); }
            return Ok(Some(String::from_utf8_lossy(&output.stdout).trim_end_matches(|c| c == '\r' || c == '\n').to_string()));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (server_id, kind);
            Ok(None)
        }
    }

    pub fn set(&self, server_id: &str, kind: CredentialKind, password: &str) -> Result<(), String> {
        if password.is_empty() { return self.delete(server_id, kind); }
        #[cfg(target_os = "macos")]
        {
            let account = Self::account(server_id, kind);
            let output = Command::new("/usr/bin/security")
                .args(["add-generic-password", "-U", "-a", &account, "-s", SERVICE, "-l", "LocalSSH saved server password", "-w", password])
                .output()
                .map_err(|e| format!("Could not save password to macOS Keychain: {e}"))?;
            if output.status.success() { return Ok(()); }
            return Err(format!("Could not save password to macOS Keychain: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (server_id, kind, password);
            Err("Saved passwords are supported on macOS only".into())
        }
    }

    pub fn delete(&self, server_id: &str, kind: CredentialKind) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let account = Self::account(server_id, kind);
            let _ = Command::new("/usr/bin/security")
                .args(["delete-generic-password", "-a", &account, "-s", SERVICE])
                .output()
                .map_err(|e| format!("Could not update macOS Keychain: {e}"))?;
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (server_id, kind);
            Ok(())
        }
    }

    pub fn delete_server(&self, server_id: &str) -> Result<(), String> {
        self.delete(server_id, CredentialKind::Ssh)?;
        self.delete(server_id, CredentialKind::Sftp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_separate_keychain_accounts_for_ssh_and_sftp() {
        assert_eq!(CredentialStore::account("abc", CredentialKind::Ssh), "server:abc:ssh");
        assert_eq!(CredentialStore::account("abc", CredentialKind::Sftp), "server:abc:sftp");
    }
}
