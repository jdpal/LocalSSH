# LocalSSH v0.2.3

LocalSSH v0.2.3 improves macOS terminal keyboard behaviour.

## Added

- Command-K clears the terminal screen and scrollback.
- Command-C copies selected terminal text.
- Command-V pastes into the terminal.
- Command-A selects terminal contents.
- Command-Plus and Command-Minus adjust terminal font size.
- Command-0 resets terminal font size.
- Command-Up and Command-Down jump to the top/bottom of scrollback.
- Page Up and Page Down scroll terminal history.

## Preserved terminal controls

Normal shell control keys continue to go to the remote host:

- Control-C
- Control-D
- Control-Z
- Control-L

## Colour behaviour

LocalSSH continues to use the macOS system OpenSSH client, advertises
`TERM=xterm-256color`, and renders ANSI, 256-colour and true-colour output.

If colours disappear only after `su`, `su -` or `sudo -i`, verify with:

```bash
echo $TERM
tput colors
printf '\033[31mRED\033[0m \033[32mGREEN\033[0m \033[34mBLUE\033[0m\n'
```

If the ANSI test is coloured but the root prompt or `ls` output is not,
the root account's shell configuration is not emitting colours. LocalSSH
does not modify remote shell profiles or aliases automatically.

## Security

This terminal usability hotfix preserves the existing LocalSSH security
hardening: SFTP continues to use the macOS system OpenSSH client, saved
passwords remain in the native macOS Keychain, the restrictive Tauri CSP
remains enabled, and upload/download IPC continues to use opaque file grants.

## Distribution

- Universal macOS DMG and application ZIP for Apple Silicon and Intel Macs.
