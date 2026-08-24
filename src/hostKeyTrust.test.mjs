import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const prompt = fs.readFileSync(new URL('./hostKeyPrompt.ts', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const openssh = fs.readFileSync(new URL('../src-tauri/src/openssh.rs', import.meta.url), 'utf8');
const hostKeysPath = new URL('../src-tauri/src/host_keys.rs', import.meta.url);

test('strict host-key checking remains enabled', () => {
  assert.match(openssh, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(openssh, /StrictHostKeyChecking=no/);
});

test('backend exposes host-key preflight and trust commands', () => {
  assert.equal(fs.existsSync(hostKeysPath), true);
  const source = fs.readFileSync(hostKeysPath, 'utf8');
  assert.match(source, /ssh-keyscan/);
  assert.match(source, /ssh-keygen/);
  assert.match(source, /known_hosts/);
  assert.match(source, /HostKeyState::Unknown/);
  assert.match(source, /HostKeyState::Trusted/);
  assert.match(source, /HostKeyState::Mismatch/);
  assert.match(source, /HOST_KEY_CHANGED_DURING_TRUST/);
  assert.match(lib, /fn host_key_check/);
  assert.match(lib, /fn host_key_trust/);
  assert.match(lib, /host_key_check, host_key_trust/);
});

test('frontend preflights host trust for SSH and every SFTP operation', () => {
  assert.match(api, /async function ensureHostTrusted/);
  assert.match(api, /host_key_check/);
  assert.match(api, /host_key_trust/);
  assert.match(prompt, /Trust & Connect/);
  assert.match(prompt, /Host key mismatch/);
  assert.match(prompt, /Verify the fingerprint/);
  assert.match(api, /await ensureHostTrusted\(serverId\);[\s\S]*invoke<string>\('start_ssh'/);
  assert.match(api, /await ensureHostTrusted\(serverId\);[\s\S]*invoke<RemoteEntry\[]>\('sftp_list'/);
  assert.match(api, /await ensureHostTrusted\(serverId\);[\s\S]*invoke\('sftp_upload'/);
  assert.match(api, /await ensureHostTrusted\(serverId\);[\s\S]*invoke\('sftp_download'/);
});
