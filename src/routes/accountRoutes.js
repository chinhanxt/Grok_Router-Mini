import { Router } from 'express';

export function createAccountRouter(accountPool, authMiddleware, nodeHealthService = null) {
  const router = Router();

  const guard = authMiddleware?.requireAdmin
    ? authMiddleware.requireAdmin
    : (typeof authMiddleware === 'function'
        ? authMiddleware
        : (req, res, next) => res.status(403).json({ error: 'Chỉ Admin mới có quyền truy cập.' }));

  // Check health and auto-revive all tokens
  router.post(['/check-health', '/api/accounts/check-health'], guard, async (req, res) => {
    try {
      if (!nodeHealthService) {
        return res.json({ success: true, message: 'NodeHealthService not mounted' });
      }
      const forceRefresh = req.body?.forceRefresh === true;
      const stats = await nodeHealthService.checkAllNodes({ forceRefresh });
      res.json(stats);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Refresh single account token
  router.post(['/:id/refresh-token', '/api/accounts/:id/refresh-token'], guard, async (req, res) => {
    try {
      const acc = accountPool.getAccounts().find(a => a.id === req.params.id);
      if (!acc) return res.status(404).json({ error: 'Account not found' });
      if (!nodeHealthService) return res.status(400).json({ error: 'NodeHealthService not mounted' });
      const result = await nodeHealthService.refreshAccountToken(acc);
      if (result.success) await accountPool.save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // List accounts
  router.get(['/', '/api/accounts'], guard, async (req, res) => {
    try {
      const accounts = accountPool.getAccounts().map(acc => {
        const json = typeof acc.toJSON === 'function' ? acc.toJSON() : { ...acc };
        delete json.ssoToken;
        delete json.refreshToken;
        return json;
      });
      res.json(accounts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export accounts (full credentials for backup & sharing)
  router.get(['/export', '/api/accounts/export'], guard, async (req, res) => {
    try {
      const rawAccounts = accountPool.getAccounts().map(acc => {
        return typeof acc.toJSON === 'function' ? acc.toJSON() : { ...acc };
      });
      const filename = `ai-nodes-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(rawAccounts);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Create account
  router.post(['/', '/api/accounts'], guard, async (req, res) => {
    try {
      const account = await accountPool.addAccount(req.body || {});
      res.status(201).json(account);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Batch import accounts
  router.post(['/batch-import', '/api/accounts/batch-import'], guard, async (req, res) => {
    try {
      const { accounts, overwrite } = req.body || {};
      if (!Array.isArray(accounts)) {
        return res.status(400).json({ success: false, error: 'Dữ liệu tài khoản phải là một mảng (Array).' });
      }
      const result = await accountPool.batchImportAccounts(accounts, { overwrite: overwrite !== false });
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Update account (PUT and PATCH)
  const handleUpdate = async (req, res) => {
    try {
      const updated = await accountPool.updateAccount(req.params.id, req.body || {});
      if (!updated) {
        return res.status(404).json({ error: 'Account not found' });
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
  router.put(['/:id', '/api/accounts/:id'], guard, handleUpdate);
  router.patch(['/:id', '/api/accounts/:id'], guard, handleUpdate);

  // Delete all disabled accounts
  router.delete(['/disabled', '/api/accounts/disabled'], guard, async (req, res) => {
    try {
      const result = await accountPool.deleteDisabledAccounts();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete account
  router.delete(['/:id', '/api/accounts/:id'], guard, async (req, res) => {
    try {
      const deleted = await accountPool.deleteAccount(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Account not found' });
      }
      res.json({ success: true, id: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
