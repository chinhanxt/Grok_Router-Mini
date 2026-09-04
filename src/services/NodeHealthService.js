export class NodeHealthService {
  constructor(accountPool, config = {}) {
    this.accountPool = accountPool;
    this.config = config;
    this.timer = null;
    this.isChecking = false;
  }

  decodeJwt(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  async refreshAccountToken(account) {
    if (!account || !account.refreshToken) {
      return { success: false, error: 'No refresh token available' };
    }

    const authBase = this.config.XAI_AUTH_BASE || 'https://auth.x.ai';
    const clientId = this.config.XAI_CLIENT_ID || 'b1a00492-073a-47ea-816f-4c329264a828';

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: account.refreshToken
      });

      const res = await fetch(`${authBase}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 400 || res.status === 401) {
          account.status = 'disabled';
          return { success: false, disabled: true, error: `Token revoked/expired: ${res.status}` };
        }
        return { success: false, transient: true, error: `HTTP ${res.status}: ${errText}` };
      }

      const data = await res.json();
      if (!data.access_token) {
        return { success: false, error: 'Missing access_token in response' };
      }

      account.ssoToken = data.access_token;
      if (data.refresh_token) {
        account.refreshToken = data.refresh_token;
      }

      const jwtInfo = this.decodeJwt(data.access_token);
      const now = Date.now();
      account.expiresAt = (jwtInfo?.exp) ? (jwtInfo.exp * 1000) : (now + (data.expires_in || 21600) * 1000);
      account.status = 'active';
      account.cooldownUntil = 0;

      return { success: true, account };
    } catch (err) {
      return { success: false, transient: true, error: err.message };
    }
  }

  async checkAccount(account, { forceRefresh = false, now = Date.now() } = {}) {
    let refreshed = false;
    let recovered = false;

    // 1. Recover cooling status if cooldown expired
    if (account.status === 'cooling' && now >= (account.cooldownUntil || 0)) {
      account.status = 'active';
      account.cooldownUntil = 0;
      recovered = true;
    }

    // 2. Check if token needs refresh (within 15 minutes of expiry or expired or forceRefresh)
    const isNearExpiry = !account.expiresAt || (account.expiresAt - now < 15 * 60 * 1000);
    if ((isNearExpiry || forceRefresh) && account.refreshToken && account.status !== 'disabled') {
      const res = await this.refreshAccountToken(account);
      if (res.success) {
        refreshed = true;
      }
    }

    return { refreshed, recovered, status: account.status };
  }

  async checkAllNodes({ forceRefresh = false, concurrency = 5 } = {}) {
    if (this.isChecking) {
      return { inProgress: true };
    }

    this.isChecking = true;
    const now = Date.now();
    const accounts = this.accountPool?.getAccounts() || [];
    let refreshedCount = 0;
    let recoveredCount = 0;
    let disabledCount = 0;

    try {
      for (let i = 0; i < accounts.length; i += concurrency) {
        const chunk = accounts.slice(i, i + concurrency);
        const results = await Promise.all(chunk.map(acc => this.checkAccount(acc, { forceRefresh, now })));
        for (const r of results) {
          if (r.refreshed) refreshedCount++;
          if (r.recovered) recoveredCount++;
          if (r.status === 'disabled') disabledCount++;
        }
      }

      if (refreshedCount > 0 || recoveredCount > 0 || disabledCount > 0) {
        await this.accountPool.save();
      }

      const activeCount = accounts.filter(a => a.status === 'active').length;
      const coolingCount = accounts.filter(a => a.status === 'cooling').length;

      return {
        success: true,
        total: accounts.length,
        refreshed: refreshedCount,
        recovered: recoveredCount,
        active: activeCount,
        cooling: coolingCount,
        disabled: accounts.filter(a => a.status === 'disabled').length
      };
    } finally {
      this.isChecking = false;
    }
  }

  startBackgroundWorker(intervalMs = 15 * 60 * 1000) {
    if (this.timer) clearInterval(this.timer);

    // Initial check after 3 seconds
    setTimeout(() => {
      this.checkAllNodes().catch(() => {});
    }, 3000).unref();

    this.timer = setInterval(() => {
      this.checkAllNodes().catch(() => {});
    }, intervalMs);

    this.timer.unref();
    return this.timer;
  }

  stopBackgroundWorker() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
