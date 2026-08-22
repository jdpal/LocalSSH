import test from 'node:test';
import assert from 'node:assert/strict';
import { addSessionTab, removeSessionTab } from './terminalModel.js';

const profile = { id: 's1', name: 'Web-01', host: '10.0.0.1', port: 22, username: 'jd', groupName: 'Production', favourite: false };

test('adds an independent terminal tab for a server', () => {
  const current = [];
  const next = addSessionTab(current, profile, 'tab-1');
  assert.equal(current.length, 0);
  assert.deepEqual(next[0], { id: 'tab-1', serverId: 's1', label: 'Web-01', backendSessionId: null, status: 'idle' });
});

test('removes only the requested terminal tab', () => {
  const tabs = [
    { id: 'tab-1', serverId: 's1', label: 'Web-01', backendSessionId: null, status: 'idle' },
    { id: 'tab-2', serverId: 's2', label: 'DB-01', backendSessionId: 'pty-2', status: 'connected' }
  ];
  assert.deepEqual(removeSessionTab(tabs, 'tab-1').map((tab) => tab.id), ['tab-2']);
});
