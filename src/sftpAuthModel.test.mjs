import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySftpError } from './sftpAuthModel.js';

test('classifies missing SFTP credentials as auth required', () => {
  assert.equal(classifySftpError('SFTP_AUTH_REQUIRED'), 'auth-required');
});

test('classifies rejected SFTP password as auth failed', () => {
  assert.equal(classifySftpError('SFTP_AUTH_FAILED: password rejected'), 'auth-failed');
});

test('leaves unrelated SFTP errors as other', () => {
  assert.equal(classifySftpError('Could not connect to host'), 'other');
});

test('prompts for a password when key and agent authentication are unavailable', async () => {
  const { sftpAuthAction } = await import('./sftpAuthModel.js');
  assert.equal(sftpAuthAction('SFTP_AUTH_REQUIRED', ''), 'prompt');
});

test('retries with a session password when one is present', async () => {
  const { sftpAuthAction } = await import('./sftpAuthModel.js');
  assert.equal(sftpAuthAction('SFTP_AUTH_REQUIRED', 'secret'), 'retry-password');
});

test('prompts again when the supplied password is rejected', async () => {
  const { sftpAuthAction } = await import('./sftpAuthModel.js');
  assert.equal(sftpAuthAction('SFTP_AUTH_FAILED: password rejected', 'wrong'), 'prompt');
});
