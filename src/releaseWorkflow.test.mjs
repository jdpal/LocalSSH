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

test('release notes describe the first public macOS release', () => {
  const notes = read('RELEASE_NOTES.md');
  assert.match(notes, /LocalSSH v0\.1\.0/);
  assert.match(notes, /SSH/);
  assert.match(notes, /SFTP/);
  assert.match(notes, /Keychain/);
});

test('local release artifacts are ignored by Git', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^release-assets\/$/m);
});
