import crypto from 'node:crypto';
import { User } from '../core/User.js';

export class UserService {
  constructor(storage, config) {
    this.storage = storage;
    this.config = config;
    this.users = [];
  }

  async init() {
    const raw = await this.storage.read(this.config.USERS_FILE, []);
    this.users = raw.map(u => new User(u));
    if (this.users.length === 0) {
      const { hash, salt } = User.hashPassword('admin123');
      const defaultAdmin = new User({
        email: 'admin@local.com',
        passwordHash: hash,
        passwordSalt: salt,
        role: 'admin'
      });
      this.users.push(defaultAdmin);
      await this.save();
    }
  }

  async save() {
    await this.storage.write(this.config.USERS_FILE, this.users.map(u => ({
      id: u.id,
      email: u.email,
      passwordHash: u.passwordHash,
      passwordSalt: u.passwordSalt,
      role: u.role,
      createdAt: u.createdAt
    })));
  }

  createToken(payload, expiresInMs = 7 * 24 * 60 * 60 * 1000) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const data = { ...payload, exp: Date.now() + expiresInMs };
    const body = Buffer.from(JSON.stringify(data)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.config.AUTH_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', this.config.AUTH_SECRET).update(`${header}.${body}`).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expectedSigBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedSigBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedSigBuf)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && Date.now() > payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async login(email, password) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = this.users.find(u => u.email === cleanEmail);
    if (!user || !user.verifyPassword(password)) {
      throw new Error('Sai tài khoản hoặc mật khẩu.');
    }
    const token = this.createToken({ userId: user.id, email: user.email, role: user.role });
    return { token, user: user.toJSON() };
  }

  async createUser(email, password, role = 'user') {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (this.users.some(u => u.email === cleanEmail)) {
      throw new Error('Email đã tồn tại.');
    }
    const { hash, salt } = User.hashPassword(password);
    const newUser = new User({ email: cleanEmail, passwordHash: hash, passwordSalt: salt, role });
    this.users.push(newUser);
    await this.save();
    return newUser.toJSON();
  }

  async register(email, password) {
    return this.createUser(email, password, 'user');
  }

  getUsers() {
    return this.users.map(u => u.toJSON());
  }

  async deleteUser(id) {
    const idx = this.users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    this.users.splice(idx, 1);
    await this.save();
    return true;
  }
}
