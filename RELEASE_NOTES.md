# LocalSSH v0.2.1

LocalSSH v0.2.1 is a macOS SSH/SFTP reliability hotfix on top of the v0.2.0 security-hardened release.

## Fixed

- Fixes OpenSSH ControlMaster socket creation when macOS provides a long temporary-directory path.
- Uses a short private `/tmp/lssh-...` control directory and compact hashed socket names.
- Fixes SFTP directory navigation producing duplicated paths such as `/etc/etc`.
- Canonicalizes root and nested SFTP paths before displaying or sending them to OpenSSH.
- Handles OpenSSH listings that return absolute or parent-prefixed names.
- Parent navigation remains bounded at `/` and repeated slashes / dot segments are normalized.

## Security

- Retains all v0.2.0 security hardening.
- SFTP continues to use macOS OpenSSH rather than libssh2.
- Saved passwords continue to use native macOS Keychain APIs.
- Local upload/download access continues to use opaque backend file grants.

## Distribution

- Universal macOS DMG and application ZIP for Apple Silicon and Intel Macs.
