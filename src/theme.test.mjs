import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('uses readable foreground text in both light and dark mode', () => {
  assert.match(css, /:root\{[^}]*color:light-dark\(#1d2430,#edf1f5\)/);
});

test('file rows explicitly inherit the application foreground color', () => {
  assert.match(css, /\.file-row\{[^}]*color:inherit/);
});
