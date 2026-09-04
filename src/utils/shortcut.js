import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
