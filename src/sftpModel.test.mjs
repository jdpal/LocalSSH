import test from 'node:test';
import assert from 'node:assert/strict';
import { parentRemotePath, sortRemoteEntries } from './sftpModel.js';

test('calculates safe parent paths without escaping root', () => {
  assert.equal(parentRemotePath('/home/jd/apps'), '/home/jd');
  assert.equal(parentRemotePath('/home'), '/');
  assert.equal(parentRemotePath('/'), '/');
});

test('sorts directories before files and alphabetically', () => {
  const entries = [
    { name: 'z.log', path: '/z.log', kind: 'file', size: 1, modified: null },
    { name: 'apps', path: '/apps', kind: 'directory', size: null, modified: null },
    { name: 'Alpha', path: '/Alpha', kind: 'directory', size: null, modified: null }
  ];
  assert.deepEqual(sortRemoteEntries(entries).map((entry) => entry.name), ['Alpha', 'apps', 'z.log']);
});
