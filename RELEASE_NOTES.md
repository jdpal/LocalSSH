# LocalSSH v0.2.4

LocalSSH v0.2.4 adds secure first-use SSH host-key onboarding.

## Added

- Unknown SSH hosts now show an in-app fingerprint verification dialog instead of failing with a raw OpenSSH `known_hosts` error.
- The dialog shows the server address, port, host-key type and SHA-256 fingerprint.
- Users can choose **Cancel** or **Trust & Connect**.
- Trusted keys are added to the normal macOS `~/.ssh/known_hosts` file and the connection retries automatically.
- SSH Terminal and Files/SFTP share the same trusted-host state.

## Security

- `StrictHostKeyChecking=yes` remains enabled.
- Unknown keys are never accepted silently.
- LocalSSH uses the macOS system OpenSSH `ssh-keyscan` and `ssh-keygen` utilities for host-key discovery and SHA-256 fingerprints.
- The trust action re-scans the server and refuses to save a key if the fingerprint changed after the user approved it.
- Existing mismatched host keys remain blocked and are never automatically replaced.
- Users are instructed to verify new fingerprints with their server provider or another trusted source before trusting them.
- Existing Keychain, CSP, file-grant and OpenSSH SFTP hardening remains unchanged.

## Distribution

- Universal macOS DMG and application ZIP for Apple Silicon and Intel Macs.
