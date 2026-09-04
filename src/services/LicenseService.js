import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { Account } from '../core/Account.js';

export class LicenseService {
  constructor(accountPool, storage, config) {
    this.accountPool = accountPool;
    this.storage = storage;
    this.config = config;
    this.dataDir = config.DATA_DIR || path.join(os.homedir(), '.grok-router');
    this.licenseFile = path.join(this.dataDir, 'license.json');
    this.machineId = this._initMachineId();
    this.defaultServerUrl = process.env.LICENSE_SERVER_URL || 'https://aiclaude.freepro.online';
  }

  _initMachineId() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const idPath = path.join(this.dataDir, 'machine-id');
      if (fs.existsSync(idPath)) {
        const id = fs.readFileSync(idPath, 'utf8').trim();
        if (id) return id;
      }
      const nics = os.networkInterfaces();
      const macs = Object.values(nics).flat().map(i => i?.mac).filter(m => m && m !== '00:00:00:00:00:00');
      const raw = `${os.hostname()}-${os.platform()}-${os.arch()}-${macs.join('-')}-${crypto.randomBytes(8).toString('hex')}`;
      const machineId = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
      fs.writeFileSync(idPath, machineId, 'utf8');
      return machineId;
    } catch {
      return crypto.randomBytes(16).toString('hex');
    }
  }

  async getStatus() {
    const raw = await this.storage.read(this.licenseFile, null);
    return {
      active: Boolean(raw && raw.active),
      key: raw?.key || null,
      label: raw?.label || null,
      expireAt: raw?.expireAt || null,
      deviceSlot: raw?.deviceSlot || null,
      nodeCount: raw?.nodeCount || 0,
      lastSync: raw?.lastSync || null,
      machineId: this.machineId,
      serverUrl: raw?.serverUrl || this.defaultServerUrl
    };
  }

  async activate(licenseKey, serverUrl = null) {
    if (!licenseKey || typeof licenseKey !== 'string') {
      return { ok: false, error: 'Mã License không được để trống' };
    }

    const targetUrl = (serverUrl || this.defaultServerUrl).replace(/\/$/, '');
    const cleanKey = licenseKey.trim().toUpperCase();

    try {
      const res = await fetch(`${targetUrl}/api/license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: cleanKey,
          machineId: this.machineId,
          deviceName: os.hostname()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || 'Kích hoạt thất bại. Vui lòng kiểm tra lại mã.' };
      }

      // Nạp các node mới được cấp vào AccountPool (thay thế toàn bộ để tránh cộng dồn)
      const newAccounts = (data.nodes || []).map(n => {
        let expiresAt = n.expiresAt || 0;
        const token = n.ssoToken || n.apiKey || n.token || '';
        if (!expiresAt && token && typeof token === 'string') {
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
              if (payload.exp) expiresAt = payload.exp * 1000;
            }
          } catch {}
        }
        return new Account({
          id: `lic-${n.id || crypto.randomUUID().slice(0, 8)}`,
          name: n.name || n.email || 'Cloud Node',
          email: n.email || '',
          ssoToken: token,
          refreshToken: n.refreshToken || '',
          source: 'license',
          status: n.status || 'active',
          expiresAt
        });
      });

      this.accountPool.accounts = newAccounts;
      await this.accountPool.save();

      // Lưu trạng thái license
      const record = {
        active: true,
        key: cleanKey,
        label: data.label,
        expireAt: data.expireAt,
        deviceSlot: data.deviceSlot,
        nodeCount: newAccounts.length,
        serverUrl: targetUrl,
        lastSync: new Date().toISOString()
      };
      await this.storage.write(this.licenseFile, record);

      return {
        ok: true,
        key: cleanKey,
        label: data.label,
        expireAt: data.expireAt,
        deviceSlot: data.deviceSlot,
        nodeCount: newAccounts.length
      };
    } catch (err) {
      return { ok: false, error: `Không thể kết nối đến máy chủ xác thực: ${err.message}` };
    }
  }

  async deactivate() {
    this.accountPool.accounts = [];
    await this.accountPool.save();
    await this.storage.write(this.licenseFile, { active: false });
    return { ok: true };
  }

  async syncOnStartup() {
    const raw = await this.storage.read(this.licenseFile, null);
    if (!raw || !raw.active || !raw.key) return;

    try {
      const result = await this.activate(raw.key, raw.serverUrl);
      if (result.ok) {
        console.log(`[License] Đã đồng bộ thành công mã "${raw.key}" (${result.nodeCount} node sẵn sàng)`);
      } else {
        console.warn(`[License] Đồng bộ thất bại: ${result.error}`);
      }
    } catch (err) {
      console.warn(`[License] Lỗi kiểm tra license khởi động: ${err.message}`);
    }
  }
}
