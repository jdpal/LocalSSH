# LocalSSH v0.1.0

LocalSSH is a native macOS SSH and SFTP manager built with Tauri. This is the first packaged release.

## Highlights

- Native SSH terminal sessions backed by macOS `/usr/bin/ssh`
- Multiple independent SSH tabs and persistent terminal sessions
- Per-server persistent SFTP workspaces with independent tabs and connection state
- SFTP upload from the macOS file picker and Finder drag-and-drop
- SFTP file downloads with native destination-folder selection
- Scrollable remote folders with sticky file-list headers
- Saved server groups, favourites and search
- SSH and SFTP passwords stored in macOS Keychain rather than SQLite
- Option to reuse SSH credentials for SFTP or save separate SFTP credentials
- Clear red/green connection indicators and per-SFTP-tab session status
- LocalSSH application artwork and macOS app icons

## Assets

- `LocalSSH_0.1.0_macOS_universal.dmg` — drag-to-Applications installer for Apple Silicon and Intel Macs
- `LocalSSH-0.1.0-macOS-universal.zip` — zipped universal `LocalSSH.app`
- `LocalSSH-icon.png` — release artwork
- `SHA256SUMS.txt` — SHA-256 checksums for release assets

## macOS security

This release uses an ad-hoc macOS signature unless Apple Developer signing credentials are configured in the release environment. macOS may require approval in **System Settings → Privacy & Security** the first time the app is opened.
