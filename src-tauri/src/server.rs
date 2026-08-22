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
}

fn validate_text(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.contains(['\n', '\r', '\0']) {
        return Err(format!("{label} contains an invalid control character"));
    }
    Ok(())
}

pub fn validate_server(input: &ServerInput) -> Result<(), String> {
    validate_text("Name", &input.name)?;
    validate_text("Host", &input.host)?;
    validate_text("Username", &input.username)?;
    validate_text("Group", &input.group_name)?;
    if input.port == 0 {
        return Err("Port must be between 1 and 65535".into());
    }
    if let Some(identity) = &input.identity_file {
        if identity.contains(['\n', '\r', '\0']) {
            return Err("Identity file contains an invalid control character".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ServerInput {
        ServerInput {
            id: None,
            name: "Web-01".into(),
            host: "10.20.0.15".into(),
            port: 22,
            username: "jd".into(),
            group_name: "Production".into(),
            favourite: true,
            identity_file: Some("~/.ssh/id_ed25519".into()),
        }
    }

    #[test]
    fn accepts_valid_server_profile() {
        assert_eq!(validate_server(&input()), Ok(()));
    }

    #[test]
    fn rejects_blank_host() {
        let mut value = input();
        value.host = "  ".into();
        assert_eq!(validate_server(&value), Err("Host is required".into()));
    }

    #[test]
    fn rejects_newline_in_host() {
        let mut value = input();
        value.host = "host\n-oProxyCommand=bad".into();
        assert!(validate_server(&value).is_err());
    }

    #[test]
    fn rejects_zero_port() {
        let mut value = input();
        value.port = 0;
        assert_eq!(validate_server(&value), Err("Port must be between 1 and 65535".into()));
    }
}
