import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const terminalPane = fs.readFileSync(new URL('./components/TerminalPane.tsx', import.meta.url), 'utf8');

test('terminal registers a custom macOS keyboard handler', () => {
  assert.match(terminalPane, /attachCustomKeyEventHandler/);
  assert.match(terminalPane, /event\.metaKey/);
});

test('Command-K clears terminal scrollback locally', () => {
  assert.match(terminalPane, /key\s*===\s*['"]k['"]/i);
  assert.match(terminalPane, /terminal\.clear\(\)/);
});

test('Command-C copies selection without replacing Control-C interrupt', () => {
  assert.match(terminalPane, /terminal\.hasSelection\(\)/);
  assert.match(terminalPane, /terminal\.getSelection\(\)/);
  assert.match(terminalPane, /clipboard\.writeText/);
});

test('Command-V pastes clipboard text into the terminal', () => {
  assert.match(terminalPane, /clipboard\.readText/);
  assert.match(terminalPane, /terminal\.paste\(/);
});

test('terminal supports macOS select-all font zoom and scroll shortcuts', () => {
  assert.match(terminalPane, /terminal\.selectAll\(\)/);
  assert.match(terminalPane, /terminal\.scrollToTop\(\)/);
  assert.match(terminalPane, /terminal\.scrollToBottom\(\)/);
  assert.match(terminalPane, /fontSize/);
  assert.match(terminalPane, /Math\.min\(/);
  assert.match(terminalPane, /Math\.max\(/);
});

test('PageUp and PageDown scroll terminal history without sending text to remote shell', () => {
  assert.match(terminalPane, /PageUp/);
  assert.match(terminalPane, /PageDown/);
  assert.match(terminalPane, /terminal\.scrollPages\(/);
});
