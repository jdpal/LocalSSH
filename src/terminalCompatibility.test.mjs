import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const terminalRs = fs.readFileSync(new URL('../src-tauri/src/terminal.rs', import.meta.url), 'utf8');
const terminalPane = fs.readFileSync(new URL('./components/TerminalPane.tsx', import.meta.url), 'utf8');

test('SSH PTY advertises xterm-256color and local true-colour terminal metadata', () => {
  assert.match(terminalRs, /command\.env\("TERM",\s*"xterm-256color"\)/);
  assert.match(terminalRs, /command\.env\("COLORTERM",\s*"truecolor"\)/);
  assert.match(terminalRs, /command\.env\("TERM_PROGRAM",\s*"LocalSSH"\)/);
});

test('xterm terminal declares a complete ANSI palette instead of monochrome-only theme values', () => {
  for (const key of [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
    'brightMagenta', 'brightCyan', 'brightWhite',
  ]) {
    assert.match(terminalPane, new RegExp(`${key}:`), `missing xterm theme colour ${key}`);
  }
  assert.match(terminalPane, /minimumContrastRatio:\s*4\.5/);
});
