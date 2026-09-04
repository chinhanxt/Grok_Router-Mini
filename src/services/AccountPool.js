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
    await this.storage.write(this.config.ACCOUNTS_FILE, this.accounts.map(a => a.toJSON()));
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
}
