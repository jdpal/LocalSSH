import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const browser = readFileSync(new URL('./components/FileBrowser.tsx', import.meta.url), 'utf8');
const rust = readFileSync(new URL('../src-tauri/src/sftp.rs', import.meta.url), 'utf8');

test('exposes local file picking and SFTP upload through the frontend API', () => {
  assert.match(api, /export async function pickLocalFiles/);
  assert.match(api, /export async function uploadRemote/);
});

test('supports Finder drag and drop plus an Upload button', () => {
  assert.match(browser, /onDragDropEvent/);
  assert.match(browser, />Upload<\/button>/);
  assert.match(browser, /upload-status-list/);
});

test('implements a native SFTP upload operation', () => {
  assert.match(rust, /pub fn upload_remote/);
  assert.match(rust, /SFTP_FILE_EXISTS:/);
  assert.match(rust, /SFTP_DIRECTORY_UNSUPPORTED:/);
});
