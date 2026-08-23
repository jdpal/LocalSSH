import test from 'node:test';
import assert from 'node:assert/strict';
import { addSessionTab, removeSessionTab } from './terminalModel.js';

const profile = { id: 's1', name: 'Web-01', host: '10.0.0.1', port: 22, username: 'jd', groupName: 'Production', favourite: false };

test('adds an independent terminal tab for a server', () => {
  const current = [];
  const next = addSessionTab(current, profile, 'tab-1');
  assert.equal(current.length, 0);
  assert.deepEqual(next[0], { id: 'tab-1', serverId: 's1', server: profile, label: 'Web-01', backendSessionId: null, status: 'idle' });
});

test('removes only the requested terminal tab', () => {
  const tabs = [
    { id: 'tab-1', serverId: 's1', label: 'Web-01', backendSessionId: null, status: 'idle' },
    { id: 'tab-2', serverId: 's2', label: 'DB-01', backendSessionId: 'pty-2', status: 'connected' }
  ];
  assert.deepEqual(removeSessionTab(tabs, 'tab-1').map((tab) => tab.id), ['tab-2']);
});

test('keeps terminal stack mounted while Files view is active', async () => {
  const { terminalStackState } = await import('./terminalModel.js');
  const tabs = [{ id: 'tab-1', serverId: 's1', label: 'Web-01', status: 'connected' }];
  assert.deepEqual(terminalStackState(tabs, 'files'), { mounted: true, visible: false });
});

test('stores a server snapshot in each terminal tab so deleting a profile does not end the session', () => {
  const tab = addSessionTab([], profile, 'tab-snapshot')[0];
  assert.deepEqual(tab.server, profile);
});

test('reports a server connected only when at least one SSH tab is connected', async () => {
  const model = await import('./terminalModel.js');
  assert.equal(typeof model.serverConnectionState, 'function');
  const tabs = [
    { id: 'a', serverId: 's1', status: 'connecting' },
    { id: 'b', serverId: 's2', status: 'connected' }
  ];
  assert.equal(model.serverConnectionState(tabs, 's1'), 'disconnected');
  assert.equal(model.serverConnectionState(tabs, 's2'), 'connected');
  assert.equal(model.serverConnectionState(tabs, 'missing'), 'disconnected');
});
