import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureSftpTab,
  removeSftpTab,
  updateSftpTabStatus,
} from './sftpSessionModel.js';

const a = { id: 'a', name: 'Alpha', host: '10.0.0.1', port: 22, username: 'jd' };
const b = { id: 'b', name: 'Beta', host: '10.0.0.2', port: 22, username: 'jd' };

test('creates one independent SFTP tab per server and reuses an existing server tab', () => {
  const first = ensureSftpTab([], a, 'tab-a');
  const second = ensureSftpTab(first.tabs, b, 'tab-b');
  const reused = ensureSftpTab(second.tabs, a, 'ignored');

  assert.equal(second.tabs.length, 2);
  assert.equal(reused.tabs.length, 2);
  assert.equal(reused.activeId, 'tab-a');
  assert.equal(second.tabs[0].server.id, 'a');
  assert.equal(second.tabs[1].server.id, 'b');
});

test('closing one SFTP tab leaves other server tabs intact', () => {
  const tabs = [
    { id: 'tab-a', serverId: 'a', server: a, label: 'Alpha', status: 'connected' },
    { id: 'tab-b', serverId: 'b', server: b, label: 'Beta', status: 'connected' },
  ];
  const next = removeSftpTab(tabs, 'tab-a');
  assert.deepEqual(next.map((tab) => tab.serverId), ['b']);
});

test('tracks SFTP status independently for each server tab', () => {
  const tabs = [
    { id: 'tab-a', serverId: 'a', server: a, label: 'Alpha', status: 'idle' },
    { id: 'tab-b', serverId: 'b', server: b, label: 'Beta', status: 'idle' },
  ];
  const next = updateSftpTabStatus(tabs, 'tab-b', 'connected');
  assert.equal(next[0].status, 'idle');
  assert.equal(next[1].status, 'connected');
});
