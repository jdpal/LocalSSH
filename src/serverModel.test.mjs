import test from 'node:test';
import assert from 'node:assert/strict';
import { addServerImmutable, groupAndFilterServers } from './serverModel.js';

const servers = [
  { id: '1', name: 'Web-01', host: '10.20.0.15', port: 22, username: 'jd', groupName: 'Production', favourite: true },
  { id: '2', name: 'DB-01', host: '10.20.0.30', port: 22, username: 'postgres', groupName: 'Production', favourite: false },
  { id: '3', name: 'NAS', host: '192.168.1.10', port: 22, username: 'jd', groupName: 'Home Lab', favourite: true }
];

test('filters servers by name or host case-insensitively', () => {
  assert.deepEqual(groupAndFilterServers(servers, 'web').flatMap(g => g.servers).map(s => s.id), ['1']);
  assert.deepEqual(groupAndFilterServers(servers, '192.168').flatMap(g => g.servers).map(s => s.id), ['3']);
});

test('sorts favourites before other servers within a group', () => {
  const production = groupAndFilterServers(servers, '').find(g => g.name === 'Production');
  assert.deepEqual(production.servers.map(s => s.id), ['1', '2']);
});

test('adds a server without mutating the original array', () => {
  const original = [...servers];
  const next = addServerImmutable(original, { id: '4', name: 'Pi', host: '192.168.1.25', port: 22, username: 'pi', groupName: 'Home Lab', favourite: false });
  assert.notEqual(next, original);
  assert.equal(original.length, 3);
  assert.equal(next.length, 4);
});
