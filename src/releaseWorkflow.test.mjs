import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('release workflow builds a universal macOS app and publishes named assets', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /universal-apple-darwin/);
  assert.match(workflow, /LocalSSH_\$\{VERSION\}_macOS_universal\.dmg/);
  assert.match(workflow, /LocalSSH-\$\{VERSION\}-macOS-universal\.zip/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /gh release/);
});

test('local release script validates, builds and uploads release assets', () => {
  const script = read('scripts/release-local.sh');
  assert.match(script, /npm test/);
  assert.match(script, /npm run build/);
  assert.match(script, /cargo check --manifest-path src-tauri\/Cargo\.toml/);
  assert.match(script, /universal-apple-darwin/);
  assert.match(script, /gh release/);
});

test('release notes describe the v0.1.1 macOS icon fix release', () => {
  const notes = read('RELEASE_NOTES.md');
  assert.match(notes, /LocalSSH v0\.1\.1/);
  assert.match(notes, /macOS/);
  assert.match(notes, /icon/i);
  assert.match(notes, /DMG/);
});

test('local release artifacts are ignored by Git', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^release-assets\/$/m);
});

test('Tauri bundle explicitly declares the generated application icons', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.deepEqual(config.bundle.icon, [
    'icons/32x32.png',
    'icons/128x128.png',
    'icons/128x128@2x.png',
    'icons/icon.icns',
    'icons/icon.ico',
  ]);
});

test('release workflow regenerates and validates the packaged macOS icon', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /npm run tauri icon src-tauri\/app-icon\.png/);
  assert.match(workflow, /Contents\/Resources\/icon\.icns/);
  assert.match(workflow, /CFBundleIconFile/);
});

test('local release script regenerates and validates the packaged macOS icon', () => {
  const script = read('scripts/release-local.sh');
  assert.match(script, /npm run tauri icon src-tauri\/app-icon\.png/);
  assert.match(script, /Contents\/Resources\/icon\.icns/);
  assert.match(script, /CFBundleIconFile/);
});
