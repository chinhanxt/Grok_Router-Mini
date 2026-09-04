import crypto from 'node:crypto';

export class Account {
  constructor(data = {}) {
    this.id = data.id || crypto.randomUUID();
    this.name = data.name || data.email || 'AI Account';
    this.email = data.email || '';
    this.ssoToken = data.ssoToken || data.apiKey || data.token || '';
    this.refreshToken = data.refreshToken || '';
    this.source = data.source || 'local'; // 'local' | 'license'
    this.status = data.status || 'active'; // 'active' | 'cooling' | 'disabled'
    this.cooldownUntil = data.cooldownUntil || 0;
    this.requestCount = Number(data.requestCount || 0);
    this.totalTokens = Number(data.totalTokens || 0);
    this.expiresAt = data.expiresAt || 0;
    this.createdAt = data.createdAt || Date.now();
  }

  isAvailable() {
    if (this.status === 'disabled') return false;
    if (this.status === 'cooling') {
      return Date.now() >= this.cooldownUntil;
    }
    return this.status === 'active';
  }

  setCooling(cooldownMs = 10 * 60 * 1000) {
    this.status = 'cooling';
    this.cooldownUntil = Date.now() + cooldownMs;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      ssoToken: this.ssoToken,
      refreshToken: this.refreshToken,
      source: this.source,
      status: this.status,
      cooldownUntil: this.cooldownUntil,
      requestCount: this.requestCount,
      totalTokens: this.totalTokens,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt
    };
  }

  static fromJSON(json) {
    return new Account(json);
  }
}
