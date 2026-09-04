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
    res.json({ user: req.user });
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

  return router;
}
