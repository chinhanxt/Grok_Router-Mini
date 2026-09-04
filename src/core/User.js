import crypto from 'node:crypto';

export class User {
  constructor(data = {}) {
    this.id = data.id || crypto.randomUUID();
    this.email = (data.email || '').trim().toLowerCase();
    this.passwordHash = data.passwordHash || '';
    this.passwordSalt = data.passwordSalt || '';
    this.role = data.role === 'admin' ? 'admin' : 'user';
    this.createdAt = data.createdAt || Date.now();
  }

  verifyPassword(password) {
    if (!this.passwordHash || !this.passwordSalt) return false;
    const computed = crypto.scryptSync(password, this.passwordSalt, 64).toString('hex');
    const bufComputed = Buffer.from(computed);
    const bufTarget = Buffer.from(this.passwordHash);
    if (bufComputed.length !== bufTarget.length) return false;
    return crypto.timingSafeEqual(bufComputed, bufTarget);
  }

  static hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
  }

  toJSON() {
    return {
      id: this.id,
      email: this.email,
      role: this.role,
      createdAt: this.createdAt
    };
  }
}
