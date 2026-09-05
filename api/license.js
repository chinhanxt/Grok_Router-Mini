// api/license.js - Public endpoint for clients to activate license and receive node pool
import crypto from 'node:crypto';
import { kvGet, kvSet, parseRequestBody } from './lib/kv.js';

function encryptPayload(data, licenseKey, machineId) {
  const key = crypto.createHash('sha256').update(`${licenseKey}:${machineId}:AI_CLAUDE_SECURE_PAYLOAD_SALT_2026`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(data);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return {
    iv: iv.toString('hex'),
    data: encrypted,
    tag
  };
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
  }

  try {
    const body = await parseRequestBody(req);
    const { licenseKey, key, machineId, deviceName } = body || {};
    const effectiveKey = licenseKey || key;

    if (!effectiveKey || typeof effectiveKey !== 'string') {
      return res.status(400).json({ ok: false, error: 'Vui lòng nhập mã kích hoạt (License Key)' });
    }

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const action = searchParams.get('action') || (body && body.action) || '';

    if (action === 'check') {
      const cleanKey = effectiveKey.trim().toUpperCase();
      const rawKeys = await kvGet('keys');
      const keys = Array.isArray(rawKeys) ? rawKeys : [];
      const targetKey = keys.find(k => k && k.key && k.key.toUpperCase() === cleanKey);

      if (!targetKey) {
        return res.status(401).json({ ok: false, error: 'Mã License không chính xác hoặc không tồn tại' });
      }
      if (targetKey.active === false) {
        return res.status(403).json({ ok: false, error: 'Mã License này đã bị tạm khóa' });
      }
      if (targetKey.expireAt && Date.now() > new Date(targetKey.expireAt).getTime()) {
        const exp = new Date(targetKey.expireAt).toLocaleDateString('vi-VN');
        return res.status(403).json({ ok: false, error: `Mã License đã hết hạn vào ${exp}` });
      }

      if (machineId) {
        targetKey.devices = targetKey.devices || [];
        const device = targetKey.devices.find(d => d.id === machineId);
        if (!device) {
          return res.status(403).json({ ok: false, valid: false, error: 'Thiết bị này đã bị ngắt kết nối hoặc xóa khỏi License Key' });
        }
        device.lastSeen = new Date().toISOString();
        if (deviceName && deviceName !== device.name) {
          device.name = deviceName;
        }
        await kvSet('keys', keys);
      }

      const packageId = targetKey.packageId || 'default';
      let rawNodes = await kvGet(`package_${packageId}`);
      if ((!rawNodes || (Array.isArray(rawNodes) && rawNodes.length === 0)) && packageId === 'default') {
        rawNodes = await kvGet('nodes');
      }
      const allNodes = Array.isArray(rawNodes) ? rawNodes : [];
      const activeCount = allNodes.filter(n => n && n.status !== 'disabled').length;

      return res.status(200).json({
        ok: true,
        valid: true,
        licenseKey: targetKey.key,
        label: targetKey.label,
        packageId: packageId,
        nodeCount: activeCount,
        expireAt: targetKey.expireAt,
        deviceSlot: `${(targetKey.devices || []).length}/${targetKey.maxDevices >= 999 ? '∞' : targetKey.maxDevices}`
      });
    }

    if (!machineId || typeof machineId !== 'string') {
      return res.status(400).json({ ok: false, error: 'Thiếu định danh thiết bị (Machine ID)' });
    }

    const cleanKey = effectiveKey.trim().toUpperCase();
    const rawKeys = await kvGet('keys');
    const keys = Array.isArray(rawKeys) ? rawKeys : [];
    const targetKey = keys.find(k => k && k.key && k.key.toUpperCase() === cleanKey);

  // 1. Kiểm tra tồn tại
  if (!targetKey) {
    return res.status(401).json({ ok: false, error: 'Mã sử dụng không chính xác hoặc không tồn tại' });
  }

  // 2. Kiểm tra trạng thái hoạt động
  if (targetKey.active === false) {
    return res.status(403).json({ ok: false, error: 'Mã sử dụng này đã bị quản trị viên tạm khóa' });
  }

  // 3. Kiểm tra hạn sử dụng
  if (targetKey.expireAt) {
    const expireDate = new Date(targetKey.expireAt);
    if (Date.now() > expireDate.getTime()) {
      return res.status(403).json({ ok: false, error: `Mã sử dụng đã hết hạn vào ${expireDate.toLocaleDateString('vi-VN')}` });
    }
  }

  // 4. Kiểm tra và xác thực thiết bị (Device Locking)
  targetKey.devices = targetKey.devices || [];
  const existingDevice = targetKey.devices.find(d => d.id === machineId);

  if (existingDevice) {
    existingDevice.lastSeen = new Date().toISOString();
    if (deviceName && deviceName !== existingDevice.name) {
      existingDevice.name = deviceName;
    }
  } else {
    // Thiết bị mới kết nối
    const maxAllowed = targetKey.maxDevices || 1;
    if (targetKey.devices.length >= maxAllowed) {
      return res.status(403).json({
        ok: false,
        error: `Mã này chỉ cho phép tối đa ${maxAllowed} thiết bị. Hiện đã đăng ký đủ ${targetKey.devices.length} máy.`
      });
    }

    targetKey.devices.push({
      id: machineId,
      name: (deviceName || 'Workstation').slice(0, 50),
      activatedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    });
  }

  // Cập nhật trạng thái thiết bị vào KV
  await kvSet('keys', keys);

    // 5. Cung cấp Node cho client theo Gói Node được gán
    const packageId = targetKey.packageId || 'default';
    let rawNodes = await kvGet(`package_${packageId}`);
    if ((!rawNodes || (Array.isArray(rawNodes) && rawNodes.length === 0)) && packageId === 'default') {
      rawNodes = await kvGet('nodes');
    }
    const allNodes = Array.isArray(rawNodes) ? rawNodes : [];
    const activeNodes = allNodes.filter(n => n && n.status !== 'disabled');

    let grantedNodes = [];
    if (targetKey.assignedNodeIds === 'all' || !targetKey.assignedNodeIds) {
      grantedNodes = activeNodes;
    } else if (Array.isArray(targetKey.assignedNodeIds)) {
      const allowedSet = new Set(targetKey.assignedNodeIds);
      grantedNodes = activeNodes.filter(n => allowedSet.has(n.id));
    }

    if (grantedNodes.length === 0) {
      return res.status(200).json({
        ok: true,
        licenseKey: targetKey.key,
        label: targetKey.label,
        packageId: packageId,
        expireAt: targetKey.expireAt,
        deviceSlot: `${targetKey.devices.length}/${targetKey.maxDevices || 1}`,
        nodes: [],
        warning: 'Mã hợp lệ nhưng hiện tại hệ thống chưa gán node nào cho mã này'
      });
    }

    const safeNodes = grantedNodes.map(n => ({
      id: n.id,
      name: n.name,
      email: n.email || '',
      apiKey: n.ssoToken || n.apiKey || '',
      ssoToken: n.ssoToken || n.apiKey || '',
      refreshToken: n.refreshToken || ''
    }));

    return res.status(200).json({
      ok: true,
      licenseKey: targetKey.key,
      label: targetKey.label,
      packageId: packageId,
      expireAt: targetKey.expireAt,
      deviceSlot: `${targetKey.devices.length}/${targetKey.maxDevices || 1}`,
      encrypted: true,
      payload: encryptPayload(safeNodes, targetKey.key, machineId)
    });
  } catch (err) {
    console.error('License API error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
