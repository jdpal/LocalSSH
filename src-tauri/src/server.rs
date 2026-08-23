use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group_name: String,
    pub favourite: bool,
    pub identity_file: Option<String>,
    pub sftp_username: Option<String>,
    pub use_ssh_credentials_for_sftp: bool,
    pub has_ssh_password: bool,
    pub has_sftp_password: bool,
    pub last_connected_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group_name: String,
    pub favourite: bool,
    pub identity_file: Option<String>,
    pub sftp_username: Option<String>,
    pub use_ssh_credentials_for_sftp: bool,
}

fn validate_text(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() { return Err(format!("{label} is required")); }
    if value.contains(['\n', '\r', '\0']) { return Err(format!("{label} contains an invalid control character")); }
    Ok(())
}

pub fn validate_server(input: &ServerInput) -> Result<(), String> {
    validate_text("Name", &input.name)?;
    validate_text("Host", &input.host)?;
    validate_text("SSH username", &input.username)?;
    validate_text("Group", &input.group_name)?;
    if input.port == 0 { return Err("Port must be between 1 and 65535".into()); }
    if let Some(identity) = &input.identity_file {
        if identity.contains(['\n', '\r', '\0']) { return Err("Identity file contains an invalid control character".into()); }
    }
    if !input.use_ssh_credentials_for_sftp {
        validate_text("SFTP username", input.sftp_username.as_deref().unwrap_or(""))?;
    }
    Ok(())
}

impl ServerProfile {
    pub fn sftp_username(&self) -> &str {
        if self.use_ssh_credentials_for_sftp { &self.username } else { self.sftp_username.as_deref().filter(|v| !v.trim().is_empty()).unwrap_or(&self.username) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> ServerInput { ServerInput { id: None, name:"Web-01".into(), host:"10.20.0.15".into(), port:22, username:"jd".into(), group_name:"Production".into(), favourite:true, identity_file:None, sftp_username:None, use_ssh_credentials_for_sftp:true } }
    #[test] fn accepts_shared_credentials_without_sftp_username(){ assert_eq!(validate_server(&input()), Ok(())); }
    #[test] fn separate_credentials_require_sftp_username(){ let mut v=input(); v.use_ssh_credentials_for_sftp=false; assert!(validate_server(&v).is_err()); }
}
