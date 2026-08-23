# LocalSSH v0.2.0

LocalSSH v0.2.0 is a security-hardening release for macOS.

## Security changes

- Replaces the Rust `ssh2` / libssh2 SFTP backend with macOS `/usr/bin/sftp` and OpenSSH.
- Terminal and SFTP use the same OpenSSH ControlMaster path when the SSH/SFTP username matches, allowing SFTP to reuse an active terminal transport.
- Saved passwords continue to use macOS Keychain, but are now written and read through the native Security Framework rather than passing passwords to `/usr/bin/security` process arguments.
- Upload and download IPC no longer accepts arbitrary local filesystem paths from the webview. Native file selection and Finder drops create opaque backend grants.
- Enables a restrictive Tauri Content Security Policy for bundled assets and IPC.
- Adds an explicit **Clear local data** action that removes saved server profiles and their Keychain passwords from the Mac.
- Release builds now use lockfiles and fail on high-severity npm advisories or RustSec advisories before packaging.

## Existing functionality retained

- Multiple persistent SSH terminal tabs.
- Independent Files / SFTP tabs per server.
- Saved SSH credentials and optional separate SFTP credentials.
- SFTP upload, Finder drag/drop and downloads.
- Scrollable remote folders and pinned server controls.
- Universal macOS DMG and application ZIP for Apple Silicon and Intel Macs.

## Upgrade notes

Local server metadata and Keychain accounts are compatible with v0.1.x. Existing saved servers and passwords remain available after upgrading.

This build remains ad-hoc signed unless an Apple Developer signing identity is configured for the release pipeline. macOS Gatekeeper may therefore require manual approval.
