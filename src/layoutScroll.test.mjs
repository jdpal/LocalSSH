import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test('server list owns sidebar scrolling so Add Server remains pinned', () => {
  const sidebar = rule('.sidebar');
  const serverScroll = rule('.server-scroll');
  const addServer = rule('.add-server');

  assert.match(sidebar, /min-height\s*:\s*0/);
  assert.match(serverScroll, /flex\s*:\s*1/);
  assert.match(serverScroll, /overflow-y\s*:\s*auto/);
  assert.match(addServer, /flex\s*:\s*none/);
});

test('workspace and SFTP pane constrain height so file list scrolls internally', () => {
  const workspace = rule('.workspace');
  const body = rule('.workspace-body');
  const panel = rule('.workspace-panel.active');
  const stack = rule('.sftp-stack');
  const pane = rule('.sftp-pane.active');
  const browser = rule('.file-browser');
  const scroll = rule('.file-table-scroll');

  assert.match(workspace, /min-height\s*:\s*0/);
  assert.match(workspace, /overflow\s*:\s*hidden/);
  assert.match(body, /overflow\s*:\s*hidden/);
  assert.match(panel, /min-height\s*:\s*0/);
  assert.match(stack, /min-height\s*:\s*0/);
  assert.match(pane, /min-height\s*:\s*0/);
  assert.match(browser, /min-height\s*:\s*0/);
  assert.match(scroll, /overflow-y\s*:\s*auto/);
});

test('SFTP file list defines a visible WebKit scrollbar', () => {
  assert.match(css, /\.file-table-scroll::\-webkit-scrollbar\s*\{[^}]*width\s*:\s*\d+px/);
  assert.match(css, /\.file-table-scroll::\-webkit-scrollbar-thumb\s*\{/);
});
