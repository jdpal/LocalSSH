# LocalSSH v0.2.5

LocalSSH v0.2.5 fixes SFTP upload overwrite detection.

## Fixed

- Uploading a new remote file no longer reports that the file already exists when the destination directory is empty.
- Removed the invalid OpenSSH SFTP `ls -d` existence probe.
- Remote existence checks now list the literal parent directory with supported `ls -lan` flags and compare parsed canonical child paths to the exact upload target.
- Existing files still show the Replace / Cancel confirmation.
- Hidden files, spaces, and filenames containing SFTP glob characters are checked literally and do not match unrelated entries.
- Ambiguous SFTP responses return an explicit existence-check error instead of a false overwrite warning.

## Security

- LocalSSH continues to use the macOS system OpenSSH client for SSH and SFTP.
- Strict host-key verification remains enabled.
- Saved passwords remain in the native macOS Keychain.
- The restrictive Tauri CSP and opaque local file grants remain enabled.
- This release does not weaken any v0.2.x security controls.

## Distribution

- Universal macOS DMG and application ZIP for Apple Silicon and Intel Macs.
