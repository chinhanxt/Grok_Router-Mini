import { Router } from 'express';

export function createSetupRouter(config = {}) {
  const router = Router();

  const SAFE_KEY_REGEX = /^[a-zA-Z0-9_\-\.]{8,256}$/;

  function resolveKey(req) {
    const defaultKey = config?.API_KEY || 'sk-keychinhan-xtchinhan-YOUR_KEY';
    const key = typeof req.query?.key === 'string' ? req.query.key.trim() : '';
    return (key && SAFE_KEY_REGEX.test(key)) ? key : defaultKey;
  }

  function getBaseUrl(req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3005';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    return `${proto}://${host}`;
  }

  // macOS / Linux Bash script
  router.get(['/claude.sh', '/install.sh', '/setup.sh'], (req, res) => {
    const key = resolveKey(req);
    const baseUrl = getBaseUrl(req);

    const script = `#!/usr/bin/env bash

export ANTHROPIC_BASE_URL="${baseUrl}"
export ANTHROPIC_AUTH_TOKEN="${key}"
export ANTHROPIC_DEFAULT_FABLE_MODEL="claude-fable-5-1"
export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"

CLAUDE_SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude" 2>/dev/null || true

SED_INPLACE=(-i)
if [[ "$OSTYPE" == "darwin"* ]]; then
  SED_INPLACE=(-i '')
fi

if [ ! -f "$CLAUDE_SETTINGS" ]; then
  cat <<JSON > "$CLAUDE_SETTINGS"
{
  "env": {
    "ANTHROPIC_BASE_URL": "${baseUrl}",
    "ANTHROPIC_AUTH_TOKEN": "${key}",
    "ANTHROPIC_DEFAULT_FABLE_MODEL": "claude-fable-5-1",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "permissions": { "allow": [], "deny": [] },
  "alwaysThinkingEnabled": false
}
JSON
else
  sed "\${SED_INPLACE[@]}" 's|"ANTHROPIC_BASE_URL": "[^"]*"|"ANTHROPIC_BASE_URL": "${baseUrl}"|g' "$CLAUDE_SETTINGS" 2>/dev/null || true
  sed "\${SED_INPLACE[@]}" 's|"ANTHROPIC_AUTH_TOKEN": "[^"]*"|"ANTHROPIC_AUTH_TOKEN": "${key}"|g' "$CLAUDE_SETTINGS" 2>/dev/null || true
  sed "\${SED_INPLACE[@]}" 's|"alwaysThinkingEnabled": true|"alwaysThinkingEnabled": false|g' "$CLAUDE_SETTINGS" 2>/dev/null || true
fi

RC_FILE=""
if [ -f "$HOME/.zshrc" ]; then
  RC_FILE="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  RC_FILE="$HOME/.bashrc"
fi

if [ -n "$RC_FILE" ]; then
  sed "\${SED_INPLACE[@]}" '/ANTHROPIC_/d' "$RC_FILE" 2>/dev/null || true
  sed "\${SED_INPLACE[@]}" '/CLAUDE_CODE_/d' "$RC_FILE" 2>/dev/null || true
  echo 'export ANTHROPIC_BASE_URL="${baseUrl}"' >> "$RC_FILE"
  echo 'export ANTHROPIC_AUTH_TOKEN="${key}"' >> "$RC_FILE"
  echo 'export ANTHROPIC_DEFAULT_FABLE_MODEL="claude-fable-5-1"' >> "$RC_FILE"
  echo 'export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-5"' >> "$RC_FILE"
  echo 'export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-5"' >> "$RC_FILE"
  echo 'export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5"' >> "$RC_FILE"
  echo 'export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"' >> "$RC_FILE"
fi

echo "🚀 Khởi động Claude Code qua AI Gateway (${baseUrl})..."
if command -v claude >/dev/null 2>&1; then
  exec claude "$@"
else
  echo "⚠️ Không tìm thấy lệnh 'claude'. Đã nạp xong biến môi trường."
  echo "👉 Cài đặt bằng: npm install -g @anthropic-ai/claude-code"
fi
`;
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.send(script);
  });

  // Windows PowerShell script
  router.get(['/claude.ps1', '/install.ps1', '/setup.ps1'], (req, res) => {
    const key = resolveKey(req);
    const baseUrl = getBaseUrl(req);

    const script = `$baseUrl = "${baseUrl}"
$apiKey = "${key}"

[System.Environment]::SetEnvironmentVariable('ANTHROPIC_BASE_URL', $baseUrl, 'User')
[System.Environment]::SetEnvironmentVariable('ANTHROPIC_AUTH_TOKEN', $apiKey, 'User')
[System.Environment]::SetEnvironmentVariable('ANTHROPIC_DEFAULT_FABLE_MODEL', 'claude-fable-5-1', 'User')
[System.Environment]::SetEnvironmentVariable('ANTHROPIC_DEFAULT_OPUS_MODEL', 'claude-opus-5', 'User')
[System.Environment]::SetEnvironmentVariable('ANTHROPIC_DEFAULT_SONNET_MODEL', 'claude-sonnet-5', 'User')
[System.Environment]::SetEnvironmentVariable('ANTHROPIC_DEFAULT_HAIKU_MODEL', 'claude-haiku-4-5', 'User')
[System.Environment]::SetEnvironmentVariable('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1', 'User')

$env:ANTHROPIC_BASE_URL = $baseUrl
$env:ANTHROPIC_AUTH_TOKEN = $apiKey
$env:ANTHROPIC_DEFAULT_FABLE_MODEL = 'claude-fable-5-1'
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-5'
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = 'claude-sonnet-5'
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5'
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'

$claudeDir = "$HOME\\.claude"
if (!(Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null }
$settingsFile = "$claudeDir\\settings.json"

$jsonConfig = @"
{
  "env": {
    "ANTHROPIC_BASE_URL": "$baseUrl",
    "ANTHROPIC_AUTH_TOKEN": "$apiKey",
    "ANTHROPIC_DEFAULT_FABLE_MODEL": "claude-fable-5-1",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "permissions": { "allow": [], "deny": [] },
  "alwaysThinkingEnabled": false
}
"@
Set-Content $settingsFile -Value $jsonConfig -Encoding UTF8

Write-Host "✅ Đã lưu cấu hình vĩnh viễn vào User Environment Variables!" -ForegroundColor Green
Write-Host "🚀 Đang mở Claude Code qua AI Gateway ($baseUrl)..." -ForegroundColor Cyan

if (Get-Command claude -ErrorAction SilentlyContinue) {
  claude $args
} else {
  Write-Host "⚠️ Không tìm thấy lệnh 'claude'. Đã lưu xong biến môi trường." -ForegroundColor Yellow
  Write-Host "👉 Cài đặt bằng: npm install -g @anthropic-ai/claude-code" -ForegroundColor Gray
}
`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  });

  // Windows CMD script
  router.get(['/claude.cmd', '/install.cmd', '/setup.cmd', '/install.bat'], (req, res) => {
    const key = resolveKey(req);
    const baseUrl = getBaseUrl(req);

    const script = `@echo off
rem AI Gateway - 1-Click Auto Setup for Claude Code (CMD)
set "BASE_URL=${baseUrl}"
set "API_KEY=${key}"

setx ANTHROPIC_BASE_URL "%BASE_URL%" >nul 2>&1
setx ANTHROPIC_AUTH_TOKEN "%API_KEY%" >nul 2>&1
setx ANTHROPIC_DEFAULT_FABLE_MODEL "claude-fable-5-1" >nul 2>&1
setx ANTHROPIC_DEFAULT_OPUS_MODEL "claude-opus-5" >nul 2>&1
setx ANTHROPIC_DEFAULT_SONNET_MODEL "claude-sonnet-5" >nul 2>&1
setx ANTHROPIC_DEFAULT_HAIKU_MODEL "claude-haiku-4-5" >nul 2>&1
setx CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC "1" >nul 2>&1

set "ANTHROPIC_BASE_URL=%BASE_URL%"
set "ANTHROPIC_AUTH_TOKEN=%API_KEY%"
set "ANTHROPIC_DEFAULT_FABLE_MODEL=claude-fable-5-1"
set "ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5"
set "ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5"
set "ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5"
set "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"

echo [OK] Da luu cau hinh vao Windows Environment!
echo [..] Dang khoi dong Claude Code (%BASE_URL%)...

where claude >nul 2>&1
if %ERRORLEVEL% equ 0 (
  claude %*
) else (
  echo [!] Khong tim thay lenh claude. Da nap xong bien moi truong.
  echo [*] Cai dat bang: npm install -g @anthropic-ai/claude-code
)
`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  });

  return router;
}
