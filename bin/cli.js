#!/usr/bin/env node

import { startServer } from '../src/server.js';

function parseArgs(args) {
  const options = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3005,
    host: process.env.HOST || '0.0.0.0',
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-help') {
      options.help = true;
    } else if (arg === '-h') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.host = args[++i];
      } else {
        options.help = true;
      }
    } else if (arg === '--host' || arg === '-H') {
      if (args[i + 1]) options.host = args[++i];
    } else if (arg.startsWith('--host=')) {
      options.host = arg.split('=')[1];
    } else if (arg === '--port' || arg === '-p') {
      if (args[i + 1]) options.port = parseInt(args[++i], 10);
    } else if (arg.startsWith('--port=') || arg.startsWith('-p=')) {
      options.port = parseInt(arg.split('=')[1], 10);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Grok Router Mini - Ultra-lightweight Local AI Gateway for Grok & Claude

Usage:
  grok-router-mini [options]
  npx grok-router-mini [options]

Options:
  -p, --port <number>    Port to listen on (default: 3005 or $PORT)
  --host <host>          Host to bind to (default: 0.0.0.0 or $HOST)
  -h, --help             Display this help message

Examples:
  grok-router-mini --port 3005
  grok-router-mini -p 8080 --host 127.0.0.1
`);
}

function printBanner(port, host) {
  const localUrl = `http://localhost:${port}`;
  const cReset = '\x1b[0m';
  const cBold = '\x1b[1m';
  const cCyan = '\x1b[36m';
  const cGreen = '\x1b[32m';
  const cYellow = '\x1b[33m';
  const cDim = '\x1b[2m';

  console.log(`
${cCyan}┌─────────────────────────────────────────────────────────────┐
│  ${cBold}⚡ Grok Router Mini v1.0.0 ⚡${cReset}${cCyan}                               │
│  ${cDim}Ultra-lightweight local AI gateway for Grok & Claude Code${cReset}${cCyan}  │
└─────────────────────────────────────────────────────────────┘${cReset}

  ${cBold}📡 Addresses:${cReset}
     • Local Web UI:           ${cGreen}${localUrl}${cReset}
     • Claude Code Base URL:   ${cGreen}${localUrl}${cReset}
     • Host binding:           ${cDim}${host}:${port}${cReset}

  ${cBold}🚀 1-Click Claude Code Setup:${cReset}
     ${cYellow}macOS / Linux (Bash):${cReset}
       curl -fsSL ${localUrl}/claude.sh | bash

     ${cYellow}Windows (PowerShell):${cReset}
       irm ${localUrl}/claude.ps1 | iex

     ${cYellow}Windows (CMD):${cReset}
       curl -fsSL ${localUrl}/claude.cmd -o setup.cmd && setup.cmd

  ${cBold}🔑 Initial Credentials:${cReset}
     • Admin:  ${cCyan}admin@local.com${cReset} / ${cCyan}admin123${cReset}

  ${cDim}Press Ctrl+C to stop the server${cReset}
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  try {
    const server = await startServer({ port: options.port, host: options.host });
    const addr = server.address();
    const boundPort = addr?.port || options.port;
    const boundHost = addr?.address || options.host;

    printBanner(boundPort, boundHost);

    const cleanup = () => {
      console.log('\nGracefully shutting down Grok Router Mini...');
      server.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 1000).unref();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (err) {
    console.error('Failed to start Grok Router Mini:', err);
    process.exit(1);
  }
}

main();
