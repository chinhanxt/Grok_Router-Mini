import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Compare two semver strings (e.g., "1.1.0" vs "1.0.0")
 * Returns true if latest > current
 */
export function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const parse = (v) => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);

  if (lMaj > cMaj) return true;
  if (lMaj < cMaj) return false;
  if (lMin > cMin) return true;
  if (lMin < cMin) return false;
  return lPat > cPat;
}

/**
 * Generate terminal banner notifying about an available update
 */
export function formatUpdateBanner({ packageName = 'grok-router-mini', currentVersion, latestVersion }) {
  const cReset = '\x1b[0m';
  const cBold = '\x1b[1m';
  const cYellow = '\x1b[33m';
  const cGreen = '\x1b[32m';
  const cDim = '\x1b[2m';
  const cCyan = '\x1b[36m';

  return `
${cYellow}╭─────────────────────────────────────────────────────────────╮${cReset}
${cYellow}│${cReset}                                                             ${cYellow}│${cReset}
${cYellow}│${cReset}   ${cBold}🔔 ĐÃ CÓ PHIÊN BẢN MỚI: ${cDim}v${currentVersion}${cReset} ${cBold}→${cReset} ${cGreen}v${latestVersion}${cReset}                   ${cYellow}│${cReset}
${cYellow}│${cReset}   Chạy lệnh sau để cập nhật lên bản mới nhất:                ${cYellow}│${cReset}
${cYellow}│${cReset}   ${cCyan}npm install -g ${packageName}${cReset}                           ${cYellow}│${cReset}
${cYellow}│${cReset}                                                             ${cYellow}│${cReset}
${cYellow}╰─────────────────────────────────────────────────────────────╯${cReset}`;
}

/**
 * Check for updates against npm registry with caching
 * Safe: never throws or blocks execution
 */
export async function checkUpdate({
  packageName = 'grok-router-mini',
  currentVersion = '1.0.0',
  cacheDir = null,
  checkIntervalMs = 12 * 60 * 60 * 1000, // 12 hours
  timeoutMs = 1800
} = {}) {
  const dir = cacheDir || path.join(os.homedir(), '.grok-router');
  const cacheFile = path.join(dir, '.update-cache.json');

  try {
    if (fs.existsSync(cacheFile)) {
      const raw = fs.readFileSync(cacheFile, 'utf8');
      const cache = JSON.parse(raw);
      if (cache && typeof cache.lastCheck === 'number' && cache.latestVersion) {
        if (Date.now() - cache.lastCheck < checkIntervalMs) {
          const hasUpdate = isNewerVersion(cache.latestVersion, currentVersion);
          return { hasUpdate, latestVersion: cache.latestVersion, currentVersion, fromCache: true };
        }
      }
    }
  } catch {
    // Ignore cache read errors
  }

  // Query registry
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept': 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*' }
    });

    if (!res.ok) {
      saveCache(cacheFile, dir, currentVersion);
      return { hasUpdate: false, currentVersion };
    }

    const data = await res.json();
    const latestVersion = data.version;

    if (latestVersion) {
      saveCache(cacheFile, dir, latestVersion);
      const hasUpdate = isNewerVersion(latestVersion, currentVersion);
      return { hasUpdate, latestVersion, currentVersion, fromCache: false };
    }
  } catch {
    // Network offline, timeout, or DNS failure — fail silently
  }

  return { hasUpdate: false, currentVersion };
}

function saveCache(cacheFile, dir, latestVersion) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cacheFile, JSON.stringify({ lastCheck: Date.now(), latestVersion }), 'utf8');
  } catch {
    // Ignore cache write errors
  }
}
