import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { AppConfig, appConfig } from '../src/config.js';

test('AppConfig sets custom values when provided in env', () => {
  const config = new AppConfig({ PORT: '3008', DATA_DIR: '/tmp/test-grok-router', HOST: '127.0.0.1', AUTH_SECRET: 'custom-secret' });
  assert.equal(config.PORT, 3008);
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.DATA_DIR, '/tmp/test-grok-router');
  assert.equal(config.ACCOUNTS_FILE, path.join('/tmp/test-grok-router', 'accounts.json'));
  assert.equal(config.USERS_FILE, path.join('/tmp/test-grok-router', 'users.json'));
  assert.equal(config.AUTH_SECRET, 'custom-secret');
});

test('AppConfig sets default values when env is empty', () => {
  const config = new AppConfig({});
  assert.equal(config.PORT, 3005);
  assert.equal(config.HOST, '0.0.0.0');
  assert.equal(config.DATA_DIR, path.join(os.homedir(), '.grok-router'));
  assert.equal(config.ACCOUNTS_FILE, path.join(os.homedir(), '.grok-router', 'accounts.json'));
  assert.equal(config.USERS_FILE, path.join(os.homedir(), '.grok-router', 'users.json'));
  assert.equal(config.AUTH_SECRET, 'grok-mini-auth-secret-key-2026');
  assert.equal(config.GROK_PROXY_BASE, 'https://cli-chat-proxy.grok.com/v1');
  assert.equal(config.XAI_CLIENT_ID, 'b1a00492-073a-47ea-816f-4c329264a828');
  assert.equal(config.XAI_AUTH_BASE, 'https://auth.x.ai');
  assert.equal(config.DEFAULT_COOLDOWN_MS, 10 * 60 * 1000);
});

test('appConfig is a default singleton instance of AppConfig', () => {
  assert.ok(appConfig instanceof AppConfig);
});
