import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src-tauri/src/sftp.rs', import.meta.url), 'utf8');

test('SFTP existence probe lists the parent directory using supported OpenSSH sftp flags', () => {
  assert.match(source, /fn remote_exists\([\s\S]*ls -lan \{\}/);
  assert.match(source, /quote_sftp_literal\(&parent\)/);
  assert.doesNotMatch(source, /ls -ld/);
});

test('SFTP existence probe confirms only an exact parsed child path', () => {
  assert.match(source, /parse_ls_line\(line, &parent\)/);
  assert.match(source, /entry\.path == canonical_path/);
  assert.match(source, /return Ok\(true\)/);
  assert.match(source, /Ok\(false\)/);
});

test('literal SFTP parent listing escapes glob metacharacters', () => {
  assert.match(source, /fn quote_sftp_literal/);
  assert.match(source, /'\*' \| '\?' \| '\[' \| '\]' \| '\{' \| '\}'/);
  assert.match(source, /quote_sftp_literal\(&parent\)/);
});
