# LocalSSH

LocalSSH is a macOS-first desktop SSH manager with a Termius-style interface. It stores multiple server profiles locally, opens real `/usr/bin/ssh` sessions inside xterm.js, and provides read-only SFTP directory browsing.

## Current v1 features

- Server groups, favourites, search, add/edit/delete profiles
- SQLite persistence inside the app data directory
- Multiple concurrent terminal tabs
- Native macOS OpenSSH attached to a PTY
- Normal OpenSSH host-key, password, key-passphrase, `known_hosts`, and `ssh-agent` behaviour in Terminal
- Read-only SFTP browser with host-key verification
- SFTP authentication through `ssh-agent`, with fallback to an unencrypted identity file
- System light/dark appearance
- No cloud account and no localhost network listener
- No password or private-key contents stored by LocalSSH

## Security model

Terminal connections execute `/usr/bin/ssh` directly. Profile values are passed as process arguments rather than through a shell.

The SFTP browser refuses unknown or mismatched host keys. Connect to a new server in the Terminal tab first, verify its fingerprint through OpenSSH, and allow OpenSSH to add it to `~/.ssh/known_hosts`.

SFTP does not store passwords or passphrases. Load encrypted keys into the macOS SSH agent before using Files / SFTP.

## Build on macOS

Install Apple's command-line tools:

```bash
xcode-select --install
```

Install a current Rust toolchain using rustup and install Node.js 20 or newer. Then from this folder:

```bash
npm install
npm test
npm run tauri dev
```

For a release build:

```bash
npm run tauri build
```

Tauri writes the macOS application and DMG under:

```text
src-tauri/target/release/bundle/macos/LocalSSH.app
src-tauri/target/release/bundle/dmg/
```

Open the DMG and drag **LocalSSH.app** into **Applications**, or copy the `.app` directly:

```bash
cp -R src-tauri/target/release/bundle/macos/LocalSSH.app /Applications/
```

The build produced from this source is unsigned unless you configure an Apple Developer signing identity and notarisation.

## Usage

1. Launch LocalSSH.
2. Select **Add server**.
3. Enter a name, host/IP, username, port, group, and optional identity file.
4. Select the server and click **Connect**.
5. Use the Terminal tab for the normal SSH session.
6. Use **Files / SFTP** after the host key is present in `~/.ssh/known_hosts` and your authentication key is available to `ssh-agent`.

## Data stored locally

Server profiles contain only:

- display name
- hostname/IP
- SSH port
- username
- group
- favourite state
- optional identity-file path
- last connected timestamp

Passwords, passphrases, and private-key contents are not stored.

## Project structure

```text
src/                      React/xterm.js desktop UI
src/components/           Terminal and SFTP components
src-tauri/src/db.rs        SQLite persistence
src-tauri/src/server.rs    Profile model and validation
src-tauri/src/terminal.rs  PTY + native OpenSSH sessions
src-tauri/src/sftp.rs      Host-key-checked SFTP browsing
```

## v1 limitations

- Files / SFTP is read-only.
- SFTP does not yet support ProxyJump or interactive password/passphrase prompts.
- Terminal uses full native OpenSSH behaviour and can use your existing SSH configuration.
- Code signing and notarisation are not configured in the repository.

## Push to GitHub

After extracting this ZIP, create a new empty repository on GitHub. Then run from the extracted `LocalSSH-github` folder:

```bash
git init
git add .
git commit -m "Initial LocalSSH source"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

If you created the GitHub repository with a README, licence, or `.gitignore`, either clone that repository first and copy these files into it, or reconcile the remote history before pushing.

The included GitHub Actions workflow runs the JavaScript model tests and frontend build on pushes and pull requests.
