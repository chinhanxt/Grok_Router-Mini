import { Router } from 'express';

export function createAccountRouter(accountPool, authMiddleware) {
  const router = Router();

  const guard = authMiddleware?.requireAdmin
    ? authMiddleware.requireAdmin
    : (typeof authMiddleware === 'function'
        ? authMiddleware
        : (req, res, next) => res.status(403).json({ error: 'Chỉ Admin mới có quyền truy cập.' }));

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
