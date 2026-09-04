export function createAuthMiddleware(userService) {
  function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: 'Yêu cầu đăng nhập.' });
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
