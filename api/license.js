// api/license.js - Public endpoint for clients to activate license and receive node pool
import { kvGet, kvSet, parseRequestBody } from './lib/kv.js';

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

  const body = await parseRequestBody(req);
  const { licenseKey, machineId, deviceName } = body || {};

  if (!licenseKey || typeof licenseKey !== 'string') {
    return res.status(400).json({ ok: false, error: 'Vui lòng nhập mã kích hoạt (License Key)' });
  }

  if (!machineId || typeof machineId !== 'string') {
    return res.status(400).json({ ok: false, error: 'Thiếu định danh thiết bị (Machine ID)' });
  }

  const cleanKey = licenseKey.trim().toUpperCase();
  const keys = (await kvGet('keys')) || [];
  const targetKey = keys.find(k => k.key.toUpperCase() === cleanKey);

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

  // 5. Cung cấp Node cho client
  const allNodes = (await kvGet('nodes')) || [];
  const activeNodes = allNodes.filter(n => n.status !== 'disabled');

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
      expireAt: targetKey.expireAt,
      deviceSlot: `${targetKey.devices.length}/${targetKey.maxDevices || 1}`,
      nodes: [],
      warning: 'Mã hợp lệ nhưng hiện tại hệ thống chưa gán node nào cho mã này'
    });
  }

  return res.status(200).json({
    ok: true,
    licenseKey: targetKey.key,
    label: targetKey.label,
    expireAt: targetKey.expireAt,
    deviceSlot: `${targetKey.devices.length}/${targetKey.maxDevices || 1}`,
    nodes: grantedNodes.map(n => ({
      id: n.id,
      name: n.name,
      apiKey: n.apiKey
    }))
  });
}
