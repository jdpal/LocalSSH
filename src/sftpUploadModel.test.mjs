import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteUploadTarget, uploadErrorAction } from './sftpUploadModel.js';

test('builds a remote upload path from the current directory and local filename', () => {
  assert.equal(remoteUploadTarget('/', '/Users/jatin/Downloads/report.txt'), '/report.txt');
  assert.equal(remoteUploadTarget('/home/jatin', '/Users/jatin/Downloads/report.txt'), '/home/jatin/report.txt');
});

test('recognises an existing remote file as a replace decision', () => {
  assert.equal(uploadErrorAction('SFTP_FILE_EXISTS:/home/jatin/report.txt'), 'confirm-replace');
});

test('recognises dropped directories as unsupported in v1', () => {
  assert.equal(uploadErrorAction('SFTP_DIRECTORY_UNSUPPORTED:/Users/jatin/Desktop/folder'), 'directory-unsupported');
});

test('leaves unrelated upload errors unchanged', () => {
  assert.equal(uploadErrorAction('SFTP upload failed: permission denied'), 'other');
});
