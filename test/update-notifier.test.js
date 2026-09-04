import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isNewerVersion, formatUpdateBanner, checkUpdate } from '../src/utils/updateNotifier.js';

test('isNewerVersion compares semver versions correctly', () => {
  assert.equal(isNewerVersion('1.1.0', '1.0.0'), true);
  assert.equal(isNewerVersion('1.0.1', '1.0.0'), true);
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), true);
  assert.equal(isNewerVersion('v1.2.0', '1.1.0'), true);

  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('0.9.9', '1.0.0'), false);
  assert.equal(isNewerVersion('1.0.0', '1.1.0'), false);
  assert.equal(isNewerVersion('', '1.0.0'), false);
  assert.equal(isNewerVersion(null, '1.0.0'), false);
});

test('formatUpdateBanner formats terminal output with version and command', () => {
  const banner = formatUpdateBanner({
    packageName: 'test-router',
    currentVersion: '1.0.0',
    latestVersion: '1.2.0'
  });

  assert.ok(banner.includes('1.0.0'));
  assert.ok(banner.includes('1.2.0'));
  assert.ok(banner.includes('npm install -g test-router'));
});

test('checkUpdate handles cache properly without throwing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-test-cache-'));
  const cacheFile = path.join(tmpDir, '.update-cache.json');

  // Pre-populate cache with newer version
  fs.writeFileSync(cacheFile, JSON.stringify({
    lastCheck: Date.now(),
    latestVersion: '2.0.0'
  }));

  const res = await checkUpdate({
    packageName: 'dummy-package-that-does-not-exist',
    currentVersion: '1.0.0',
    cacheDir: tmpDir
  });

  assert.equal(res.hasUpdate, true);
  assert.equal(res.latestVersion, '2.0.0');
  assert.equal(res.fromCache, true);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
