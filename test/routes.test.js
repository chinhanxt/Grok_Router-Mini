import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSetupRouter } from '../src/routes/setupRoutes.js';
import { createAccountRouter } from '../src/routes/accountRoutes.js';
import { AccountPool } from '../src/services/AccountPool.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';
import { UserService } from '../src/services/UserService.js';
import { createAuthMiddleware } from '../src/middlewares/AuthMiddleware.js';

test('Setup routes export valid script templates', () => {
  const router = createSetupRouter();
  assert.ok(router);
});

test('Setup routes return correct bash, powershell, and cmd scripts with dynamic host and models', async () => {
  const app = express();
  app.use('/', createSetupRouter());

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Bash script: /claude.sh
    const bashRes = await fetch(`${baseUrl}/claude.sh?key=test-token-bash`, {
      headers: { host: `127.0.0.1:${port}` }
    });
    assert.equal(bashRes.status, 200);
    assert.ok(bashRes.headers.get('content-type')?.includes('text/x-shellscript') || bashRes.headers.get('content-type')?.includes('text/plain'));
    const bashText = await bashRes.text();
    assert.ok(bashText.includes(`ANTHROPIC_BASE_URL="http://127.0.0.1:${port}"`));
    assert.ok(bashText.includes('ANTHROPIC_AUTH_TOKEN="test-token-bash"'));
    assert.ok(bashText.includes('claude-sonnet-5'));
    assert.ok(bashText.includes('claude-opus-5'));
    assert.ok(bashText.includes('claude-haiku-4-5'));
    assert.ok(bashText.includes('settings.json'));
    assert.ok(bashText.includes('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"'));

    // Test alias: /install.sh
    const bashAliasRes = await fetch(`${baseUrl}/install.sh`);
    assert.equal(bashAliasRes.status, 200);

    // 2. PowerShell script: /claude.ps1
    const psRes = await fetch(`${baseUrl}/claude.ps1?key=test-token-ps1`, {
      headers: { 'x-forwarded-host': 'my-domain.com:443', 'x-forwarded-proto': 'https' }
    });
    assert.equal(psRes.status, 200);
    assert.ok(psRes.headers.get('content-type')?.includes('text/plain'));
    const psText = await psRes.text();
    assert.ok(psText.includes('$baseUrl = "https://my-domain.com:443"'));
    assert.ok(psText.includes('$apiKey = "test-token-ps1"'));
    assert.ok(psText.includes('claude-sonnet-5'));
    assert.ok(psText.includes('claude-opus-5'));
    assert.ok(psText.includes('claude-haiku-4-5'));
    assert.ok(psText.includes('settings.json'));
    assert.ok(psText.includes('SetEnvironmentVariable'));

    // 3. Windows CMD script: /claude.cmd
    const cmdRes = await fetch(`${baseUrl}/claude.cmd?key=test-token-cmd`, {
      headers: { host: `127.0.0.1:${port}` }
    });
    assert.equal(cmdRes.status, 200);
    assert.ok(cmdRes.headers.get('content-type')?.includes('text/plain'));
    const cmdText = await cmdRes.text();
    assert.ok(cmdText.includes(`set "BASE_URL=http://127.0.0.1:${port}"`));
    assert.ok(cmdText.includes('set "API_KEY=test-token-cmd"'));
    assert.ok(cmdText.includes('claude-sonnet-5'));
    assert.ok(cmdText.includes('claude-opus-5'));
    assert.ok(cmdText.includes('claude-haiku-4-5'));
    assert.ok(cmdText.includes('setx ANTHROPIC_BASE_URL'));
  } finally {
    server.close();
  }
});

test('Account routes are strictly guarded by requireAdmin', async () => {
  const tmpUsers = '/tmp/grok-routes-users-' + Date.now() + '.json';
  const tmpAccounts = '/tmp/grok-routes-accounts-' + Date.now() + '.json';
  const storage = new JsonStorage();
  const userService = new UserService(storage, { USERS_FILE: tmpUsers, AUTH_SECRET: 'routes-secret' });
  await userService.init();

  const userAcc = await userService.createUser('user@local.com', 'userpass', 'user');
  const userToken = userService.createToken({ userId: userAcc.id, email: userAcc.email, role: 'user' });
  const adminToken = userService.createToken({ userId: 'admin', email: 'admin@local.com', role: 'admin' });

  const pool = new AccountPool(storage, { ACCOUNTS_FILE: tmpAccounts });
  await pool.init();

  const authMiddleware = createAuthMiddleware(userService);
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', createAccountRouter(pool, authMiddleware));

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated request -> 401
    const unauthRes = await fetch(`${baseUrl}/api/accounts`);
    assert.equal(unauthRes.status, 401);

    // 2. Non-admin request -> 403 Forbidden
    const nonAdminGet = await fetch(`${baseUrl}/api/accounts`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(nonAdminGet.status, 403);
    const nonAdminData = await nonAdminGet.json();
    assert.equal(nonAdminData.error, 'Chỉ Admin mới có quyền truy cập.');

    const nonAdminPost = await fetch(`${baseUrl}/api/accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hacker@x.ai', ssoToken: 'bad' })
    });
    assert.equal(nonAdminPost.status, 403);

    const nonAdminPut = await fetch(`${baseUrl}/api/accounts/123`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cooling' })
    });
    assert.equal(nonAdminPut.status, 403);

    const nonAdminDelete = await fetch(`${baseUrl}/api/accounts/123`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(nonAdminDelete.status, 403);

    // 3. Admin request -> allowed
    const adminGet = await fetch(`${baseUrl}/api/accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminGet.status, 200);
    const accounts = await adminGet.json();
    assert.ok(Array.isArray(accounts));
    assert.equal(accounts.length, 0);
  } finally {
    server.close();
  }
});

test('Account routes provide full CRUD for admin', async () => {
  const tmpUsers = '/tmp/grok-crud-users-' + Date.now() + '.json';
  const tmpAccounts = '/tmp/grok-crud-accounts-' + Date.now() + '.json';
  const storage = new JsonStorage();
  const userService = new UserService(storage, { USERS_FILE: tmpUsers, AUTH_SECRET: 'crud-secret' });
  await userService.init();

  const adminToken = userService.createToken({ userId: 'admin', email: 'admin@local.com', role: 'admin' });
  const pool = new AccountPool(storage, { ACCOUNTS_FILE: tmpAccounts });
  await pool.init();

  const authMiddleware = createAuthMiddleware(userService);
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', createAccountRouter(pool, authMiddleware));

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. POST /api/accounts (Create account)
    const createRes = await fetch(`${baseUrl}/api/accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Main Grok',
        email: 'admin-grok@x.ai',
        ssoToken: 'sso_token_123',
        refreshToken: 'refresh_tok_123'
      })
    });
    assert.ok(createRes.status === 200 || createRes.status === 201);
    const created = await createRes.json();
    assert.ok(created.id);
    assert.equal(created.name, 'Main Grok');
    assert.equal(created.email, 'admin-grok@x.ai');

    const accountId = created.id;

    // 2. GET /api/accounts (List accounts)
    const listRes = await fetch(`${baseUrl}/api/accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, accountId);

    // 3. PUT /api/accounts/:id (Update account)
    const updateRes = await fetch(`${baseUrl}/api/accounts/${accountId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Renamed Grok',
        status: 'cooling'
      })
    });
    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.name, 'Renamed Grok');
    assert.equal(updated.status, 'cooling');

    // 4. PUT /api/accounts/non-existent-id -> 404
    const notFoundPut = await fetch(`${baseUrl}/api/accounts/non-existent-id`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'Ghost' })
    });
    assert.equal(notFoundPut.status, 404);

    // 5. DELETE /api/accounts/:id (Delete account)
    const deleteRes = await fetch(`${baseUrl}/api/accounts/${accountId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(deleteRes.status, 200);
    const deleteResult = await deleteRes.json();
    assert.equal(deleteResult.success, true);
    assert.equal(deleteResult.id, accountId);

    // Verify empty list after deletion
    const verifyList = await fetch(`${baseUrl}/api/accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const afterDelete = await verifyList.json();
    assert.equal(afterDelete.length, 0);

    // 6. DELETE /api/accounts/non-existent-id -> 404
    const notFoundDelete = await fetch(`${baseUrl}/api/accounts/non-existent-id`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(notFoundDelete.status, 404);

    // 7. PATCH /api/accounts/:id
    const addAnother = await pool.addAccount({ name: 'Patchable Grok' });
    const patchRes = await fetch(`${baseUrl}/api/accounts/${addAnother.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'disabled' })
    });
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json();
    assert.equal(patched.status, 'disabled');
  } finally {
    server.close();
  }
});

test('createAccountRouter defaults to 403 when no authMiddleware is provided', async () => {
  const pool = { getAccounts: () => [] };
  const app = express();
  app.use('/api/accounts', createAccountRouter(pool));

  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/accounts`);
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('createSetupRouter uses config API_KEY when query param is absent', async () => {
  const app = express();
  app.use('/', createSetupRouter({ API_KEY: 'sk-config-key-123' }));

  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/claude.sh`);
    const text = await res.text();
    assert.ok(text.includes('ANTHROPIC_AUTH_TOKEN="sk-config-key-123"'));
  } finally {
    server.close();
  }
});

