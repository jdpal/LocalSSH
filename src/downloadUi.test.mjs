import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const browser = readFileSync(new URL('./components/FileBrowser.tsx', import.meta.url), 'utf8');
const icon = readFileSync(new URL('./components/Icon.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const rustSftp = readFileSync(new URL('../src-tauri/src/sftp.rs', import.meta.url), 'utf8');
const rustLib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('exposes native download destination picking and SFTP download through the frontend API', () => {
  assert.match(api, /export async function pickDownloadDirectory/);
  assert.match(api, /export async function downloadRemote/);
});

test('file browser supports selecting remote files and downloading multiple files', () => {
  assert.match(browser, /selectedFiles/);
  assert.match(browser, /Icon name="download"/);
  assert.match(browser, /Icon name="download"\/> Download/);
  assert.match(browser, /download-status-list/);
});

test('remote directory listing has its own vertical scroll container with a sticky header', () => {
  assert.match(browser, /file-table-scroll/);
  assert.match(styles, /\.file-table-scroll\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.file-header\{[^}]*position:sticky/);
});

test('native backend implements file download and macOS destination directory selection', () => {
  assert.match(rustSftp, /pub fn download_remote/);
  assert.match(rustLib, /fn sftp_download/);
  assert.match(rustLib, /fn pick_download_directory/);
});

test('download action has a dedicated icon', () => {
  assert.match(icon, /download:/);
});
