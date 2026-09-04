import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { startServer } from '../src/server.js';
import { AppConfig } from '../src/config.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';
import { AccountPool } from '../src/services/AccountPool.js';
import { UserService } from '../src/services/UserService.js';
import { ProxyService } from '../src/services/ProxyService.js';

test('createApp mounts static files and API routes', () => {
  const config = new AppConfig({ DATA_DIR: '/tmp/test-app-' + Date.now() });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  const userService = new UserService(storage, config);
  const proxyService = new ProxyService(pool, config);
  const app = createApp({ config, pool, userService, proxyService });
  assert.ok(app);
});

test('createApp serves public/index.html at GET / and static assets', async () => {
  const tmpDir = '/tmp/test-app-static-' + Date.now();
  const config = new AppConfig({ DATA_DIR: tmpDir });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  const userService = new UserService(storage, config);
  const proxyService = new ProxyService(pool, config);
  const app = createApp({ config, pool, userService, proxyService });

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Grok Router') || html.includes('<!DOCTYPE html>'));
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createApp mounts auth and account routes with role isolation', async () => {
  const tmpDir = '/tmp/test-app-auth-' + Date.now();
  const config = new AppConfig({ DATA_DIR: tmpDir, AUTH_SECRET: 'test-app-secret' });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  await pool.init();
  const userService = new UserService(storage, config);
  await userService.init();
  const proxyService = new ProxyService(pool, config);

  const app = createApp({ config, pool, userService, proxyService });
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Login with seeded admin
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@local.com', password: 'admin123' })
    });
    assert.equal(loginRes.status, 200);
    const { token, user } = await loginRes.json();
    assert.ok(token);
    assert.equal(user.role, 'admin');

    // 2. Fetch /api/auth/me
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.email, 'admin@local.com');

    // 3. Admin can list accounts at /api/accounts
    const accRes = await fetch(`${baseUrl}/api/accounts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(accRes.status, 200);
    const accounts = await accRes.json();
    assert.ok(Array.isArray(accounts));

    // 4. Create regular user and verify 403 on /api/accounts
    const newUser = await userService.createUser('user@local.com', 'user123', 'user');
    const userToken = userService.createToken({ userId: newUser.id, email: newUser.email, role: 'user' });
    const userAccRes = await fetch(`${baseUrl}/api/accounts`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(userAccRes.status, 403);
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createApp mounts setup routes and proxy endpoints with auth guard', async () => {
  const tmpDir = '/tmp/test-app-routes-' + Date.now();
  const config = new AppConfig({ DATA_DIR: tmpDir, AUTH_SECRET: 'route-secret' });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  const userService = new UserService(storage, config);
  await userService.init();
  const proxyService = new ProxyService(pool, config);
  const app = createApp({ config, pool, userService, proxyService });

  const token = userService.createToken({ email: 'tester@local.com', role: 'user' });

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Setup scripts are public
    const shRes = await fetch(`${baseUrl}/claude.sh`);
    assert.equal(shRes.status, 200);
    const psRes = await fetch(`${baseUrl}/claude.ps1`);
    assert.equal(psRes.status, 200);
    const cmdRes = await fetch(`${baseUrl}/claude.cmd`);
    assert.equal(cmdRes.status, 200);

    // Unauthenticated proxy call returns 401
    const unauthRes = await fetch(`${baseUrl}/v1/models`);
    assert.equal(unauthRes.status, 401);

    // Authenticated proxy call returns 200
    const authRes = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(authRes.status, 200);
    const models = await authRes.json();
    assert.ok(models.data && models.data.length > 0);
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('startServer initializes services, listens on port, and terminates cleanly', async () => {
  const tmpDir = '/tmp/test-server-boot-' + Date.now();
  const config = new AppConfig({ DATA_DIR: tmpDir });
  const serverInstance = await startServer({ port: 0, host: '127.0.0.1', config });

  try {
    const addr = serverInstance.address();
    assert.ok(addr && addr.port > 0);

    // Verify index.html served on root
    const rootRes = await fetch(`http://127.0.0.1:${addr.port}/`);
    assert.equal(rootRes.status, 200);

    // Verify status endpoint
    const statusRes = await fetch(`http://127.0.0.1:${addr.port}/api/status`);
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.status, 'ok');

    // Verify unauth models 401
    const unauthRes = await fetch(`http://127.0.0.1:${addr.port}/v1/models`);
    assert.equal(unauthRes.status, 401);

    // Verify auth models 200 with admin token
    const token = serverInstance.userService.createToken({ email: 'admin@local.com', role: 'admin' });
    const authRes = await fetch(`http://127.0.0.1:${addr.port}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(authRes.status, 200);
  } finally {
    await new Promise((resolve) => serverInstance.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('adminGuard fails closed on /api/logs if authMiddleware is missing', async () => {
  const app = createApp({});
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const getRes = await fetch(`http://127.0.0.1:${port}/api/logs`);
    assert.equal(getRes.status, 403);
    const delRes = await fetch(`http://127.0.0.1:${port}/api/logs`, { method: 'DELETE' });
    assert.equal(delRes.status, 403);
  } finally {
    server.close();
  }
});

