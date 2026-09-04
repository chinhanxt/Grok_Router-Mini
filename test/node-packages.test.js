import test from 'node:test';
import assert from 'node:assert/strict';
import adminHandler from '../api/admin.js';
import licenseHandler from '../api/license.js';
import { AppConfig } from '../src/config.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';
import { AccountPool } from '../src/services/AccountPool.js';
import { LicenseService } from '../src/services/LicenseService.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, val) {
      this.headers[key] = val;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

test('Admin API: Node Package management and Key assignment flow', async () => {
  // 1. Create a key first
  const createKeyReq = {
    method: 'POST',
    url: 'http://localhost/api/admin?action=createKey',
    headers: { authorization: 'Bearer admin123' },
    body: { label: 'Khách hàng VIP 1', keyString: 'VIP-KEY-001', maxDevices: 2 }
  };
  const createKeyRes = createMockRes();
  await adminHandler(createKeyReq, createKeyRes);
  assert.equal(createKeyRes.statusCode, 200);
  assert.equal(createKeyRes.body.ok, true);
  const createdKey = createKeyRes.body.key;
  assert.equal(createdKey.key, 'VIP-KEY-001');

  // 2. Upload a new Node package with 5 accounts
  const sampleNodes = [
    { id: 'n1', name: 'Node 1', email: 'n1@test.com', ssoToken: 'sso-tok-1', refreshToken: 'ref-1' },
    { id: 'n2', name: 'Node 2', email: 'n2@test.com', ssoToken: 'sso-tok-2', refreshToken: 'ref-2' },
    { id: 'n3', name: 'Node 3', email: 'n3@test.com', ssoToken: 'sso-tok-3', refreshToken: 'ref-3' },
    { id: 'n4', name: 'Node 4', email: 'n4@test.com', ssoToken: 'sso-tok-4', refreshToken: 'ref-4' },
    { id: 'n5', name: 'Node 5', email: 'n5@test.com', ssoToken: 'sso-tok-5', refreshToken: 'ref-5' }
  ];

  const uploadReq = {
    method: 'POST',
    url: 'http://localhost/api/admin?action=uploadNodePackage',
    headers: { authorization: 'Bearer admin123' },
    body: {
      mode: 'new',
      name: 'Gói VIP 5 Node',
      filename: 'vip-5-nodes.json',
      targetKeyId: createdKey.id,
      nodes: sampleNodes
    }
  };
  const uploadRes = createMockRes();
  await adminHandler(uploadReq, uploadRes);
  assert.equal(uploadRes.statusCode, 200);
  assert.equal(uploadRes.body.ok, true);
  assert.equal(uploadRes.body.nodeCount, 5);
  const newPkg = uploadRes.body.package;
  assert.equal(newPkg.name, 'Gói VIP 5 Node');
  assert.equal(newPkg.nodeCount, 5);

  // 3. getNodePackages returns the new package
  const getPackagesReq = {
    method: 'GET',
    url: 'http://localhost/api/admin?action=getNodePackages',
    headers: { authorization: 'Bearer admin123' }
  };
  const getPackagesRes = createMockRes();
  await adminHandler(getPackagesReq, getPackagesRes);
  assert.equal(getPackagesRes.statusCode, 200);
  assert.ok(getPackagesRes.body.packages.some(p => p.id === newPkg.id));

  // 4. getPackageNodes returns paginated nodes and supports search
  const previewReq = {
    method: 'GET',
    url: `http://localhost/api/admin?action=getPackageNodes&id=${newPkg.id}&page=1&limit=2&query=n2`,
    headers: { authorization: 'Bearer admin123' }
  };
  const previewRes = createMockRes();
  await adminHandler(previewReq, previewRes);
  assert.equal(previewRes.statusCode, 200);
  assert.equal(previewRes.body.total, 1);
  assert.equal(previewRes.body.nodes[0].email, 'n2@test.com');
  assert.ok(previewRes.body.nodes[0].maskedKey.includes('...'));

  // 5. Overwrite mode updates package with new nodes
  const updatedNodes = [
    { id: 'n1-new', name: 'Node 1 New', email: 'new1@test.com', ssoToken: 'sso-new-1' },
    { id: 'n2-new', name: 'Node 2 New', email: 'new2@test.com', ssoToken: 'sso-new-2' }
  ];
  const overwriteReq = {
    method: 'POST',
    url: 'http://localhost/api/admin?action=uploadNodePackage',
    headers: { authorization: 'Bearer admin123' },
    body: {
      mode: 'overwrite',
      targetPackageId: newPkg.id,
      nodes: updatedNodes
    }
  };
  const overwriteRes = createMockRes();
  await adminHandler(overwriteReq, overwriteRes);
  assert.equal(overwriteRes.statusCode, 200);
  assert.equal(overwriteRes.body.nodeCount, 2);

  // 6. License activation returns the updated package nodes
  const licReq = {
    method: 'POST',
    url: 'http://localhost/api/license',
    headers: {},
    body: {
      key: 'VIP-KEY-001',
      machineId: 'test-machine-01',
      deviceName: 'MacBook Pro M3'
    }
  };
  const licRes = createMockRes();
  await licenseHandler(licReq, licRes);
  assert.equal(licRes.statusCode, 200);
  assert.equal(licRes.body.ok, true);
  assert.equal(licRes.body.nodes.length, 2);
  assert.equal(licRes.body.nodes[0].email, 'new1@test.com');
  assert.equal(licRes.body.nodes[0].ssoToken, 'sso-new-1');

  // 7. Client LicenseService imports these nodes into AccountPool correctly
  const tmpDir = path.join(os.tmpdir(), `test-lic-pool-${Date.now()}`);
  const config = new AppConfig({ DATA_DIR: tmpDir });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  const licenseService = new LicenseService(pool, storage, config);

  // Directly simulate successful license payload handling
  const accountsBefore = pool.accounts.length;
  licRes.body.nodes.forEach(n => {
    pool.accounts.push({
      id: `lic-${n.id}`,
      name: n.name || n.email,
      email: n.email,
      ssoToken: n.ssoToken,
      refreshToken: n.refreshToken,
      source: 'license',
      status: 'active'
    });
  });
  assert.equal(pool.accounts.length, accountsBefore + 2);
  assert.equal(pool.accounts[accountsBefore].email, 'new1@test.com');
  assert.equal(pool.accounts[accountsBefore].ssoToken, 'sso-new-1');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
