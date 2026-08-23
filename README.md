# LocalSSH

LocalSSH is a macOS-first desktop SSH and SFTP manager with a Termius-style interface. It stores server profiles locally, opens real `/usr/bin/ssh` sessions inside xterm.js, and uses the system OpenSSH `/usr/bin/sftp` client for file transfers.

## Features

- Saved servers, groups, favourites and search
- Multiple persistent SSH terminal tabs
- Multiple independent SFTP tabs
- Upload from the native macOS file picker or Finder drag-and-drop
- Download one or more remote files to a native macOS-selected folder
- Separate or shared SSH/SFTP usernames and passwords
- Passwords stored in macOS Keychain, not SQLite
- Server metadata stored in a local SQLite database
- OpenSSH host-key verification through `~/.ssh/known_hosts`
- OpenSSH connection multiplexing when SSH and SFTP use the same server identity
- Light/dark macOS UI and native app icon
- Clear Local Data control for saved profiles and credentials

## Security model

LocalSSH v0.2.0 uses Apple's installed OpenSSH clients for both Terminal and SFTP transport. It does not embed libssh2.

Passwords are stored as generic-password entries in macOS Keychain under the LocalSSH service. Password values are accessed through the native Security Framework and are not passed on a `/usr/bin/security` command line.

The webview never receives arbitrary local filesystem authority for transfers. Native file selection and Finder drops create opaque, in-memory grants. Upload and download commands accept those grant IDs instead of user-supplied local paths.

SFTP remote paths containing control characters are rejected before they can reach the interactive `sftp` command parser. Unknown or changed SSH host keys are rejected by OpenSSH according to `~/.ssh/known_hosts`.

The Tauri webview uses a restrictive Content Security Policy. Release builds run frontend and Rust dependency audits and stop on high-severity advisories.

## Local data

Server metadata is stored under the macOS application-data directory, normally:

```text
~/Library/Application Support/com.localssh.app/localssh.sqlite3
```

Passwords are stored separately in macOS Keychain. Installing a newer LocalSSH build with the same bundle identifier intentionally reuses this local data.

Use **Clear local data** in the app to delete saved server profiles and their known LocalSSH Keychain credentials.

## Development

Requirements:

- macOS
- Xcode Command Line Tools
- Node.js/npm
- Rust/Cargo

```bash
npm install
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

## Release security checks

A release uses lockfiles and verifies dependencies before packaging:

```bash
npm ci
npm audit --audit-level=high
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
```

The GitHub workflow then builds a universal macOS application for Apple Silicon and Intel, verifies the packaged icon, and publishes the DMG, app ZIP, icon, and SHA-256 checksums.
