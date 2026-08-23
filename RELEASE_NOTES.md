# LocalSSH v0.2.2

LocalSSH v0.2.2 is a terminal compatibility and colour-rendering hotfix.

## Fixed

- Sets the SSH PTY terminal type to `xterm-256color`.
- Fixes remote commands that reported `TERM environment variable not set`.
- Advertises local true-colour terminal metadata to the OpenSSH client.
- Adds an explicit ANSI 16-colour palette, bright colours and improved terminal contrast.
- Preserves ANSI escape sequences from remote applications.
- Keeps all v0.2.0 security hardening and v0.2.1 SSH/SFTP reliability fixes.

## Terminal validation

After connecting:

```bash
echo $TERM
tput colors
printf '\033[31mRED\033[0m \033[32mGREEN\033[0m \033[34mBLUE\033[0m\n'
```

Expected:

- `TERM` is `xterm-256color`
- `tput colors` reports `256`
- ANSI red, green and blue render visibly

## Distribution

- Universal macOS DMG and application ZIP for Apple Silicon and Intel Macs.
