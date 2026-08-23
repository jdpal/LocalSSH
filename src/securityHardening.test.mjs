import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const keychain = readFileSync(new URL('../src-tauri/src/keychain.rs', import.meta.url), 'utf8');
const sftp = readFileSync(new URL('../src-tauri/src/sftp.rs', import.meta.url), 'utf8');
const terminal = readFileSync(new URL('../src-tauri/src/terminal.rs', import.meta.url), 'utf8');
const openssh = readFileSync(new URL('../src-tauri/src/openssh.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const browser = readFileSync(new URL('./components/FileBrowser.tsx', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));


test('SFTP transport uses system OpenSSH and does not depend on libssh2', () => {
  assert.doesNotMatch(cargo, /^ssh2\s*=/m);
  assert.doesNotMatch(sftp, /use ssh2::/);
  assert.match(sftp, /\/usr\/bin\/sftp/);
  assert.match(openssh, /ControlMaster=auto/);
  assert.match(terminal, /openssh::ssh_args/);
  assert.match(sftp, /openssh::sftp_args/);
});

test('saved passwords use native Security Framework instead of security CLI argv', () => {
  assert.match(cargo, /security-framework/);
  assert.match(keychain, /security_framework::passwords/);
  assert.doesNotMatch(keychain, /Command::new\("\/usr\/bin\/security"\)/);
});

test('upload and download IPC use opaque local grants instead of raw paths', () => {
  assert.match(lib, /mod file_grants/);
  assert.match(api, /LocalFileGrant/);
  assert.match(api, /LocalDirectoryGrant/);
  assert.match(api, /localFileId/);
  assert.match(api, /localDirectoryId/);
  assert.doesNotMatch(api, /uploadRemote\(serverId: string, localPath:/);
  assert.doesNotMatch(api, /downloadRemote\(serverId: string, remotePath: string, localDir:/);
  assert.doesNotMatch(browser, /onDragDropEvent/);
  assert.match(browser, /local-files-dropped/);
});

test('Tauri enables a restrictive CSP', () => {
  assert.notEqual(config.app.security.csp, null);
  const csp = typeof config.app.security.csp === 'string'
    ? config.app.security.csp
    : JSON.stringify(config.app.security.csp);
  assert.match(csp, /default-src/);
  assert.match(csp, /connect-src/);
  assert.doesNotMatch(csp, /https:\/\//);
});

test('backend exposes explicit local-data clearing', () => {
  assert.match(lib, /fn clear_local_data/);
  assert.match(api, /clearLocalData/);
});


test('SFTP command construction rejects control characters in paths', () => {
  assert.match(sftp, /SFTP_UNSAFE_PATH/);
  assert.match(sftp, /char::is_control/);
});
