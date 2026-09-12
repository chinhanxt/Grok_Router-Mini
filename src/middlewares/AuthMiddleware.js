export function createAuthMiddleware(userService, config = {}) {
  const masterKey = config?.API_KEY || 'sk-keychinhan-xtchinhan-YOUR_KEY';

  function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: 'Yêu cầu đăng nhập.' });

    // Allow permanent Master/Local API key (for Claude Code CLI & local gateway clients)
    if (token === masterKey || token === 'sk-keychinhan-xtchinhan-YOUR_KEY' || (config?.API_KEY && token === config.API_KEY)) {
      req.user = { userId: 'local-master', email: 'local@admin', role: 'admin' };
      return next();
    }

    const decoded = userService.verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Phiên đăng nhập hết hạn.' });
    req.user = decoded;
    next();
  }

  function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Chỉ Admin mới có quyền truy cập.' });
      }
      next();
    });
  }

  return { requireAuth, requireAdmin };
}
