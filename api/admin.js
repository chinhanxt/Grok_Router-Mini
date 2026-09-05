// api/admin.js - Vercel Serverless Function for License & Node Administration
import crypto from 'node:crypto';
import { kvGet, kvSet, verifyAdmin, hasKvConfigured, parseRequestBody, generateAdminToken } from './lib/kv.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const action = searchParams.get('action') || '';
    const body = req.method !== 'GET' ? await parseRequestBody(req) : {};

    // 1. Admin Login
    if (action === 'login' && req.method === 'POST') {
      const { password } = body;
      const configuredPassword = process.env.ADMIN_PASSWORD || 'chinhanxt';

      const candidatePwd = Buffer.from(password || '');
      const targetPwd = Buffer.from(configuredPassword);
      if (candidatePwd.length !== targetPwd.length || !crypto.timingSafeEqual(candidatePwd, targetPwd)) {
        return res.status(401).json({ error: 'Mật khẩu quản trị không chính xác' });
      }

      return res.status(200).json({
        ok: true,
        token: generateAdminToken(configuredPassword),
        hasKv: hasKvConfigured()
      });
    }

    // Guard all subsequent actions with verifyAdmin
    if (!verifyAdmin(req)) {
      return res.status(404).json({ error: 'Not Found' });
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

  // 5.1. Get Node Packages (Danh sách các file node)
  if (action === 'getNodePackages' && req.method === 'GET') {
    const rawPackages = await kvGet('node_packages');
    let packages = Array.isArray(rawPackages) ? rawPackages : [];
    const keys = (await kvGet('keys')) || [];

    if (packages.length === 0) {
      const rawLegacy = await kvGet('nodes');
      const legacyNodes = Array.isArray(rawLegacy) ? rawLegacy : [];
      if (legacyNodes.length > 0) {
        packages = [{
          id: 'default',
          name: 'Kho Node Mặc Định',
          filename: 'default-nodes.json',
          nodeCount: legacyNodes.length,
          updatedAt: new Date().toISOString(),
          isDefault: true
        }];
        await kvSet('node_packages', packages);
        await kvSet('package_default', legacyNodes);
      }
    }

    let totalNodes = 0;
    for (const p of packages) totalNodes += (p.nodeCount || 0);

    return res.status(200).json({ ok: true, packages, totalNodes, keys, hasKv: hasKvConfigured() });
  }

  // 5.2. Upload / Import Node Package (Hỗ trợ 2 option: Đè lên node hiện tại hoặc tạo mới)
  if (action === 'uploadNodePackage' && req.method === 'POST') {
    const { mode, targetPackageId, targetKeyId, name, filename, nodes } = body || {};

    if (!Array.isArray(nodes) || nodes.length === 0) {
      return res.status(400).json({ error: 'Danh sách node trống hoặc không hợp lệ' });
    }

    const minified = nodes.map(n => ({
      id: n.id || crypto.randomUUID(),
      name: n.name || n.email || 'AI Node',
      email: n.email || '',
      ssoToken: n.ssoToken || n.apiKey || n.token || n.access_token || '',
      refreshToken: n.refreshToken || n.refresh_token || n.ssoRwCookie || '',
      status: n.status || 'active'
    })).filter(n => n.ssoToken);

    if (minified.length === 0) {
      return res.status(400).json({ error: 'Không tìm thấy token hợp lệ nào trong file' });
    }

    const rawPackages = await kvGet('node_packages');
    let packages = Array.isArray(rawPackages) ? rawPackages : [];
    let keys = (await kvGet('keys')) || [];

    let affectedPackage = null;

    if (mode === 'overwrite') {
      const pkgId = targetPackageId || 'default';
      let existingPkg = packages.find(p => p.id === pkgId);
      if (!existingPkg) {
        existingPkg = {
          id: pkgId,
          name: name || filename || 'Kho Node Mặc Định',
          filename: filename || 'nodes.json',
          nodeCount: minified.length,
          updatedAt: new Date().toISOString(),
          isDefault: pkgId === 'default'
        };
        packages.push(existingPkg);
      } else {
        existingPkg.nodeCount = minified.length;
        existingPkg.updatedAt = new Date().toISOString();
        if (filename) existingPkg.filename = filename;
      }
      affectedPackage = existingPkg;

      await kvSet(`package_${pkgId}`, minified);
      if (pkgId === 'default') {
        await kvSet('nodes', minified);
      }

      if (targetKeyId) {
        const k = keys.find(item => item.id === targetKeyId);
        if (k) k.packageId = pkgId;
      }
    } else {
      // Option 2: Tạo ra một file node mới
      const pkgId = `pkg-${crypto.randomUUID().slice(0, 8)}`;
      const cleanName = (name || filename || `Gói Node ${packages.length + 1}`).replace(/\.json$/i, '');
      const newPkg = {
        id: pkgId,
        name: cleanName,
        filename: filename || `${cleanName}.json`,
        nodeCount: minified.length,
        updatedAt: new Date().toISOString(),
        isDefault: packages.length === 0
      };
      packages.unshift(newPkg);
      affectedPackage = newPkg;

      await kvSet(`package_${pkgId}`, minified);

      if (targetKeyId) {
        const k = keys.find(item => item.id === targetKeyId);
        if (k) k.packageId = pkgId;
      }
    }

    await kvSet('node_packages', packages);
    await kvSet('keys', keys);

    return res.status(200).json({
      ok: true,
      mode,
      package: affectedPackage,
      nodeCount: minified.length,
      totalPackages: packages.length
    });
  }

  // 5.3. Xem trước các Node trong một gói
  if (action === 'getPackageNodes' && req.method === 'GET') {
    const pkgId = searchParams.get('id') || 'default';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const query = (searchParams.get('query') || '').trim().toLowerCase();

    const rawNodes = (await kvGet(`package_${pkgId}`)) || (pkgId === 'default' ? await kvGet('nodes') : []);
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];

    let filtered = nodes;
    if (query) {
      filtered = nodes.filter(n =>
        (n.name && n.name.toLowerCase().includes(query)) ||
        (n.email && n.email.toLowerCase().includes(query))
      );
    }

    const start = (page - 1) * limit;
    const slice = filtered.slice(start, start + limit).map(n => ({
      id: n.id,
      name: n.name,
      email: n.email,
      maskedKey: (n.ssoToken || n.apiKey) ? `${(n.ssoToken || n.apiKey).slice(0, 8)}...${(n.ssoToken || n.apiKey).slice(-4)}` : '',
      status: n.status || 'active'
    }));

    return res.status(200).json({
      ok: true,
      packageId: pkgId,
      total: filtered.length,
      page,
      limit,
      nodes: slice
    });
  }

  // 5.4. Xuất file JSON của một gói
  if (action === 'exportPackage' && req.method === 'GET') {
    const pkgId = searchParams.get('id') || 'default';
    const rawNodes = (await kvGet(`package_${pkgId}`)) || (pkgId === 'default' ? await kvGet('nodes') : []);
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];

    res.setHeader('Content-Disposition', `attachment; filename="nodes-${pkgId}.json"`);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(nodes);
  }

  // 5.5. Xóa Gói Node
  if (action === 'deleteNodePackage' && req.method === 'DELETE') {
    const id = searchParams.get('id');
    if (!id || id === 'default') {
      return res.status(400).json({ error: 'Không thể xóa gói mặc định' });
    }

    let packages = (await kvGet('node_packages')) || [];
    packages = packages.filter(p => p.id !== id);
    await kvSet('node_packages', packages);

    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      try {
        await fetch(`${url}/del/package_${id}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch {}
    }

    return res.status(200).json({ ok: true, totalPackages: packages.length });
  }

  // 5.6. Gán Gói Node cho Key
  if (action === 'assignKeyPackage' && req.method === 'POST') {
    const { keyId, packageId } = body || {};
    let keys = (await kvGet('keys')) || [];
    const targetKey = keys.find(k => k.id === keyId);
    if (!targetKey) return res.status(404).json({ error: 'Không tìm thấy key' });

    targetKey.packageId = packageId;
    await kvSet('keys', keys);
    return res.status(200).json({ ok: true, key: targetKey });
  }

  // 6. Get License Keys
  if (action === 'getKeys' && req.method === 'GET') {
    const keys = (await kvGet('keys')) || [];
    return res.status(200).json({ ok: true, keys, hasKv: hasKvConfigured() });
  }

  // 7. Create License Key
  if (action === 'createKey' && req.method === 'POST') {
    const { label, keyString, maxDevices, expireDays, assignedNodeIds, packageId } = body || {};

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
      packageId: packageId || 'default', // Gói node được gán
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
  } catch (err) {
    console.error('Admin API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
