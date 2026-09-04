import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

test('bin/cli.js boots and outputs banner with local URL', (t, done) => {
  const tmpDir = '/tmp/grok-e2e-' + Date.now();
  const proc = spawn('node', ['bin/cli.js', '--port', '3999'], {
    cwd: '/home/chinhan/grok-router-mini',
    env: { ...process.env, DATA_DIR: tmpDir }
  });

  let output = '';
  let started = false;

  proc.stdout.on('data', (d) => {
    output += d.toString();
    if (output.includes('3999')) {
      started = true;
      proc.kill('SIGTERM');
      assert.ok(output.includes('AI Router Mini'));
    }
  });

  proc.on('close', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    assert.ok(started, 'Expected CLI to boot and print banner with port 3999');
    done();
  });
});

test('bin/cli.js handles --help flag correctly', (t, done) => {
  const proc = spawn('node', ['bin/cli.js', '--help'], {
    cwd: '/home/chinhan/grok-router-mini'
  });

  let output = '';
  proc.stdout.on('data', (d) => {
    output += d.toString();
  });

  proc.on('close', (code) => {
    assert.equal(code, 0);
    assert.ok(output.includes('Usage:'));
    assert.ok(output.includes('--port'));
    assert.ok(output.includes('--host'));
    done();
  });
});

test('bin/cli.js responds to HTTP requests when booted', async () => {
  const tmpDir = '/tmp/grok-e2e-http-' + Date.now();
  const port = 3998;
  const proc = spawn('node', ['bin/cli.js', '-p', String(port)], {
    cwd: '/home/chinhan/grok-router-mini',
    env: { ...process.env, DATA_DIR: tmpDir }
  });

  try {
    await new Promise((resolve, reject) => {
      proc.stdout.on('data', (d) => {
        if (d.toString().includes(String(port))) resolve();
      });
      proc.on('close', (code) => {
        reject(new Error(`Process exited early with code ${code}`));
      });
      proc.on('error', reject);
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
  } finally {
    if (proc.exitCode === null && !proc.killed) {
      proc.kill('SIGINT');
      await new Promise(resolve => proc.on('close', resolve));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
