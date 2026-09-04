import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { AppConfig } from '../src/config.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';
import { AccountPool } from '../src/services/AccountPool.js';
import { LicenseService } from '../src/services/LicenseService.js';

test('LicenseService initializes with machineId and gets empty status', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-lic-${Date.now()}`);
  const config = new AppConfig({ DATA_DIR: tmpDir });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  const licenseService = new LicenseService(pool, storage, config);

  try {
    assert.ok(licenseService.machineId);
    const status = await licenseService.getStatus();
    assert.equal(status.active, false);
    assert.equal(status.key, null);
    assert.equal(status.nodeCount, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LicenseService handles validation errors and activation failure gracefully', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-lic-err-${Date.now()}`);
  const config = new AppConfig({ DATA_DIR: tmpDir });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  const licenseService = new LicenseService(pool, storage, config);

  try {
    // Empty key returns error
    const emptyRes = await licenseService.activate('');
    assert.equal(emptyRes.ok, false);

    // Invalid server returns connection error
    const failRes = await licenseService.activate('INVALID-KEY', 'http://127.0.0.1:59999');
    assert.equal(failRes.ok, false);
    assert.ok(failRes.error.includes('Không thể kết nối'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('licenseRoutes mount on /api/license and respond to HTTP requests', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-lic-routes-${Date.now()}`);
  const config = new AppConfig({ DATA_DIR: tmpDir });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  const licenseService = new LicenseService(pool, storage, config);
  const app = createApp({ config, pool, licenseService });

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // GET /api/license
    const getRes = await fetch(`${baseUrl}/api/license`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.ok, true);
    assert.equal(getData.license.active, false);

    // POST /api/license/activate without key returns 400
    const emptyPost = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(emptyPost.status, 400);

    // DELETE /api/license deactivates cleanly
    const delRes = await fetch(`${baseUrl}/api/license`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.equal(delData.ok, true);
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
