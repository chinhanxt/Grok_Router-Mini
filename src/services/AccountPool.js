import { Account } from '../core/Account.js';
import { AutoStrategy } from '../core/AutoStrategy.js';

export class AccountPool {
  constructor(storage, config = {}) {
    this.storage = storage;
    this.config = config;
    this.accounts = [];
    this.strategy = new AutoStrategy();
  }

  async init() {
    const raw = await this.storage.read(this.config.ACCOUNTS_FILE, []);
    this.accounts = raw.map(Account.fromJSON);
  }

  getAccounts() {
    return this.accounts;
  }

  async save() {
    await this.storage.write(this.config.ACCOUNTS_FILE, this.accounts.map(a => (typeof a?.toJSON === 'function' ? a.toJSON() : a)));
  }

  async addAccount(data) {
    const acc = new Account(data);
    this.accounts.push(acc);
    await this.save();
    return acc;
  }

  async updateAccount(id, updates) {
    const acc = this.accounts.find(a => a.id === id);
    if (!acc) return null;
    Object.assign(acc, updates);
    await this.save();
    return acc;
  }

  async deleteAccount(id) {
    const idx = this.accounts.findIndex(a => a.id === id);
    if (idx === -1) return false;
    this.accounts.splice(idx, 1);
    await this.save();
    return true;
  }

  async markCooling(id, cooldownMs = (this.config?.DEFAULT_COOLDOWN_MS ?? 10 * 60 * 1000)) {
    const acc = this.accounts.find(a => a.id === id);
    if (acc) {
      acc.setCooling(cooldownMs);
      await this.save();
    }
  }

  async incrementUsage(id, tokens = 0) {
    const acc = this.accounts.find(a => a.id === id);
    if (acc) {
      acc.requestCount = (acc.requestCount || 0) + 1;
      acc.totalTokens = (acc.totalTokens || 0) + tokens;
      await this.save();
    }
  }

  async getNextAvailableAccount() {
    const now = Date.now();
    // Auto-recover cooling accounts whose timer expired
    for (const acc of this.accounts) {
      if (acc.status === 'cooling' && now >= acc.cooldownUntil) {
        acc.status = 'active';
      }
    }
    const available = this.accounts.filter(a => a.isAvailable());
    return this.strategy.select(available);
  }

  async batchImportAccounts(rawAccounts, { overwrite = true } = {}) {
    if (!Array.isArray(rawAccounts)) {
      throw new Error('Danh sách tài khoản phải là một mảng (Array).');
    }

    let added = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rawAccounts.length; i++) {
      const raw = rawAccounts[i];
      if (!raw || typeof raw !== 'object') {
        errors.push(`Mục thứ ${i + 1}: Dữ liệu không hợp lệ.`);
        continue;
      }

      const email = (raw.email || raw.username || '').trim().toLowerCase();
      if (!email) {
        errors.push(`Mục thứ ${i + 1}: Thiếu email.`);
        continue;
      }

      const ssoToken = raw.ssoToken || raw.sso_token || raw.sso_cookie || raw.ssoCookie || raw.cookie || raw.token || raw.accessToken || raw.access_token || '';
      const refreshToken = raw.refreshToken || raw.refresh_token || raw.ssoRwCookie || raw.sso_rw_cookie || '';
      const name = raw.name || email.split('@')[0] || `Node ${this.accounts.length + 1}`;

      const existingIndex = this.accounts.findIndex(a =>
        (a.email && a.email.toLowerCase() === email) || (raw.id && a.id === raw.id)
      );

      if (existingIndex >= 0) {
        if (overwrite) {
          const acc = this.accounts[existingIndex];
          if (ssoToken) acc.ssoToken = ssoToken;
          if (refreshToken) acc.refreshToken = refreshToken;
          if (raw.name) acc.name = raw.name;
          acc.status = 'active';
          acc.cooldownUntil = 0;
          updated++;
        } else {
          skipped++;
        }
      } else {
        const newAcc = new Account({
          id: raw.id,
          name,
          email,
          ssoToken,
          refreshToken,
          status: 'active'
        });
        this.accounts.push(newAcc);
        added++;
      }
    }

    await this.save();

    return {
      success: true,
      added,
      updated,
      skipped,
      total: this.accounts.length,
      errors
    };
  }

  async deleteDisabledAccounts() {
    const initial = this.accounts.length;
    this.accounts = this.accounts.filter(a => a.status !== 'disabled');
    const deleted = initial - this.accounts.length;
    if (deleted > 0) {
      await this.save();
    }
    return { success: true, deleted, total: this.accounts.length };
  }
}

