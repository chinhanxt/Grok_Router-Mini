import path from 'node:path';
import os from 'node:os';

export class AppConfig {
  constructor(env = process.env) {
    this.PORT = parseInt(env.PORT || '3005', 10);
    this.HOST = env.HOST || '0.0.0.0';
    this.DATA_DIR = env.DATA_DIR || path.join(os.homedir(), '.grok-router');
    this.ACCOUNTS_FILE = path.join(this.DATA_DIR, 'accounts.json');
    this.USERS_FILE = path.join(this.DATA_DIR, 'users.json');
    this.STATS_FILE = path.join(this.DATA_DIR, 'stats.json');
    this.LOGS_FILE = path.join(this.DATA_DIR, 'logs.json');
    this.AUTH_SECRET = env.AUTH_SECRET || 'grok-mini-auth-secret-key-2026';
    this.GROK_PROXY_BASE = 'https://cli-chat-proxy.grok.com/v1';
    this.XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
    this.XAI_AUTH_BASE = 'https://auth.x.ai';
    this.DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
  }
}

export const appConfig = new AppConfig();
