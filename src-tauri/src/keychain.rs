const SERVICE: &str = "com.localssh.credentials";
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

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
            use security_framework::passwords::{generic_password, PasswordOptions};
            let account = Self::account(server_id, kind);
            return match generic_password(PasswordOptions::new_generic_password(SERVICE, &account)) {
                Ok(bytes) => String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|_| "Saved Keychain password is not valid UTF-8".to_string()),
                Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
                Err(error) => Err(format!("Could not read macOS Keychain: {error}")),
            };
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
            use security_framework::passwords::set_generic_password;
            let account = Self::account(server_id, kind);
            return set_generic_password(SERVICE, &account, password.as_bytes())
                .map_err(|error| format!("Could not save password to macOS Keychain: {error}"));
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
            use security_framework::passwords::delete_generic_password;
            let account = Self::account(server_id, kind);
            return match delete_generic_password(SERVICE, &account) {
                Ok(()) => Ok(()),
                Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
                Err(error) => Err(format!("Could not update macOS Keychain: {error}")),
            };
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
