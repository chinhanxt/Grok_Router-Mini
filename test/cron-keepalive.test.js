import test from 'node:test';
import assert from 'node:assert/strict';
import cronHandler from '../api/cron-keepalive.js';
import { kvSet, kvGet } from '../api/lib/kv.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) { this.headers[key] = val; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    end() { return this; }
  };
}

test('cron-keepalive rejects unauthorized requests', async () => {
  const req = {
    method: 'GET',
    url: '/api/cron-keepalive',
    headers: {}
  };
  const res = createMockRes();
  await cronHandler(req, res);
  assert.equal(res.statusCode, 401);
  assert.ok(res.body.error);
});

test('cron-keepalive accepts vercel cron header and refreshes tokens', async () => {
  const originalFetch = globalThis.fetch;

  // Seed package in memoryStore
  const sampleNodes = [
    {
      id: 'node-1',
      name: 'Node 1',
      ssoToken: 'old-access',
      refreshToken: 'refresh-valid',
      status: 'active'
    },
    {
      id: 'node-2',
      name: 'Node 2',
      ssoToken: 'old-access-2',
      refreshToken: 'refresh-dead',
      status: 'active'
    },
    {
      id: 'node-3',
      name: 'Node 3 Fresh',
      ssoToken: 'fresh-access',
      refreshToken: 'refresh-fresh',
      status: 'active',
      lastRefreshedAt: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
    }
  ];

  await kvSet('node_packages', [{ id: 'test-pkg', name: 'Test Pkg', isDefault: true }]);
  await kvSet('package_test-pkg', sampleNodes);

  globalThis.fetch = async (url, opts) => {
    if (url.includes('/oauth2/token')) {
      if (opts.body.includes('refresh-valid')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access-valid',
            refresh_token: 'new-refresh-valid',
            expires_in: 86400
          })
        };
      }
      if (opts.body.includes('refresh-dead')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Token expired'
          })
        };
      }
    }
    return { ok: false, status: 500 };
  };

  try {
    const req = {
      method: 'GET',
      url: '/api/cron-keepalive',
      headers: {
        'x-vercel-cron': '1'
      }
    };
    const res = createMockRes();
    await cronHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.summary.refreshed, 1);
    assert.equal(res.body.summary.expired, 1);
    assert.equal(res.body.summary.skipped, 1);

    // Verify KV state
    const updatedNodes = await kvGet('package_test-pkg');
    assert.equal(updatedNodes[0].ssoToken, 'new-access-valid');
    assert.equal(updatedNodes[0].refreshToken, 'new-refresh-valid');
    assert.equal(updatedNodes[0].status, 'active');
    assert.ok(updatedNodes[0].lastRefreshedAt);

    assert.equal(updatedNodes[1].status, 'expired');

    const lastRun = await kvGet('keepalive_last_run');
    assert.ok(lastRun.timestamp);
    assert.equal(lastRun.refreshed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
