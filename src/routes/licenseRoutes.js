import express from 'express';

export function createLicenseRouter(licenseService, authMiddleware = null) {
  const router = express.Router();

  // GET /api/license - Thông tin bản quyền hiện tại
  router.get('/', async (req, res) => {
    try {
      const status = await licenseService.getStatus();
      res.json({ ok: true, license: status });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/license/activate - Kích hoạt mã bản quyền và nạp node
  router.post('/activate', async (req, res) => {
    const { key, serverUrl } = req.body || {};
    if (!key) {
      return res.status(400).json({ ok: false, error: 'Vui lòng cung cấp mã License Key' });
    }

    try {
      const result = await licenseService.activate(key, serverUrl);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/license - Hủy kích hoạt mã
  router.delete('/', async (req, res) => {
    try {
      await licenseService.deactivate();
      res.json({ ok: true, message: 'Đã hủy kích hoạt mã License thành công' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
