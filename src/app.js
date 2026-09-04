import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createAuthMiddleware } from './middlewares/AuthMiddleware.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createAccountRouter } from './routes/accountRoutes.js';
import { createProxyRouter } from './routes/proxyRoutes.js';
import { createSetupRouter } from './routes/setupRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

export function createApp(options = {}) {
  const { config, pool, userService, proxyService } = options;
  const authMiddleware = options.authMiddleware || (userService ? createAuthMiddleware(userService) : null);
  const app = express();

  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  const activityLogs = [];
  const MAX_LOGS = 100;

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const isStatic = req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.ico');
      if (!isStatic) {
        activityLogs.unshift({
          id: crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()),
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode,
          duration: Date.now() - start,
          model: req.body?.model || null
        });
        if (activityLogs.length > MAX_LOGS) activityLogs.pop();
      }
    });
    next();
  });

  app.use(express.static(publicDir));

  if (userService && authMiddleware) {
    const authRouter = createAuthRouter(userService, authMiddleware);
    app.use('/api/auth', authRouter);
    app.use('/api', authRouter);
  }

  if (pool) {
    const accountRouter = createAccountRouter(pool, authMiddleware);
    app.use('/api/accounts', accountRouter);
    app.use('/', accountRouter);
  }

  if (proxyService) {
    const proxyRouter = createProxyRouter(proxyService, authMiddleware);
    app.use('/', proxyRouter);
  }

  const setupRouter = createSetupRouter(config);
  app.use('/', setupRouter);

  const adminGuard = authMiddleware?.requireAdmin || ((req, res, next) => next());
  app.get('/api/logs', adminGuard, (req, res) => res.json(activityLogs));
  app.delete('/api/logs', adminGuard, (req, res) => {
    activityLogs.length = 0;
    res.json({ success: true });
  });

  app.get('/api/status', (req, res) => {
    const accounts = pool?.getAccounts ? pool.getAccounts() : [];
    const active = accounts.filter(a => (typeof a.isAvailable === 'function' ? a.isAvailable() : a.status === 'active'));
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      accountsTotal: accounts.length,
      accountsActive: active.length
    });
  });

  return app;
}
