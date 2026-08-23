import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openssh = readFileSync(new URL('../src-tauri/src/openssh.rs', import.meta.url), 'utf8');

test('OpenSSH multiplex control socket uses a short private /tmp path on macOS', () => {
  assert.match(openssh, /MAX_CONTROL_PATH_BYTES:\s*usize\s*=\s*72/);
  assert.match(openssh, /PathBuf::from\("\/tmp"\)/);
  assert.match(openssh, /OnceLock<PathBuf>/);
  assert.match(openssh, /\.mode\(0o700\)/);
  assert.match(openssh, /DefaultHasher/);
  assert.doesNotMatch(openssh, /std::env::temp_dir\(\)\.join\("localssh-control"\)/);
  assert.match(openssh, /assert!\(path\.as_os_str\(\)\.as_encoded_bytes\(\)\.len\(\)\s*<=\s*MAX_CONTROL_PATH_BYTES/);
});
