#!/usr/bin/env node

import { startServer } from '../src/server.js';

function parseArgs(args) {
  const options = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3005,
    host: process.env.HOST || '0.0.0.0',
    help: false,
    portExplicit: Boolean(process.env.PORT)
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
      if (args[i + 1]) {
        options.port = parseInt(args[++i], 10);
        options.portExplicit = true;
      }
    } else if (arg.startsWith('--port=') || arg.startsWith('-p=')) {
      options.port = parseInt(arg.split('=')[1], 10);
      options.portExplicit = true;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
AI Router Mini - Ultra-lightweight Local AI Gateway for Claude & LLMs

Usage:
  ai-router-mini [options]
  npm start -- [options]

Options:
  -p, --port <number>    Port to listen on (default: 3005 or $PORT, auto-increments if busy)
  --host <host>          Host to bind to (default: 0.0.0.0 or $HOST)
  -h, --help             Display this help message

Examples:
  npm start -- --port 3006
  node bin/cli.js -p 8080 --host 127.0.0.1
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
│  ${cBold}⚡ AI Router Mini v1.0.0 ⚡${cReset}${cCyan}                                 │
│  ${cDim}Ultra-lightweight local AI gateway for Claude Code${cReset}${cCyan}           │
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

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  try {
    const { server, port: boundPort } = await startWithPortFallback(options);
    const addr = server.address();
    const resolvedPort = addr?.port || boundPort;
    const resolvedHost = addr?.address || options.host;

    printBanner(resolvedPort, resolvedHost);

    const cleanup = () => {
      console.log('\nGracefully shutting down AI Router Mini...');
      server.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 1000).unref();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`\x1b[31m❌ Error: Port ${options.port} is already in use by another program.\x1b[0m`);
      console.error(`👉 You can run on a different port using:`);
      console.error(`   npm start -- --port ${options.port + 1}`);
      console.error(`   node bin/cli.js --port ${options.port + 1}\n`);
    } else {
      console.error('Failed to start AI Router Mini:', err);
    }
    process.exit(1);
  }
}

main();
