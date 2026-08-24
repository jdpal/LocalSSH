import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const pkg = JSON.parse(read('package.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargo = read('src-tauri/Cargo.toml');
const escapedVersion = pkg.version.replace(/\./g, '\\.');

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
  assert.match(script, /cargo check --locked --manifest-path src-tauri\/Cargo\.toml/);
  assert.match(script, /universal-apple-darwin/);
  assert.match(script, /gh release/);
});

test('release notes describe the current LocalSSH release', () => {
  const notes = read('RELEASE_NOTES.md');
  assert.match(notes, new RegExp(`LocalSSH v${escapedVersion}`));
  assert.match(notes, /macOS/);
  assert.match(notes, /OpenSSH/i);
  assert.match(notes, /security/i);
  assert.match(notes, /DMG/);
});

test('local release artifacts are ignored by Git', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^release-assets\/$/m);
});

test('Tauri bundle explicitly declares the generated application icons', () => {
  assert.deepEqual(tauri.bundle.icon, [
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

test('release versions stay aligned and security gates use lockfiles', () => {
  const workflow = read('.github/workflows/release.yml');
  const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
  assert.equal(tauri.version, pkg.version);
  assert.equal(cargoVersion, pkg.version);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /cargo audit/);
  assert.doesNotMatch(workflow, /npm install\s*$/m);
});

test('Tauri release build forwards --locked to Cargo instead of Tauri CLI', () => {
  const workflow = read('.github/workflows/release.yml');
  const script = read('scripts/release-local.sh');
  const command = /tauri build -- --target universal-apple-darwin --bundles app,dmg -- --locked/;
  assert.match(workflow, command);
  assert.match(script, command);
  assert.doesNotMatch(workflow, /--bundles app,dmg --locked/);
  assert.doesNotMatch(script, /--bundles app,dmg --locked/);
});
