import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeHealthService } from '../src/services/NodeHealthService.js';
import { Account } from '../src/core/Account.js';
import { AccountPool } from '../src/services/AccountPool.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';
import { AppConfig } from '../src/config.js';
import path from 'node:path';
import os from 'node:os';

function createTestPool() {
  const tmpDir = path.join(os.tmpdir(), 'grok-health-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const config = new AppConfig({ DATA_DIR: tmpDir });
  const storage = new JsonStorage();
  return { pool: new AccountPool(storage, config), config, tmpDir };
}

test('NodeHealthService decodes JWT payload or returns null', () => {
  const service = new NodeHealthService(null, {});
  assert.equal(service.decodeJwt(''), null);
  assert.equal(service.decodeJwt('invalid.token'), null);

  const payload = Buffer.from(JSON.stringify({ exp: 1788500000, sub: 'user-1' })).toString('base64url');
  const fakeJwt = `header.${payload}.sig`;
  const decoded = service.decodeJwt(fakeJwt);
  assert.equal(decoded.exp, 1788500000);
  assert.equal(decoded.sub, 'user-1');
});

test('refreshAccountToken updates credentials on success', async () => {
  const { pool, config } = createTestPool();
  const acc = new Account({
    email: 'test@example.com',
    ssoToken: 'old-access',
    refreshToken: 'valid-refresh-token',
    status: 'cooling',
    cooldownUntil: Date.now() + 60000
  });
  pool.accounts.push(acc);

  const service = new NodeHealthService(pool, config);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.ok(url.includes('/oauth2/token'));
    assert.ok(opts.body.includes('valid-refresh-token'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'new-access-token-123',
        refresh_token: 'new-refresh-token-456',
        expires_in: 21600
      })
    };
  };

  try {
    const res = await service.refreshAccountToken(acc);
    assert.equal(res.success, true);
    assert.equal(acc.ssoToken, 'new-access-token-123');
    assert.equal(acc.refreshToken, 'new-refresh-token-456');
    assert.equal(acc.status, 'active');
    assert.equal(acc.cooldownUntil, 0);
    assert.ok(acc.expiresAt > Date.now());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshAccountToken disables account on 400/401 revoked token', async () => {
  const { pool, config } = createTestPool();
  const acc = new Account({
    email: 'revoked@example.com',
    ssoToken: 'tok',
    refreshToken: 'bad-refresh',
    status: 'active'
  });
  pool.accounts.push(acc);

  const service = new NodeHealthService(pool, config);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => '{"error":"invalid_grant"}'
  });

  try {
    const res = await service.refreshAccountToken(acc);
    assert.equal(res.success, false);
    assert.equal(res.disabled, true);
    assert.equal(acc.status, 'disabled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('checkAllNodes recovers cooling and refreshes expiring nodes', async () => {
  const { pool, config } = createTestPool();
  const acc1 = new Account({
    email: 'cooled@example.com',
    ssoToken: 'tok1',
    refreshToken: 'ref1',
    status: 'cooling',
    cooldownUntil: Date.now() - 1000, // expired cooldown
    expiresAt: Date.now() + 86400000 // valid for 24h
  });
  const acc2 = new Account({
    email: 'expiring@example.com',
    ssoToken: 'tok2',
    refreshToken: 'ref2',
    status: 'active',
    expiresAt: Date.now() + 5000 // expiring in 5s
  });
  pool.accounts.push(acc1, acc2);

  const service = new NodeHealthService(pool, config);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'refreshed-tok',
      expires_in: 3600
    })
  });

  try {
    const stats = await service.checkAllNodes();
    assert.equal(stats.total, 2);
    assert.equal(stats.recovered, 1);
    assert.equal(stats.refreshed, 1);
    assert.equal(acc1.status, 'active');
    assert.equal(acc2.ssoToken, 'refreshed-tok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startBackgroundWorker and stopBackgroundWorker manage timer cleanly', () => {
  const { pool, config } = createTestPool();
  const service = new NodeHealthService(pool, config);
  const timer = service.startBackgroundWorker(60000);
  assert.ok(timer);
  assert.equal(service.timer, timer);
  service.stopBackgroundWorker();
  assert.equal(service.timer, null);
});
