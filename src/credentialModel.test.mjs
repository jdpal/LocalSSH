import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModel() {
  try { return await import('./credentialModel.js'); } catch { return {}; }
}

test('shared SFTP credentials use the SSH username and SSH password state', async () => {
  const model = await loadModel();
  assert.equal(typeof model.resolveSftpCredentialSummary, 'function');
  assert.deepEqual(model.resolveSftpCredentialSummary({
    username: 'jatin', useSshCredentialsForSftp: true, sftpUsername: 'files', hasSshPassword: true, hasSftpPassword: false
  }), { username: 'jatin', hasSavedPassword: true, source: 'ssh' });
});

test('separate SFTP credentials use their own username and password state', async () => {
  const model = await loadModel();
  assert.equal(typeof model.resolveSftpCredentialSummary, 'function');
  assert.deepEqual(model.resolveSftpCredentialSummary({
    username: 'jatin', useSshCredentialsForSftp: false, sftpUsername: 'files', hasSshPassword: true, hasSftpPassword: true
  }), { username: 'files', hasSavedPassword: true, source: 'sftp' });
});
