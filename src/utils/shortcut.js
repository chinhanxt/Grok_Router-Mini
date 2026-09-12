import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Ensures `aiclaude` quick-command shortcut exists on user system.
 * Cross-platform: Linux, macOS (~/.local/bin + ~/.bashrc / ~/.zshrc), Windows (cmd/ps1).
 */
export function setupShortcut(opts = {}) {
  const home = opts.homeDir || os.homedir();
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const isWin = platform === 'win32';
  const result = { installed: false, command: 'aiclaude', paths: [] };

  try {
    if (isWin) {
      const candidates = [
        env.APPDATA ? path.join(env.APPDATA, 'npm') : null,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps') : null,
        path.join(home, '.local', 'bin')
      ].filter(Boolean);

      for (const dir of candidates) {
        try {
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const cmdFile = path.join(dir, 'aiclaude.cmd');
          const psFile = path.join(dir, 'aiclaude.ps1');

          const cmdScript = `@echo off\r\nwhere ai-claude-keyapi >nul 2>&1\r\nif %ERRORLEVEL% equ 0 (\r\n  ai-claude-keyapi %*\r\n) else (\r\n  npx ai-claude-keyapi %*\r\n)\r\n`;
          const psScript = `if (Get-Command ai-claude-keyapi -ErrorAction SilentlyContinue) { ai-claude-keyapi @args } else { npx ai-claude-keyapi @args }\r\n`;

          fs.writeFileSync(cmdFile, cmdScript, 'utf8');
          fs.writeFileSync(psFile, psScript, 'utf8');
          result.installed = true;
          result.paths.push(cmdFile, psFile);
          break;
        } catch {}
      }
    } else {
      // Linux / macOS
      const localBin = path.join(home, '.local', 'bin');
      try {
        if (!fs.existsSync(localBin)) fs.mkdirSync(localBin, { recursive: true });
        const scriptPath = path.join(localBin, 'aiclaude');
        const scriptContent = `#!/usr/bin/env sh\nif command -v ai-claude-keyapi >/dev/null 2>&1; then\n  exec ai-claude-keyapi "$@"\nelse\n  exec npx ai-claude-keyapi "$@"\nfi\n`;
        fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
        result.installed = true;
        result.paths.push(scriptPath);
      } catch {}

      // Shell RC files alias (bash & zsh)
      const rcFiles = ['.bashrc', '.zshrc', '.profile'].map(f => path.join(home, f));
      const aliasBlock = `\n# AI Claude KeyAPI shortcut\nalias aiclaude="npx ai-claude-keyapi"\n`;

      for (const rc of rcFiles) {
        try {
          if (fs.existsSync(rc)) {
            const content = fs.readFileSync(rc, 'utf8');
            if (!content.includes('alias aiclaude=')) {
              fs.appendFileSync(rc, aliasBlock, 'utf8');
              result.paths.push(rc);
            }
          }
        } catch {}
      }
    }
  } catch (err) {
    // Non-fatal
  }

  return result;
}

/**
 * Synchronizes ~/.claude/settings.json and environment variables to point directly
 * to the currently active gateway port and IP (127.0.0.1).
 * Prevents port-drift (3005 vs 3006) and IPv6 loopback connection refused errors.
 */
export function syncClaudeConfig(opts = {}) {
  const home = opts.homeDir || os.homedir();
  const platform = opts.platform || process.platform;
  const port = opts.port || 3005;
  const baseUrl = opts.baseUrl || `http://127.0.0.1:${port}`;
  const apiKey = opts.apiKey || 'sk-keychinhan-xtchinhan-YOUR_KEY';
  const isWin = platform === 'win32';
  const result = { synced: false, baseUrl, settingsPath: null };

  try {
    const claudeDir = path.join(home, '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    const settingsPath = path.join(claudeDir, 'settings.json');
    result.settingsPath = settingsPath;
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = fs.readFileSync(settingsPath, 'utf8');
        settings = JSON.parse(raw) || {};
      } catch {
        settings = {};
      }
    }

    if (!settings.env || typeof settings.env !== 'object') {
      settings.env = {};
    }

    settings.env.ANTHROPIC_BASE_URL = baseUrl;
    if (!settings.env.ANTHROPIC_AUTH_TOKEN || settings.env.ANTHROPIC_AUTH_TOKEN.includes('YOUR_KEY')) {
      settings.env.ANTHROPIC_AUTH_TOKEN = apiKey;
    }
    settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'claude-fable-5-1';
    settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-5';
    settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'claude-sonnet-5';
    settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5';
    settings.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    settings.env.NO_PROXY = 'localhost,127.0.0.1';

    if (!settings.permissions) {
      settings.permissions = { allow: ['View', 'Read', 'Glob', 'Grep', 'LS'], deny: [] };
    }
    settings.alwaysThinkingEnabled = false;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    result.synced = true;

    // Synchronize environment variables
    if (isWin) {
      try {
        execSync(`setx ANTHROPIC_BASE_URL "${baseUrl}"`, { stdio: 'ignore', timeout: 3000 });
        execSync(`setx NO_PROXY "localhost,127.0.0.1"`, { stdio: 'ignore', timeout: 3000 });
      } catch {}
    } else {
      const rcFiles = ['.bashrc', '.zshrc', '.profile'].map(f => path.join(home, f));
      for (const rc of rcFiles) {
        try {
          if (fs.existsSync(rc)) {
            let content = fs.readFileSync(rc, 'utf8');
            if (content.includes('ANTHROPIC_BASE_URL=')) {
              content = content.replace(/export ANTHROPIC_BASE_URL="[^"]*"/g, `export ANTHROPIC_BASE_URL="${baseUrl}"`);
              content = content.replace(/export ANTHROPIC_BASE_URL='[^']*'/g, `export ANTHROPIC_BASE_URL="${baseUrl}"`);
              content = content.replace(/export ANTHROPIC_BASE_URL=[^\s\n]*/g, `export ANTHROPIC_BASE_URL="${baseUrl}"`);
              fs.writeFileSync(rc, content, 'utf8');
            }
          }
        } catch {}
      }
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}
