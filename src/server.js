import path from 'node:path';
import { createApp } from './app.js';
import { AppConfig, appConfig as defaultAppConfig } from './config.js';
import { JsonStorage } from './storage/JsonStorage.js';
import { AccountPool } from './services/AccountPool.js';
import { UserService } from './services/UserService.js';
import { ProxyService } from './services/ProxyService.js';
import { createAuthMiddleware } from './middlewares/AuthMiddleware.js';

import { NodeHealthService } from './services/NodeHealthService.js';
import { LicenseService } from './services/LicenseService.js';

export async function startServer(portOrOptions = {}, maybeHost = null) {
  let port;
  let host;
  let config;
  let customStorage;

  if (typeof portOrOptions === 'object' && portOrOptions !== null) {
    port = portOrOptions.port;
    host = portOrOptions.host;
    config = portOrOptions.config;
    customStorage = portOrOptions.storage;
  } else {
    port = portOrOptions;
    host = maybeHost;
  }

  config = config || defaultAppConfig || new AppConfig();
  if (port !== undefined && port !== null) {
    config.PORT = parseInt(port, 10);
  }
  if (host !== undefined && host !== null) {
    config.HOST = host;
  }

  const storage = customStorage || new JsonStorage();
  const pool = new AccountPool(storage, config);
  await pool.init();

  const userService = new UserService(storage, config);
  await userService.init();

  const nodeHealthService = new NodeHealthService(pool, config);
  const proxyService = new ProxyService(pool, config, nodeHealthService);
  const authMiddleware = createAuthMiddleware(userService);
  const licenseService = new LicenseService(pool, storage, config);
  await licenseService.syncOnStartup();

  const app = createApp({ config, pool, userService, proxyService, authMiddleware, storage, nodeHealthService, licenseService });

  return new Promise((resolve, reject) => {
    const server = app.listen(config.PORT, config.HOST, () => {
      server.app = app;
      server.pool = pool;
      server.userService = userService;
      server.proxyService = proxyService;
      server.nodeHealthService = nodeHealthService;
      server.licenseService = licenseService;
      server.config = config;

      nodeHealthService.startBackgroundWorker();

      const origClose = server.close.bind(server);
      server.close = function(cb) {
        nodeHealthService.stopBackgroundWorker();
        return origClose(cb);
      };

      resolve(server);
    });
    server.on('error', reject);
  });
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  startServer().then(server => {
    const addr = server.address();
    const port = addr?.port || '3005';
    console.log(`\n🚀 AI Claude KeyAPI running at http://127.0.0.1:${port}`);
  }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
