import { Router } from 'express';

export function createAuthRouter(userService, authMiddleware) {
  const router = Router();

  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const result = await userService.login(email, password);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/me', authMiddleware.requireAuth, (req, res) => {
    const user = userService.users.find(u => u.id === req.user.userId || u.email === req.user.email);
    if (!user) {
      return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị xóa.' });
    }
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  });

  router.get('/users', authMiddleware.requireAdmin, (req, res) => {
    try {
      res.json(userService.getUsers());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/users', authMiddleware.requireAdmin, async (req, res) => {
    try {
      const { email, password, role } = req.body;
      const created = await userService.createUser(email, password, role);
      res.json(created);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/users/:id', authMiddleware.requireAdmin, async (req, res) => {
    try {
      const deleted = await userService.deleteUser(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ success: true, id: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
