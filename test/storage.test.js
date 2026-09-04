import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Account } from '../src/core/Account.js';
import { User } from '../src/core/User.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';

test('Account and User entities serialize and verify correctly', () => {
  const acc = new Account({ email: 'test@grok.com', ssoToken: 'sso_123' });
  assert.equal(acc.email, 'test@grok.com');
  assert.equal(acc.status, 'active');

  const { hash, salt } = User.hashPassword('secret123');
  const user = new User({ email: 'admin@local.com', passwordHash: hash, passwordSalt: salt, role: 'admin' });
  assert.equal(user.verifyPassword('secret123'), true);
  assert.equal(user.verifyPassword('wrong'), false);
});

test('Account methods work as expected', () => {
  const acc = new Account({ email: 'test@grok.com' });
  assert.equal(acc.isAvailable(), true);

  acc.setCooling(1000);
  assert.equal(acc.status, 'cooling');
  assert.equal(acc.isAvailable(), false);

  const json = acc.toJSON();
  assert.equal(json.email, 'test@grok.com');
  assert.equal(json.status, 'cooling');

  const restored = Account.fromJSON(json);
  assert.equal(restored.id, acc.id);
  assert.equal(restored.email, acc.email);
  assert.equal(restored.status, 'cooling');

  const disabledAcc = new Account({ status: 'disabled' });
  assert.equal(disabledAcc.isAvailable(), false);
});

test('User methods work as expected', () => {
  const user = new User({ email: '  Admin@Domain.COM  ', role: 'admin' });
  assert.equal(user.email, 'admin@domain.com');
  assert.equal(user.role, 'admin');

  const regularUser = new User({ email: 'user@domain.com', role: 'other' });
  assert.equal(regularUser.role, 'user');

  const emptyPassUser = new User();
  assert.equal(emptyPassUser.verifyPassword('secret'), false);

  const corruptedUser = new User({ email: 'u@test.com', passwordHash: 'invalid-corrupted-hash', passwordSalt: 'salt' });
  assert.equal(corruptedUser.verifyPassword('secret'), false);

  const json = user.toJSON();
  assert.equal(json.email, 'admin@domain.com');
  assert.equal(json.passwordHash, undefined);
  assert.equal(json.passwordSalt, undefined);
});

test('JsonStorage reads and writes atomically', async () => {
  const tmpDir = '/tmp/grok-test-storage-' + Date.now();
  const file = path.join(tmpDir, 'test.json');
  const storage = new JsonStorage();
  
  // Non-existent file returns default value
  const defaultData = await storage.read(path.join(tmpDir, 'nonexistent.json'), { fallback: true });
  assert.deepEqual(defaultData, { fallback: true });

  await storage.write(file, [{ hello: 'world' }]);
  const data = await storage.read(file, []);
  assert.deepEqual(data, [{ hello: 'world' }]);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
