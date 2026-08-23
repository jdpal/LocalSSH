import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const terminal = readFileSync(new URL('./components/TerminalPane.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('./types.ts', import.meta.url), 'utf8');
const rustLib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const rustServer = readFileSync(new URL('../src-tauri/src/server.rs', import.meta.url), 'utf8');


test('uses the LocalSSH artwork inside the app instead of the S slash placeholder', () => {
  assert.match(app, /localssh-icon\.png/);
  assert.doesNotMatch(app, /brand-mark">S\//);
});

test('renders button icons for core app actions', () => {
  for (const icon of ['connect', 'edit', 'delete', 'add', 'terminal', 'files']) {
    assert.match(app, new RegExp(`Icon name=["']${icon}["']`));
  }
});

test('does not display disconnected terminal instructional copy', () => {
  assert.doesNotMatch(app, /Ready for/);
  assert.doesNotMatch(app, /Click Connect to start/);
});

test('waits for a backend connected event before marking SSH connected', () => {
  assert.match(terminal, /terminal-connected/);
  assert.doesNotMatch(terminal, /sessionRef\.current = sessionId;\s*onStatus\('connected'\)/);
});

test('server profiles support shared or separate SFTP identities', () => {
  assert.match(types, /useSshCredentialsForSftp: boolean/);
  assert.match(types, /sftpUsername/);
  assert.match(types, /hasSshPassword/);
  assert.match(types, /hasSftpPassword/);
});

test('server editor exposes Keychain-backed SSH and SFTP password controls', () => {
  assert.match(app, /SSH password/);
  assert.match(app, /Use SSH credentials for SFTP/);
  assert.match(app, /SFTP password/);
  assert.match(app, /macOS Keychain/);
});

test('frontend API sends password updates without storing them in the profile model', () => {
  assert.match(api, /sshPassword/);
  assert.match(api, /clearSshPassword/);
  assert.match(api, /sftpPassword/);
  assert.match(api, /clearSftpPassword/);
});

test('native backend includes a dedicated macOS Keychain credential store', () => {
  assert.match(rustLib, /mod keychain/);
  assert.match(rustLib, /CredentialStore/);
  assert.match(rustServer, /use_ssh_credentials_for_sftp/);
  assert.match(rustServer, /sftp_username/);
});
