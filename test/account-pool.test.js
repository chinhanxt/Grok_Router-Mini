import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Account } from '../src/core/Account.js';
import { AutoStrategy } from '../src/core/AutoStrategy.js';
import { AccountPool } from '../src/services/AccountPool.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';

test('AutoStrategy picks account with lowest load score', () => {
  const strategy = new AutoStrategy();
  const a1 = new Account({ id: '1', requestCount: 10, totalTokens: 500 });
  const a2 = new Account({ id: '2', requestCount: 2, totalTokens: 100 });
  const selected = strategy.select([a1, a2]);
  assert.equal(selected.id, '2');
});

test('AutoStrategy handles edge cases and tie-breaking', () => {
  const strategy = new AutoStrategy();
  assert.equal(strategy.select([]), null);
  assert.equal(strategy.select(null), null);
  assert.equal(strategy.select(undefined), null);

  // Tie-breaking: when load score is equal, prefers later expiresAt (b.expiresAt - a.expiresAt)
  const a1 = new Account({ id: '1', requestCount: 1, totalTokens: 100, expiresAt: 1000 });
  const a2 = new Account({ id: '2', requestCount: 1, totalTokens: 100, expiresAt: 2000 });
  const selected = strategy.select([a1, a2]);
  assert.equal(selected.id, '2');
});

test('AccountPool handles failover to next account when 429 occurs', async () => {
  const tmpFile = '/tmp/grok-pool-test-' + Date.now() + '.json';
  const pool = new AccountPool(new JsonStorage(), { ACCOUNTS_FILE: tmpFile, DEFAULT_COOLDOWN_MS: 60000 });
  
  try {
    await pool.addAccount({ email: 'a1@test.com', ssoToken: 'tok1' });
    await pool.addAccount({ email: 'a2@test.com', ssoToken: 'tok2' });

    const first = await pool.getNextAvailableAccount();
    assert.ok(first);
    
    // Mark cooling (429)
    await pool.markCooling(first.id);
    
    const second = await pool.getNextAvailableAccount();
    assert.notEqual(second.id, first.id);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('AccountPool CRUD operations and usage tracking', async () => {
  const tmpFile = '/tmp/grok-pool-crud-test-' + Date.now() + '.json';
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, { ACCOUNTS_FILE: tmpFile, DEFAULT_COOLDOWN_MS: 5000 });

  try {
    // Add account
    const acc = await pool.addAccount({ email: 'test@domain.com', ssoToken: 'tok_abc' });
    assert.equal(pool.getAccounts().length, 1);
    assert.equal(acc.email, 'test@domain.com');

    // Increment usage
    await pool.incrementUsage(acc.id, 250);
    assert.equal(acc.requestCount, 1);
    assert.equal(acc.totalTokens, 250);

    // Update account
    const updated = await pool.updateAccount(acc.id, { name: 'Renamed Account' });
    assert.equal(updated.name, 'Renamed Account');

    // Non-existent update returns null
    const nonExistent = await pool.updateAccount('invalid-id', { name: 'None' });
    assert.equal(nonExistent, null);

    // Reload pool from storage via init()
    const pool2 = new AccountPool(storage, { ACCOUNTS_FILE: tmpFile, DEFAULT_COOLDOWN_MS: 5000 });
    await pool2.init();
    assert.equal(pool2.getAccounts().length, 1);
    assert.equal(pool2.getAccounts()[0].name, 'Renamed Account');
    assert.equal(pool2.getAccounts()[0].requestCount, 1);

    // Delete account
    const deleted = await pool.deleteAccount(acc.id);
    assert.equal(deleted, true);
    assert.equal(pool.getAccounts().length, 0);

    const deletedAgain = await pool.deleteAccount(acc.id);
    assert.equal(deletedAgain, false);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('AccountPool auto-recovers cooling accounts when cooldown expires', async () => {
  const tmpFile = '/tmp/grok-pool-cooldown-test-' + Date.now() + '.json';
  const pool = new AccountPool(new JsonStorage(), { ACCOUNTS_FILE: tmpFile, DEFAULT_COOLDOWN_MS: 50 });

  try {
    const acc = await pool.addAccount({ email: 'cooling@test.com' });
    // Set cooling with short cooldown
    await pool.markCooling(acc.id, 10);
    assert.equal(acc.status, 'cooling');

    // Wait 20ms for cooldown to expire
    await new Promise(resolve => setTimeout(resolve, 20));

    const next = await pool.getNextAvailableAccount();
    assert.ok(next);
    assert.equal(next.id, acc.id);
    assert.equal(next.status, 'active');
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('AccountPool batchImportAccounts handles array import, updates, and skips', async () => {
  const tmpFile = '/tmp/grok-pool-batch-test-' + Date.now() + '.json';
  const pool = new AccountPool(new JsonStorage(), { ACCOUNTS_FILE: tmpFile });

  try {
    // 1. Initial import of 2 accounts
    const initialData = [
      { email: 'user1@test.com', ssoToken: 'tok1', name: 'Node 1' },
      { email: 'user2@test.com', sso_cookie: 'tok2', refreshToken: 'ref2' }
    ];
    const res1 = await pool.batchImportAccounts(initialData);
    assert.equal(res1.success, true);
    assert.equal(res1.added, 2);
    assert.equal(res1.updated, 0);
    assert.equal(res1.total, 2);
    assert.equal(pool.getAccounts().length, 2);

    // 2. Import with overwrite = true (updates user1, adds user3)
    const updateData = [
      { email: 'user1@test.com', ssoToken: 'tok1_updated' },
      { email: 'user3@test.com', ssoToken: 'tok3' }
    ];
    const res2 = await pool.batchImportAccounts(updateData, { overwrite: true });
    assert.equal(res2.added, 1);
    assert.equal(res2.updated, 1);
    assert.equal(res2.total, 3);
    const updatedUser1 = pool.getAccounts().find(a => a.email === 'user1@test.com');
    assert.equal(updatedUser1.ssoToken, 'tok1_updated');

    // 3. Import with overwrite = false (skips user1, adds user4)
    const skipData = [
      { email: 'user1@test.com', ssoToken: 'tok1_should_not_update' },
      { email: 'user4@test.com', ssoToken: 'tok4' }
    ];
    const res3 = await pool.batchImportAccounts(skipData, { overwrite: false });
    assert.equal(res3.added, 1);
    assert.equal(res3.updated, 0);
    assert.equal(res3.skipped, 1);
    assert.equal(res3.total, 4);
    assert.equal(updatedUser1.ssoToken, 'tok1_updated');

    // 4. Invalid data checks
    await assert.rejects(() => pool.batchImportAccounts('not-array'), /Array/);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});
