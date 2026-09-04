// api/lib/kv.js - Resilient Storage Layer for Vercel KV / Upstash Redis
import crypto from 'node:crypto';

// In-memory fallback for testing / cold instances before KV is linked
let memoryStore = {
  nodes: [],
  keys: [],
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123'
};

export function hasKvConfigured() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return Boolean(url && token);
}

export async function kvGet(key) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return memoryStore[key] ?? null;
  }

  try {
    const res = await fetch(`${url}/get/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return memoryStore[key] ?? null;
    const data = await res.json();
    if (data.result === null || data.result === undefined) return null;
    try {
      return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
    } catch {
      return data.result;
    }
  } catch (err) {
    console.error(`KV GET error for ${key}:`, err.message);
    return memoryStore[key] ?? null;
  }
}

export async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  memoryStore[key] = value;

  if (!url || !token) {
    return true;
  }

  try {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const res = await fetch(`${url}/set/${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (err) {
    console.error(`KV SET error for ${key}:`, err.message);
    return false;
  }
}

export function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

export function verifyAdmin(req) {
  const authHeader = req.headers.authorization || '';
  const providedToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const configuredPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (!providedToken) return false;
  return providedToken === configuredPassword || providedToken === hashPassword(configuredPassword);
}

export async function parseRequestBody(req) {
  if (req.body) {
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}
