# LocalSSH v0.1.1

This patch release corrects the macOS application icon packaging in the distributed LocalSSH app and DMG.

## Fixed

- LocalSSH now carries its custom application icon in the macOS `.app` bundle.
- The DMG displays the LocalSSH icon instead of the generic macOS application placeholder.
- Tauri explicitly declares the generated PNG, ICNS and ICO bundle icons.
- The release workflow regenerates icons from `src-tauri/app-icon.png` before packaging.
- Release validation checks that `LocalSSH.app/Contents/Resources/icon.icns` exists.
- Release validation checks `CFBundleIconFile` in the built app's `Info.plist` before publishing.

## Assets

- `LocalSSH_0.1.1_macOS_universal.dmg` — universal macOS installer for Apple Silicon and Intel Macs
- `LocalSSH-0.1.1-macOS-universal.zip` — zipped universal `LocalSSH.app`
- `LocalSSH-icon.png` — LocalSSH application artwork
- `SHA256SUMS.txt` — SHA-256 checksums for downloadable assets

## Upgrade

Replace the previous LocalSSH app in `/Applications` with the v0.1.1 build from the DMG.
