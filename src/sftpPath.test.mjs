import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { joinRemotePath, normalizeRemotePath } from './sftpModel.js';

test('normalizes remote paths without escaping root', () => {
  assert.equal(normalizeRemotePath('/etc//ssh/'), '/etc/ssh');
  assert.equal(normalizeRemotePath('/etc/./ssh'), '/etc/ssh');
  assert.equal(normalizeRemotePath('/etc/../var/log'), '/var/log');
  assert.equal(normalizeRemotePath('../../etc'), '/etc');
  assert.equal(normalizeRemotePath(''), '/');
});

test('joins directory entries relative to the displayed remote path', () => {
  assert.equal(joinRemotePath('/', 'etc'), '/etc');
  assert.equal(joinRemotePath('/', '/etc'), '/etc');
  assert.equal(joinRemotePath('/etc', 'ssh'), '/etc/ssh');
  assert.equal(joinRemotePath('/etc', '/etc/ssh'), '/etc/ssh');
  assert.equal(joinRemotePath('/etc', '/etc'), '/etc');
});

test('file browser derives directory navigation from current path and entry name', () => {
  const source = fs.readFileSync(new URL('./components/FileBrowser.tsx', import.meta.url), 'utf8');
  assert.match(source, /joinRemotePath\(path, entry\.name\)/);
  assert.doesNotMatch(source, /setPath\(entry\.path\)/);
});

test('native SFTP listing canonicalizes requested paths and prefixed listing names', () => {
  const source = fs.readFileSync(new URL('../src-tauri/src/sftp.rs', import.meta.url), 'utf8');
  assert.match(source, /fn normalize_remote_path/);
  assert.match(source, /fn remote_entry_path/);
  assert.match(source, /let canonical_path = normalize_remote_path\(path\);/);
  assert.match(source, /parse_ls_line\(line, &canonical_path\)/);
});
