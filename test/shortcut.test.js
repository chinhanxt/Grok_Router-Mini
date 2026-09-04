import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupShortcut } from '../src/utils/shortcut.js';

test('setupShortcut creates executable in ~/.local/bin and alias in rc on Unix', () => {
  const tmpHome = path.join(os.tmpdir(), 'shortcut-unix-' + Date.now());
  fs.mkdirSync(tmpHome, { recursive: true });

  const bashrc = path.join(tmpHome, '.bashrc');
  fs.writeFileSync(bashrc, '# sample bashrc\n', 'utf8');

  const res = setupShortcut({
    homeDir: tmpHome,
    platform: 'linux',
    env: {}
  });

  assert.equal(res.installed, true);
  assert.equal(res.command, 'aiclaude');

  const binPath = path.join(tmpHome, '.local', 'bin', 'aiclaude');
  assert.ok(fs.existsSync(binPath), 'Should create ~/.local/bin/aiclaude');
  const content = fs.readFileSync(binPath, 'utf8');
  assert.ok(content.includes('ai-claude-keyapi'));

  const bashrcContent = fs.readFileSync(bashrc, 'utf8');
  assert.ok(bashrcContent.includes('alias aiclaude='));

  // Run again to verify idempotency (no duplicate alias appended)
  setupShortcut({
    homeDir: tmpHome,
    platform: 'linux',
    env: {}
  });
  const bashrcSecond = fs.readFileSync(bashrc, 'utf8');
  const occurrences = bashrcSecond.split('alias aiclaude=').length - 1;
  assert.equal(occurrences, 1, 'Alias should not be duplicated');

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('setupShortcut creates cmd and ps1 files on Windows', () => {
  const tmpHome = path.join(os.tmpdir(), 'shortcut-win-' + Date.now());
  const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
  fs.mkdirSync(tmpAppData, { recursive: true });

  const res = setupShortcut({
    homeDir: tmpHome,
    platform: 'win32',
    env: { APPDATA: tmpAppData }
  });

  assert.equal(res.installed, true);
  const cmdPath = path.join(tmpAppData, 'npm', 'aiclaude.cmd');
  const psPath = path.join(tmpAppData, 'npm', 'aiclaude.ps1');

  assert.ok(fs.existsSync(cmdPath), 'Should create aiclaude.cmd');
  assert.ok(fs.existsSync(psPath), 'Should create aiclaude.ps1');

  const cmdContent = fs.readFileSync(cmdPath, 'utf8');
  assert.ok(cmdContent.includes('ai-claude-keyapi'));

  fs.rmSync(tmpHome, { recursive: true, force: true });
});
