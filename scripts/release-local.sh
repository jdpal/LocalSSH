#!/bin/zsh
set -euo pipefail

TAG="${1:-v0.2.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: Local macOS release builds must run on a Mac."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required."
  exit 1
fi

gh auth status >/dev/null

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is not clean. Commit or stash changes before releasing."
  git status --short
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
TAURI_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
CARGO_VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
TAG_VERSION="${TAG#v}"

if [[ "$VERSION" != "$TAURI_VERSION" || "$VERSION" != "$CARGO_VERSION" || "$VERSION" != "$TAG_VERSION" ]]; then
  echo "ERROR: Version mismatch."
  echo "package.json: $VERSION"
  echo "tauri.conf.json: $TAURI_VERSION"
  echo "Cargo.toml: $CARGO_VERSION"
  echo "release tag: $TAG"
  exit 1
fi

REPO_SLUG="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
BRANCH="$(git branch --show-current)"

if [[ -z "$BRANCH" ]]; then
  echo "ERROR: Release must run from a named Git branch."
  exit 1
fi

git fetch origin "$BRANCH"
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$BRANCH")" ]]; then
  echo "ERROR: Local HEAD is not identical to origin/$BRANCH. Push or pull before releasing."
  exit 1
fi

echo "== LocalSSH $TAG release =="
echo "Repository: $REPO_SLUG"
echo "Commit: $(git rev-parse --short HEAD)"

rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm test
npm audit --audit-level=high
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml
if ! command -v cargo-audit >/dev/null 2>&1; then cargo install cargo-audit --locked --version 0.22.2; fi
cargo audit --file src-tauri/Cargo.lock
npm run tauri icon src-tauri/app-icon.png

rm -rf src-tauri/target/universal-apple-darwin/release/bundle
APPLE_SIGNING_IDENTITY="-" npm run tauri build -- --target universal-apple-darwin --bundles app,dmg -- --locked

BUNDLE_ROOT="src-tauri/target/universal-apple-darwin/release/bundle"
APP_PATH="$(find "$BUNDLE_ROOT/macos" -maxdepth 1 -name 'LocalSSH.app' -print -quit)"
DMG_PATH="$(find "$BUNDLE_ROOT/dmg" -maxdepth 1 -name '*.dmg' -print -quit)"

if [[ -z "$APP_PATH" || -z "$DMG_PATH" ]]; then
  echo "ERROR: Tauri build completed without the expected .app or .dmg bundle."
  exit 1
fi

ICON_PATH="$APP_PATH/Contents/Resources/icon.icns"
PLIST_PATH="$APP_PATH/Contents/Info.plist"
if [[ ! -f "$ICON_PATH" ]]; then
  echo "ERROR: Packaged app is missing $ICON_PATH"
  exit 1
fi
if [[ ! -f "$PLIST_PATH" ]]; then
  echo "ERROR: Packaged app is missing $PLIST_PATH"
  exit 1
fi
BUNDLE_ICON="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$PLIST_PATH")"
if [[ "$BUNDLE_ICON" != "icon.icns" && "$BUNDLE_ICON" != "icon" ]]; then
  echo "ERROR: CFBundleIconFile is '$BUNDLE_ICON', expected icon.icns"
  exit 1
fi
echo "Verified packaged icon: $ICON_PATH ($BUNDLE_ICON)"

ASSET_DIR="release-assets/$TAG"
rm -rf "$ASSET_DIR"
mkdir -p "$ASSET_DIR"

ditto -c -k --sequesterRsrc --keepParent \
  "$APP_PATH" \
  "$ASSET_DIR/LocalSSH-${VERSION}-macOS-universal.zip"
cp "$DMG_PATH" "$ASSET_DIR/LocalSSH_${VERSION}_macOS_universal.dmg"
cp src-tauri/app-icon.png "$ASSET_DIR/LocalSSH-icon.png"

(
  cd "$ASSET_DIR"
  shasum -a 256 \
    "LocalSSH_${VERSION}_macOS_universal.dmg" \
    "LocalSSH-${VERSION}-macOS-universal.zip" \
    LocalSSH-icon.png > SHA256SUMS.txt
)

if gh release view "$TAG" --repo "$REPO_SLUG" >/dev/null 2>&1; then
  gh release edit "$TAG" --repo "$REPO_SLUG" \
    --title "LocalSSH $TAG" \
    --notes-file RELEASE_NOTES.md
  gh release upload "$TAG" "$ASSET_DIR"/* --repo "$REPO_SLUG" --clobber
else
  gh release create "$TAG" "$ASSET_DIR"/* --repo "$REPO_SLUG" \
    --title "LocalSSH $TAG" \
    --notes-file RELEASE_NOTES.md \
    --target "$(git rev-parse HEAD)"
fi

echo
echo "Release published:"
gh release view "$TAG" --repo "$REPO_SLUG" --json url --jq .url
