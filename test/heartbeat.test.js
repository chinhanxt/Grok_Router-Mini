import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { AppConfig } from "../src/config.js";
import { JsonStorage } from "../src/storage/JsonStorage.js";
import { AccountPool } from "../src/services/AccountPool.js";
import { LicenseService } from "../src/services/LicenseService.js";
import { LicenseHeartbeat } from "../src/services/LicenseHeartbeat.js";

function setupTestEnv() {
  const tmpDir = path.join(os.tmpdir(), "test-heartbeat-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(tmpDir, { recursive: true });
  const config = new AppConfig({ DATA_DIR: tmpDir });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  const licService = new LicenseService(pool, storage, config);
  const heartbeat = new LicenseHeartbeat(licService, pool, storage, config);
  return { tmpDir, config, storage, pool, licService, heartbeat };
}

test("LicenseHeartbeat: returns active false when no license configured", async () => {
  const env = setupTestEnv();
  const res = await env.heartbeat.checkHeartbeat();
  assert.equal(res.active, false);
  fs.rmSync(env.tmpDir, { recursive: true, force: true });
});

test("LicenseHeartbeat: purges all accounts from RAM and disk when triggered", async () => {
  const env = setupTestEnv();
  // Populate pool with dummy accounts
  env.pool.accounts = [
    { id: "node-1", ssoToken: "tok-1", status: "active" },
    { id: "node-2", ssoToken: "tok-2", status: "active" }
  ];
  await env.pool.save();
  assert.equal(env.pool.accounts.length, 2);

  // Write active license
  await env.storage.write(env.licService.licenseFile, { active: true, key: "TEST-KEY", nodeCount: 2 });

  // Trigger purge
  await env.heartbeat.purgeAllAccounts("License revoked");

  // Verify accounts wiped from RAM and storage
  assert.equal(env.pool.accounts.length, 0);
  const savedAccounts = await env.storage.read(path.join(env.tmpDir, "accounts.json"), []);
  assert.equal(savedAccounts.length, 0);

  // Verify license set to inactive
  const lic = await env.storage.read(env.licService.licenseFile, {});
  assert.equal(lic.active, false);
  assert.equal(lic.revokeReason, "License revoked");

  fs.rmSync(env.tmpDir, { recursive: true, force: true });
});

test("LicenseHeartbeat: wipes accounts if disconnected for more than 15 minutes", async () => {
  const env = setupTestEnv();
  env.pool.accounts = [{ id: "n1", ssoToken: "tok1", status: "active" }];
  await env.pool.save();

  // License synced 20 minutes ago
  const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await env.storage.write(env.licService.licenseFile, {
    active: true,
    key: "EXPIRED-SYNC-KEY",
    lastHeartbeat: twentyMinsAgo,
    serverUrl: "http://127.0.0.1:9999" // Unreachable port
  });

  const res = await env.heartbeat.checkHeartbeat(15 * 60 * 1000);
  assert.equal(res.ok, false);
  assert.equal(res.wiped, true);
  assert.equal(env.pool.accounts.length, 0);

  fs.rmSync(env.tmpDir, { recursive: true, force: true });
});

test("LicenseHeartbeat: allows offline grace period if under 15 minutes", async () => {
  const env = setupTestEnv();
  env.pool.accounts = [{ id: "n1", ssoToken: "tok1", status: "active" }];
  await env.pool.save();

  // License synced 5 minutes ago
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await env.storage.write(env.licService.licenseFile, {
    active: true,
    key: "RECENT-SYNC-KEY",
    lastHeartbeat: fiveMinsAgo,
    serverUrl: "http://127.0.0.1:9999" // Unreachable port
  });

  const res = await env.heartbeat.checkHeartbeat(15 * 60 * 1000);
  assert.equal(res.ok, false);
  assert.equal(res.offline, true);
  // Accounts should NOT be wiped yet
  assert.equal(env.pool.accounts.length, 1);

  fs.rmSync(env.tmpDir, { recursive: true, force: true });
});

test("LicenseService: dismissNotice clears revokeReason and packageChangedNotice", async () => {
  const env = setupTestEnv();
  await env.storage.write(env.licService.licenseFile, {
    active: false,
    key: "KEY-TEST",
    revokeReason: "Mất kết nối quá 15 phút",
    packageChangedNotice: "Đã đổi sang gói VIP"
  });

  let status = await env.licService.getStatus();
  assert.equal(status.revokeReason, "Mất kết nối quá 15 phút");
  assert.equal(status.packageChangedNotice, "Đã đổi sang gói VIP");

  await env.licService.dismissNotice();

  status = await env.licService.getStatus();
  assert.equal(status.revokeReason, null);
  assert.equal(status.packageChangedNotice, null);

  fs.rmSync(env.tmpDir, { recursive: true, force: true });
});
