// api/admin.js - Vercel Serverless Function for License & Node Administration
import crypto from 'node:crypto';
import { kvGet, kvSet, verifyAdmin, hasKvConfigured, parseRequestBody } from './lib/kv.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const action = searchParams.get('action') || '';
  const body = req.method !== 'GET' ? await parseRequestBody(req) : {};

  // 1. Admin Login
  if (action === 'login' && req.method === 'POST') {
    const { password } = body;
    const configuredPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (!password || password !== configuredPassword) {
      return res.status(401).json({ error: 'Mật khẩu quản trị không chính xác' });
    }

    return res.status(200).json({
      ok: true,
      token: configuredPassword,
      hasKv: hasKvConfigured()
    });
  }

  // Guard all subsequent actions with verifyAdmin
  if (!verifyAdmin(req)) {
    return res.status(403).json({ error: 'Yêu cầu quyền Quản trị viên (Admin)' });
  }

  // 2. Fetch Nodes
  if (action === 'getNodes' && req.method === 'GET') {
    const nodes = (await kvGet('nodes')) || [];
    // Return nodes with masked api keys for view, but keep id and status
    const safeNodes = nodes.map(n => ({
      id: n.id,
      name: n.name,
      maskedKey: n.apiKey ? `${n.apiKey.slice(0, 8)}...${n.apiKey.slice(-4)}` : '',
      status: n.status || 'active',
      createdAt: n.createdAt
    }));
    return res.status(200).json({ ok: true, nodes: safeNodes, hasKv: hasKvConfigured() });
  }

  // 3. Add Single Node
  if (action === 'addNode' && req.method === 'POST') {
    const { name, apiKey } = body || {};
    if (!apiKey) return res.status(400).json({ error: 'Thiếu API Key' });

    const nodes = (await kvGet('nodes')) || [];
    const newNode = {
      id: crypto.randomUUID(),
      name: (name || `Node-${nodes.length + 1}`).trim(),
      apiKey: apiKey.trim(),
      status: 'active',
      createdAt: new Date().toISOString()
    };
    nodes.unshift(newNode);
    await kvSet('nodes', nodes);
    return res.status(200).json({ ok: true, node: newNode });
  }

  // 4. Bulk Import Nodes (Tương thích định dạng nhập nhiều của dự án chính)
  if (action === 'bulkImportNodes' && req.method === 'POST') {
    const { text } = body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Thiếu danh sách token' });
    }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Không có token hợp lệ nào' });
    }

    const nodes = (await kvGet('nodes')) || [];
    const existingKeys = new Set(nodes.map(n => n.apiKey));
    let addedCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let token = line;
      let name = `Node-Import-${Date.now().toString().slice(-4)}-${i + 1}`;

      // Support "name:token" or "name,token" or pure "token"
      if (line.includes(':') && !line.startsWith('http')) {
        const parts = line.split(':');
        name = parts[0].trim();
        token = parts.slice(1).join(':').trim();
      } else if (line.includes(',') && !line.startsWith('{')) {
        const parts = line.split(',');
        name = parts[0].trim();
        token = parts.slice(1).join(',').trim();
      }

      if (token && !existingKeys.has(token)) {
        nodes.push({
          id: crypto.randomUUID(),
          name,
          apiKey: token,
          status: 'active',
          createdAt: new Date().toISOString()
        });
        existingKeys.add(token);
        addedCount++;
      }
    }

    await kvSet('nodes', nodes);
    return res.status(200).json({ ok: true, addedCount, totalNodes: nodes.length });
  }

  // 5. Delete Node
  if (action === 'deleteNode' && req.method === 'DELETE') {
    const id = searchParams.get('id');
    let nodes = (await kvGet('nodes')) || [];
    nodes = nodes.filter(n => n.id !== id);
    await kvSet('nodes', nodes);
    return res.status(200).json({ ok: true, totalNodes: nodes.length });
  }

  // 6. Get License Keys
  if (action === 'getKeys' && req.method === 'GET') {
    const keys = (await kvGet('keys')) || [];
    return res.status(200).json({ ok: true, keys, hasKv: hasKvConfigured() });
  }

  // 7. Create License Key
  if (action === 'createKey' && req.method === 'POST') {
    const { label, keyString, maxDevices, expireDays, assignedNodeIds } = body || {};

    const cleanKey = (keyString || `KEY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`).trim();
    const cleanLabel = (label || 'Khách hàng').trim();
    const limit = parseInt(maxDevices, 10) || 1; // Default 1 thiết bị

    let expireAt = null;
    if (expireDays && parseInt(expireDays, 10) > 0) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(expireDays, 10));
      expireAt = d.toISOString();
    }

    const keys = (await kvGet('keys')) || [];
    if (keys.some(k => k.key.toUpperCase() === cleanKey.toUpperCase())) {
      return res.status(400).json({ error: 'Mã License Key này đã tồn tại' });
    }

    const newKey = {
      id: crypto.randomUUID(),
      key: cleanKey,
      label: cleanLabel,
      maxDevices: limit, // 1 hoặc nhiều thiết bị
      devices: [], // [{ id, name, activatedAt, lastSeen }]
      assignedNodeIds: Array.isArray(assignedNodeIds) ? assignedNodeIds : 'all',
      active: true,
      expireAt,
      createdAt: new Date().toISOString()
    };

    keys.unshift(newKey);
    await kvSet('keys', keys);
    return res.status(200).json({ ok: true, key: newKey });
  }

  // 8. Toggle Key Status (Active / Suspended)
  if (action === 'toggleKey' && req.method === 'POST') {
    const { id } = body || {};
    const keys = (await kvGet('keys')) || [];
    const item = keys.find(k => k.id === id);
    if (!item) return res.status(404).json({ error: 'Không tìm thấy key' });

    item.active = !item.active;
    await kvSet('keys', keys);
    return res.status(200).json({ ok: true, active: item.active });
  }

  // 9. Reset Registered Devices for a Key
  if (action === 'resetDevices' && req.method === 'POST') {
    const { id } = body || {};
    const keys = (await kvGet('keys')) || [];
    const item = keys.find(k => k.id === id);
    if (!item) return res.status(404).json({ error: 'Không tìm thấy key' });

    item.devices = [];
    await kvSet('keys', keys);
    return res.status(200).json({ ok: true, devices: [] });
  }

  // 10. Delete Key
  if (action === 'deleteKey' && req.method === 'DELETE') {
    const id = searchParams.get('id');
    let keys = (await kvGet('keys')) || [];
    keys = keys.filter(k => k.id !== id);
    await kvSet('keys', keys);
    return res.status(200).json({ ok: true, totalKeys: keys.length });
  }

  return res.status(400).json({ error: `Action ${action} không hợp lệ` });
}
