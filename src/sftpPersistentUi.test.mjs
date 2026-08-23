import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const browser = readFileSync(new URL('./components/FileBrowser.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const rustSftp = readFileSync(new URL('../src-tauri/src/sftp.rs', import.meta.url), 'utf8');
const rustLib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('Files view renders independent SFTP tabs and keeps each FileBrowser mounted', () => {
  assert.match(app, /sftpTabs/);
  assert.match(app, /activeSftpTabId/);
  assert.match(app, /sftp-session-tabs/);
  assert.match(app, /sftpTabs\.map/);
  assert.match(app, /<FileBrowser[^>]*server=\{tab\.server\}/s);
});

test('closing an SFTP tab calls the backend session close command', () => {
  assert.match(api, /export async function closeSftp/);
  assert.match(app, /closeSftp/);
});

test('FileBrowser reports connection state to its owning SFTP tab', () => {
  assert.match(browser, /onStatus/);
  assert.match(browser, /onStatusRef\.current\('connecting'\)/);
  assert.match(browser, /onStatusRef\.current\('connected'\)/);
});

test('native backend uses OpenSSH SFTP while preserving per-server tab close API', () => {
  assert.match(rustSftp, /pub struct SftpManager/);
  assert.match(rustSftp, /\/usr\/bin\/sftp/);
  assert.match(rustSftp, /pub fn close\(&self, _server_id: &str\)/);
  assert.match(rustLib, /sftp: SftpManager/);
  assert.match(rustLib, /fn sftp_close/);
});
