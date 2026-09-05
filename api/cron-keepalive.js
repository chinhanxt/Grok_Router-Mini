// api/cron-keepalive.js - Background Keep-Alive Worker for xAI Tokens
import { kvGet, kvSet, verifyAdmin } from './lib/kv.js';

const XAI_AUTH_BASE = 'https://auth.x.ai';
const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const MAX_EXECUTION_MS = 50000; // 50s limit before Vercel 60s timeout
const FRESH_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

function isAuthorized(req, searchParams) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  const isVercelCron = req.headers['x-vercel-cron'] === '1' ||
    (req.headers['user-agent'] && req.headers['user-agent'].includes('vercel-cron'));

  if (isVercelCron) return true;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (verifyAdmin(req)) return true;

  const querySecret = searchParams.get('secret');
  const configuredPassword = process.env.ADMIN_PASSWORD || 'chinhanxt';
  return Boolean(querySecret && querySecret === configuredPassword);
}

async function refreshSingleNode(node) {
  if (!node.refreshToken) return { skipped: true, reason: 'missing_refresh_token' };

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: XAI_CLIENT_ID,
      refresh_token: node.refreshToken
    });

    const res = await fetch(`${XAI_AUTH_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 400 && (errData.error === 'invalid_grant' || errData.error === 'expired_token')) {
        node.status = 'expired';
        node.lastCheckedAt = new Date().toISOString();
        return { expired: true, error: errData.error_description || 'invalid_grant' };
      }
      return { transient: true, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (!data.access_token) {
      return { error: 'Missing access_token' };
    }

    node.ssoToken = data.access_token;
    if (data.refresh_token) {
      node.refreshToken = data.refresh_token;
    }
    node.status = 'active';
    node.lastRefreshedAt = new Date().toISOString();
    return { success: true };
  } catch (err) {
    return { transient: true, error: err.message };
  }
}

async function processPackage(pkgId, startTime, freshThresholdMs = FRESH_THRESHOLD_MS) {
  const rawNodes = (await kvGet(`package_${pkgId}`)) || (pkgId === 'default' ? await kvGet('nodes') : []);
  const nodes = Array.isArray(rawNodes) ? rawNodes : [];
  if (nodes.length === 0) return { checked: 0, refreshed: 0, expired: 0, skipped: 0, errors: 0 };

  const now = Date.now();
  let checked = 0;
  let refreshed = 0;
  let expired = 0;
  let skipped = 0;
  let errors = 0;
  let hasChanges = false;

  const candidates = nodes.filter(n => n.refreshToken && n.status !== 'disabled');

  for (let i = 0; i < candidates.length; i += 10) {
    if (Date.now() - startTime >= MAX_EXECUTION_MS) break;

    const chunk = candidates.slice(i, i + 10);
    const promises = chunk.map(async node => {
      if (node.lastRefreshedAt && node.status === 'active') {
        const lastRef = new Date(node.lastRefreshedAt).getTime();
        if (now - lastRef < freshThresholdMs) {
          skipped++;
          return;
        }
      }

      checked++;
      const res = await refreshSingleNode(node);
      if (res.success) {
        refreshed++;
        hasChanges = true;
      } else if (res.expired) {
        expired++;
        hasChanges = true;
      } else if (res.skipped) {
        skipped++;
      } else {
        errors++;
      }
    });

    await Promise.all(promises);
    await new Promise(r => setTimeout(r, 100));
  }

  if (hasChanges) {
    await kvSet(`package_${pkgId}`, nodes);
    if (pkgId === 'default') {
      await kvSet('nodes', nodes);
    }
  }

  return { checked, refreshed, expired, skipped, errors, total: nodes.length };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();
  const { searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (!isAuthorized(req, searchParams)) {
    return res.status(401).json({ error: 'Unauthorized keep-alive cron execution' });
  }

  try {
    const config = (await kvGet('keepalive_config')) || {};
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    if (config.autoRunEnabled === false && isVercelCron) {
      return res.status(200).json({ ok: true, message: 'Keep-Alive is disabled in settings', skipped: true });
    }

    const freshHours = parseInt(config.freshThresholdHours, 10) || 48;
    const freshThresholdMs = freshHours * 60 * 60 * 1000;

    const rawPackages = await kvGet('node_packages');
    let packages = Array.isArray(rawPackages) ? rawPackages : [];

    if (packages.length === 0) {
      packages = [{ id: 'default', name: 'Kho Node Mặc Định', isDefault: true }];
    }

    const summary = {
      timestamp: new Date().toISOString(),
      packagesProcessed: 0,
      totalChecked: 0,
      refreshed: 0,
      expired: 0,
      skipped: 0,
      errors: 0
    };

    for (const pkg of packages) {
      if (Date.now() - startTime >= MAX_EXECUTION_MS) break;

      const pResult = await processPackage(pkg.id, startTime, freshThresholdMs);
      summary.packagesProcessed++;
      summary.totalChecked += pResult.checked;
      summary.refreshed += pResult.refreshed;
      summary.expired += pResult.expired;
      summary.skipped += pResult.skipped;
      summary.errors += pResult.errors;

      pkg.lastKeepAliveAt = new Date().toISOString();
    }

    summary.durationMs = Date.now() - startTime;
    await kvSet('node_packages', packages);
    await kvSet('keepalive_last_run', summary);

    return res.status(200).json({
      ok: true,
      message: 'Keep-Alive background run completed',
      summary
    });
  } catch (err) {
    console.error('Keep-Alive cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
