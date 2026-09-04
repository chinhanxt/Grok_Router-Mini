import os from "node:os";

export class LicenseHeartbeat {
  constructor(licenseService, accountPool, storage, config) {
    this.licenseService = licenseService;
    this.accountPool = accountPool;
    this.storage = storage;
    this.config = config;
    this.timer = null;
    this.isChecking = false;
  }

  async purgeAllAccounts(reason = "") {
    this.accountPool.accounts = [];
    await this.accountPool.save();
    const licFile = this.licenseService.licenseFile;
    const raw = (await this.storage.read(licFile, null)) || {};
    raw.active = false;
    raw.nodeCount = 0;
    raw.revokeReason = reason;
    raw.revokedAt = new Date().toISOString();
    await this.storage.write(licFile, raw);
    console.warn(`[DRM] 🔒 Đã xóa sạch toàn bộ node và token trong hệ thống. Lý do: ${reason}`);
  }

  async checkHeartbeat(maxOfflineMs = 15 * 60 * 1000) {
    if (this.isChecking) return { active: false };
    this.isChecking = true;

    try {
      const licFile = this.licenseService.licenseFile;
      const raw = await this.storage.read(licFile, null);
      if (!raw || !raw.active || !raw.key) {
        return { active: false };
      }

      const targetUrl = (raw.serverUrl || this.licenseService.defaultServerUrl).replace(/\/$/, "");

      try {
        const res = await fetch(`${targetUrl}/api/license?action=check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            licenseKey: raw.key,
            machineId: this.licenseService.machineId,
            deviceName: os.hostname()
          })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok || !data.valid) {
          const reason = data.error || `Mã phản hồi HTTP ${res.status}`;
          await this.purgeAllAccounts(reason);
          return { ok: false, wiped: true, reason };
        }

        raw.lastHeartbeat = new Date().toISOString();

        // Kiểm tra và tự động đồng bộ nếu quản trị viên đổi gói tài nguyên
        const previousPkg = raw.packageId || 'default';
        const currentPkg = data.packageId || 'default';
        if (raw.packageId && currentPkg !== previousPkg) {
          try {
            const reSync = await this.licenseService.activate(raw.key, targetUrl);
            raw.packageId = currentPkg;
            raw.packageChanged = true;
            raw.packageChangedNotice = `Quản trị viên vừa cập nhật gói tài nguyên (${previousPkg} ➔ ${currentPkg}). Đã tự động đồng bộ ${reSync.nodeCount || 0} node mới.`;
          } catch (syncErr) {
            console.warn('[DRM] Lỗi tự động đồng bộ gói mới:', syncErr.message);
          }
        } else if (!raw.packageId && currentPkg) {
          raw.packageId = currentPkg;
        }

        await this.storage.write(licFile, raw);
        return { ok: true, lastHeartbeat: raw.lastHeartbeat, packageId: raw.packageId };
      } catch (networkErr) {
        const lastSyncTime = new Date(raw.lastHeartbeat || raw.lastSync || 0).getTime();
        const elapsed = Date.now() - lastSyncTime;

        if (elapsed > maxOfflineMs) {
          const reason = `Mất kết nối tới máy chủ bản quyền quá 15 phút (${Math.round(elapsed / 60000)} phút)`;
          await this.purgeAllAccounts(reason);
          return { ok: false, wiped: true, reason };
        }

        return { ok: false, offline: true, remainingMs: Math.max(0, maxOfflineMs - elapsed) };
      }
    } finally {
      this.isChecking = false;
    }
  }

  startBackgroundWorker(intervalMs = 15 * 60 * 1000) {
    if (this.timer) clearInterval(this.timer);

    setTimeout(() => {
      this.checkHeartbeat().catch(() => {});
    }, 5000).unref();

    this.timer = setInterval(() => {
      this.checkHeartbeat().catch(() => {});
    }, intervalMs);

    this.timer.unref();
    return this.timer;
  }

  stopBackgroundWorker() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
