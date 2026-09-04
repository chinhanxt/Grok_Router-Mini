#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fallback loader: use dist/ if built for production, otherwise src/
const distServer = path.join(__dirname, '../dist/server.js');
const serverPath = fs.existsSync(distServer) ? distServer : path.join(__dirname, '../src/server.js');
const { startServer } = await import(serverPath);

const distNotifier = path.join(__dirname, '../dist/utils/updateNotifier.js');
const notifierPath = fs.existsSync(distNotifier) ? distNotifier : path.join(__dirname, '../src/utils/updateNotifier.js');
const { checkUpdate, formatUpdateBanner } = await import(notifierPath);

const distShortcut = path.join(__dirname, '../dist/utils/shortcut.js');
const shortcutPath = fs.existsSync(distShortcut) ? distShortcut : path.join(__dirname, '../src/utils/shortcut.js');
const { setupShortcut } = await import(shortcutPath);

let pkg = { name: 'ai-claude-keyapi', version: '1.0.2' };
try {
  const rawPkg = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8');
  pkg = JSON.parse(rawPkg);
} catch {}

function parseArgs(args) {
  const options = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3005,
    host: process.env.HOST || '0.0.0.0',
    help: false,
    portExplicit: Boolean(process.env.PORT)
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-help') options.help = true;
    else if (arg === '-h') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) options.host = args[++i];
      else options.help = true;
    } else if (arg === '--host' || arg === '-H') {
      if (args[i + 1]) options.host = args[++i];
    } else if (arg.startsWith('--host=')) options.host = arg.split('=')[1];
    else if (arg === '--port' || arg === '-p') {
      if (args[i + 1]) { options.port = parseInt(args[++i], 10); options.portExplicit = true; }
    } else if (arg.startsWith('--port=') || arg.startsWith('-p=')) {
      options.port = parseInt(arg.split('=')[1], 10); options.portExplicit = true;
    } else if (arg === '--license' || arg === '-l') {
      if (args[i + 1]) options.license = args[++i];
    } else if (arg.startsWith('--license=')) options.license = arg.split('=')[1];
  }
  return options;
}

function showHelp() {
  console.log(`
AI Claude KeyAPI - Ultra-lightweight Local AI Gateway for Claude & LLMs

Usage:
  aiclaude [options]
  npx ai-claude-keyapi [options]

Options:
  -p, --port <number>    Port to listen on (default: 3005 or $PORT, auto-increments if busy)
  --host <host>          Host to bind to (default: 0.0.0.0 or $HOST)
  -l, --license <key>    License Key to activate and load AI nodes automatically
  -h, --help             Display this help message
`);
}

function printBanner(port, host) {
  const localUrl = `http://localhost:${port}`;
  const cReset = '\x1b[0m', cBold = '\x1b[1m', cCyan = '\x1b[36m';
  const cGreen = '\x1b[32m', cYellow = '\x1b[33m', cDim = '\x1b[2m';

  console.log(`
${cCyan}┌─────────────────────────────────────────────────────────────┐
│  ${cBold}⚡ AI Claude KeyAPI v${pkg.version || '1.0.2'} ⚡${cReset}${cCyan}                              │
│  ${cDim}Ultra-lightweight local AI gateway for Claude Code${cReset}${cCyan}           │
└─────────────────────────────────────────────────────────────┘${cReset}

  ${cBold}📡 Addresses:${cReset}
     • Local Web UI:           ${cGreen}${localUrl}${cReset}
     • Claude Code Base URL:   ${cGreen}${localUrl}${cReset}
     • Host binding:           ${cDim}${host}:${port}${cReset}

  ${cBold}⚡ Lệnh gọi nhanh từ lần sau:${cReset}
     ${cGreen}aiclaude${cReset}  ${cDim}(hoặc: npx ai-claude-keyapi)${cReset}

  ${cBold}🚀 1-Click Claude Code Setup:${cReset}
     ${cYellow}macOS / Linux (Bash):${cReset}
       curl -fsSL ${localUrl}/claude.sh | bash

     ${cYellow}Windows (PowerShell):${cReset}
       irm ${localUrl}/claude.ps1 | iex

     ${cYellow}Windows (CMD):${cReset}
       curl -fsSL ${localUrl}/claude.cmd -o setup.cmd && setup.cmd

  ${cDim}Press Ctrl+C to stop the server${cReset}
`);
}

async function startWithPortFallback(options) {
  let currentPort = options.port;
  const maxAttempts = options.portExplicit ? 1 : 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const server = await startServer({ port: currentPort, host: options.host });
      return { server, port: currentPort };
    } catch (err) {
      if (err.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
        console.log(`\x1b[33m⚠️ Port ${currentPort} is in use. Trying port ${currentPort + 1}...\x1b[0m`);
        currentPort++;
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { showHelp(); process.exit(0); }

  try {
    const { server, port: boundPort } = await startWithPortFallback(options);
    const addr = server.address();
    const resolvedPort = addr?.port || boundPort;
    const resolvedHost = addr?.address || options.host;

    // Ensure `aiclaude` quick shortcut is set up for subsequent runs
    setupShortcut();

    printBanner(resolvedPort, resolvedHost);

    if (options.license && server.licenseService) {
      console.log(`\x1b[36m🔑 Đang kích hoạt License Key: ${options.license}...\x1b[0m`);
      const lic = await server.licenseService.activate(options.license);
      if (lic.ok) {
        console.log(`\x1b[32m✔ Đã kích hoạt License thành công (${lic.nodeCount} node sẵn sàng)\x1b[0m`);
      } else {
        console.warn(`\x1b[31m✖ Kích hoạt thất bại: ${lic.error}\x1b[0m`);
      }
    }

    checkUpdate({ packageName: pkg.name, currentVersion: pkg.version }).then(res => {
      if (res?.hasUpdate && res?.latestVersion) {
        console.log(formatUpdateBanner({
          packageName: pkg.name,
          currentVersion: pkg.version,
          latestVersion: res.latestVersion
        }));
      }
    }).catch(() => {});

    const cleanup = () => {
      console.log('\nGracefully shutting down AI Claude KeyAPI...');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`\x1b[31m❌ Error: Port ${options.port} is already in use by another program.\x1b[0m`);
      console.error(`👉 You can run on a different port using:`);
      console.error(`   aiclaude --port ${options.port + 1}`);
      console.error(`   node bin/cli.js --port ${options.port + 1}\n`);
    } else {
      console.error('Failed to start AI Claude KeyAPI:', err);
    }
    process.exit(1);
  }
}

main();
