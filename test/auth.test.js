import test from 'node:test';
import assert from 'node:assert/strict';
import { UserService } from '../src/services/UserService.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';
import { createAuthMiddleware } from '../src/middlewares/AuthMiddleware.js';
import { createAuthRouter } from '../src/routes/authRoutes.js';

test('UserService seeds default admin and handles login/token verification', async () => {
  const tmpFile = '/tmp/grok-users-test-' + Date.now() + '.json';
  const service = new UserService(new JsonStorage(), { USERS_FILE: tmpFile, AUTH_SECRET: 'test-secret' });
  await service.init(); // Seeds admin

  const loginRes = await service.login('admin@local.com', 'admin123');
  assert.ok(loginRes.token);
  assert.equal(loginRes.user.role, 'admin');

  const verified = service.verifyToken(loginRes.token);
  assert.equal(verified.email, 'admin@local.com');
  assert.equal(verified.role, 'admin');
});

test('UserService handles user creation, duplicate prevention, and credential validation', async () => {
  const tmpFile = '/tmp/grok-users-test-' + Date.now() + '.json';
  const service = new UserService(new JsonStorage(), { USERS_FILE: tmpFile, AUTH_SECRET: 'test-secret' });
  await service.init();

  // Invalid password
  await assert.rejects(
    () => service.login('admin@local.com', 'wrongpass'),
    /Sai tài khoản hoặc mật khẩu/
  );

  // Non-existent email
  await assert.rejects(
    () => service.login('unknown@domain.com', 'admin123'),
    /Sai tài khoản hoặc mật khẩu/
  );

  // Create standard user
  const newUser = await service.createUser('user@local.com', 'userpass', 'user');
  assert.equal(newUser.email, 'user@local.com');
  assert.equal(newUser.role, 'user');
  assert.equal(newUser.passwordHash, undefined);

  // Login as new user
  const loginUser = await service.login('user@local.com', 'userpass');
  assert.ok(loginUser.token);
  assert.equal(loginUser.user.role, 'user');

  // Prevent duplicate email
  await assert.rejects(
    () => service.createUser('user@local.com', 'anotherpass'),
    /Email đã tồn tại/
  );
});

test('UserService persists users and passwords across restarts', async () => {
  const tmpFile = '/tmp/grok-users-restart-' + Date.now() + '.json';
  const storage = new JsonStorage();
  const config = { USERS_FILE: tmpFile, AUTH_SECRET: 'test-secret' };

  // First instance: seeds admin & creates a user
  const service1 = new UserService(storage, config);
  await service1.init();
  await service1.createUser('bob@local.com', 'bobsecret', 'user');

  // Second instance: loads from storage
  const service2 = new UserService(storage, config);
  await service2.init();

  const adminLogin = await service2.login('admin@local.com', 'admin123');
  assert.ok(adminLogin.token);
  assert.equal(adminLogin.user.role, 'admin');

  const bobLogin = await service2.login('bob@local.com', 'bobsecret');
  assert.ok(bobLogin.token);
  assert.equal(bobLogin.user.role, 'user');
});

test('UserService token verification handles malformed, tampered, and expired tokens', async () => {
  const tmpFile = '/tmp/grok-users-test-' + Date.now() + '.json';
  const service = new UserService(new JsonStorage(), { USERS_FILE: tmpFile, AUTH_SECRET: 'test-secret' });
  await service.init();

  assert.equal(service.verifyToken(null), null);
  assert.equal(service.verifyToken(''), null);
  assert.equal(service.verifyToken('singlepart'), null);
  assert.equal(service.verifyToken('part1.part2'), null);

  // Valid token
  const token = service.createToken({ userId: '123', email: 'test@local.com', role: 'user' });
  assert.ok(service.verifyToken(token));

  // Tampered token
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1]}.badsignature`;
  assert.equal(service.verifyToken(tampered), null);

  // Tampered token with matching signature length
  const sameLenTamperedSig = 'x'.repeat(parts[2].length);
  assert.equal(service.verifyToken(`${parts[0]}.${parts[1]}.${sameLenTamperedSig}`), null);

  // Other secret
  const otherService = new UserService(new JsonStorage(), { USERS_FILE: tmpFile, AUTH_SECRET: 'different-secret' });
  assert.equal(otherService.verifyToken(token), null);

  // Expired token (-1000ms)
  const expiredToken = service.createToken({ userId: '123' }, -1000);
  assert.equal(service.verifyToken(expiredToken), null);
});

test('AuthMiddleware enforces requireAuth and requireAdmin', async () => {
  const tmpFile = '/tmp/grok-users-test-' + Date.now() + '.json';
  const service = new UserService(new JsonStorage(), { USERS_FILE: tmpFile, AUTH_SECRET: 'test-secret' });
  await service.init();

  const { requireAuth, requireAdmin } = createAuthMiddleware(service);

  function mockRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      }
    };
  }

  // 1. Missing token -> 401
  const reqNoToken = { headers: {} };
  const resNoToken = mockRes();
  let called = false;
  requireAuth(reqNoToken, resNoToken, () => { called = true; });
  assert.equal(called, false);
  assert.equal(resNoToken.statusCode, 401);

  // 2. Invalid token -> 401
  const reqInvalidToken = { headers: { authorization: 'Bearer invalid.token.here' } };
  const resInvalidToken = mockRes();
  called = false;
  requireAuth(reqInvalidToken, resInvalidToken, () => { called = true; });
  assert.equal(called, false);
  assert.equal(resInvalidToken.statusCode, 401);

  // 3. Valid user token with requireAuth -> passes & sets req.user
  const userToken = service.createToken({ userId: 'u1', role: 'user', email: 'user@local.com' });
  const reqUser = { headers: { authorization: `Bearer ${userToken}` } };
  const resUser = mockRes();
  called = false;
  requireAuth(reqUser, resUser, () => { called = true; });
  assert.equal(called, true);
  assert.equal(reqUser.user.role, 'user');

  // 4. x-auth-token header support
  const reqXAuth = { headers: { 'x-auth-token': userToken } };
  called = false;
  requireAuth(reqXAuth, mockRes(), () => { called = true; });
  assert.equal(called, true);

  // 5. Non-admin accessing requireAdmin -> 403
  const resForbidden = mockRes();
  called = false;
  requireAdmin(reqUser, resForbidden, () => { called = true; });
  assert.equal(called, false);
  assert.equal(resForbidden.statusCode, 403);

  // 6. Admin accessing requireAdmin -> passes
  const adminToken = service.createToken({ userId: 'a1', role: 'admin', email: 'admin@local.com' });
  const reqAdmin = { headers: { authorization: `Bearer ${adminToken}` } };
  const resAdmin = mockRes();
  called = false;
  requireAdmin(reqAdmin, resAdmin, () => { called = true; });
  assert.equal(called, true);
});

test('createAuthRouter sets up /login, /me, and /users endpoints', async () => {
  const tmpFile = '/tmp/grok-users-test-' + Date.now() + '.json';
  const service = new UserService(new JsonStorage(), { USERS_FILE: tmpFile, AUTH_SECRET: 'test-secret' });
  await service.init();
  const middleware = createAuthMiddleware(service);
  const router = createAuthRouter(service, middleware);

  assert.ok(router);
  // Verify router stack has the routes
  const routes = router.stack
    .filter(layer => layer.route)
    .map(layer => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));
  
  assert.ok(routes.some(r => r.path === '/login' && r.methods.includes('post')));
  assert.ok(routes.some(r => r.path === '/me' && r.methods.includes('get')));
  assert.ok(routes.some(r => r.path === '/users' && r.methods.includes('post')));
});
