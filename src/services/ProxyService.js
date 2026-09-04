import crypto from 'node:crypto';
import {
  getClaudeModelName,
  buildClaudeSystemPrompt,
  sanitizeClaudeText,
  sanitizeToClaudeError,
  AUTONOMOUS_AGENT_PROTOCOL,
  AUTONOMOUS_SOFTWARE_ENGINEERING_AGENT_EXECUTION_PROTOCOL
} from './claudeUtils.js';
import { buildOpenAIPayload, formatAnthropicResponse } from './claudeTranslator.js';
import { pipeAnthropicStream } from './claudeStreamer.js';
import { buildChatPayload, pipeChatStream } from './chatHandler.js';

export {
  getClaudeModelName,
  buildClaudeSystemPrompt,
  sanitizeClaudeText,
  sanitizeToClaudeError,
  AUTONOMOUS_AGENT_PROTOCOL,
  AUTONOMOUS_SOFTWARE_ENGINEERING_AGENT_EXECUTION_PROTOCOL
};

export class ProxyService {
  constructor(accountPool, config = {}, nodeHealthService = null) {
    this.accountPool = accountPool;
    this.accountPoolService = accountPool;
    this.config = config;
    this.nodeHealthService = nodeHealthService;
  }

  buildHeaders(account) {
    const clientVersion = this.config.GROK_CLIENT_VERSION || '1.0.0';
    const reqHeaders = {
      'Content-Type': 'application/json',
      'x-grok-client-version': clientVersion,
      'User-Agent': `grok-cli/${clientVersion}`
    };

    const token = account.accessToken || account.ssoToken || '';
    if (token && !token.includes('session_id')) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    } else {
      const sso = account.ssoCookie || token;
      const ssoRw = account.ssoRwCookie || account.refreshToken || sso;
      if (sso) {
        reqHeaders['Cookie'] = `sso=${sso}; sso-rw=${ssoRw}`;
        reqHeaders['Authorization'] = `Bearer ${sso}`;
      }
    }
    return reqHeaders;
  }

  async markCooling(account, cooldownMs) {
    if (!account) return;
    const ms = cooldownMs || this.config.DEFAULT_COOLDOWN_MS || 10 * 60 * 1000;
    if (typeof this.accountPool.markCooling === 'function') {
      await this.accountPool.markCooling(account.id, ms);
    } else if (typeof this.accountPool.markRateLimited === 'function') {
      await this.accountPool.markRateLimited(account.id, ms);
    }
  }

  async recordUsage(account, tokens = 0) {
    if (!account) return;
    if (typeof this.accountPool.incrementUsage === 'function') {
      await this.accountPool.incrementUsage(account.id, tokens);
    } else if (typeof this.accountPool.recordUsage === 'function') {
      await this.accountPool.recordUsage(account.id, tokens);
    }
  }

  listModels(req, res) {
    return res.json({
      object: 'list',
      data: [
        { id: 'claude-fable-5-1', object: 'model', created: 1786947792, owned_by: 'anthropic' },
        { id: 'claude-opus-5', object: 'model', created: 1786947792, owned_by: 'anthropic' },
        { id: 'claude-sonnet-5', object: 'model', created: 1786947792, owned_by: 'anthropic' },
        { id: 'claude-haiku-4-5', object: 'model', created: 1786947792, owned_by: 'anthropic' },
        { id: 'claude-3-5-sonnet', object: 'model', created: 1786947792, owned_by: 'anthropic' },
        { id: 'claude-3-5-sonnet-20241022', object: 'model', created: 1786947792, owned_by: 'anthropic' },
        { id: 'claude-3-7-sonnet-20250219', object: 'model', created: 1786947792, owned_by: 'anthropic' },
        { id: 'claude-3-opus-20240229', object: 'model', created: 1786947792, owned_by: 'anthropic' },
        { id: 'grok-4.6', object: 'model', created: 1786947792, owned_by: 'anthropic' }
      ]
    });
  }

  async handleChatCompletion(reqBody, clientRes, user = null, req = null) {
    const isStream = Boolean(reqBody.stream);
    const { upstreamBody, requestedModel } = buildChatPayload(reqBody);
    const accounts = typeof this.accountPool.getAccounts === 'function' ? this.accountPool.getAccounts() : [];
    const activeAccounts = accounts.filter(a => (typeof a.isAvailable === 'function' ? a.isAvailable() : a.status === 'active'));
    const maxRetries = Math.max(1, activeAccounts.length);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const account = await this.accountPool.getNextAvailableAccount();

      if (!account) {
        return clientRes.status(429).json({
          error: {
            message: 'Tất cả tài khoản đang trong thời gian hạ nhiệt do giới hạn tần suất (429). Vui lòng thử lại sau vài phút.',
            type: 'rate_limit_error',
            code: 'all_accounts_rate_limited'
          }
        });
      }

      try {
        const reqHeaders = this.buildHeaders(account);
        const upstreamUrl = `${this.config.GROK_PROXY_BASE || 'https://cli-chat-proxy.grok.com/v1'}/chat/completions`;

        const upstreamRes = await fetch(upstreamUrl, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(upstreamBody)
        });

        if (upstreamRes.status === 429) {
          const retryHeader = upstreamRes.headers?.get ? upstreamRes.headers.get('retry-after') : null;
          const retryAfter = retryHeader ? parseInt(retryHeader, 10) : null;
          const cooldownMs = (retryAfter && !isNaN(retryAfter)) ? (retryAfter * 1000) : (this.config.DEFAULT_COOLDOWN_MS || 10 * 60 * 1000);
          await this.markCooling(account, cooldownMs);
          continue;
        }

        if (upstreamRes.status === 401) {
          if (account.refreshToken && this.nodeHealthService) {
            const ref = await this.nodeHealthService.refreshAccountToken(account);
            if (ref.success) {
              await this.accountPool.save();
              continue;
            }
          }
          account.status = 'disabled';
          await this.accountPool.save();
          continue;
        }

        if (!upstreamRes.ok) {
          const errText = await upstreamRes.text();
          return clientRes.status(upstreamRes.status).send(errText);
        }

        if (isStream) {
          await pipeChatStream(upstreamRes, clientRes);
          await this.recordUsage(account, 100);
          return;
        }

        const data = await upstreamRes.json();
        if (data.choices && Array.isArray(data.choices)) {
          data.choices.forEach(c => {
            if (c.message?.content) {
              c.message.content = sanitizeClaudeText(c.message.content);
            }
          });
        }
        if (data.model) data.model = requestedModel;
        const tokens = data.usage?.total_tokens || 0;
        await this.recordUsage(account, tokens);

        return clientRes.json(data);
      } catch {
        // Retry next account
      }
    }

    return clientRes.status(502).json({
      error: {
        message: 'Không thể hoàn tất yêu cầu sau khi thử toàn bộ tài khoản trong pool.',
        type: 'router_error'
      }
    });
  }

  async handleAnthropicMessages(reqBody, clientRes, user = null, req = null) {
    const isStream = Boolean(reqBody.stream);
    const reqModel = reqBody.model || 'claude-3-5-sonnet-20241022';
    const msgId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);

    const openAIBody = buildOpenAIPayload(reqBody, reqModel);
    const accounts = typeof this.accountPool.getAccounts === 'function' ? this.accountPool.getAccounts() : [];
    const activeAccounts = accounts.filter(a => (typeof a.isAvailable === 'function' ? a.isAvailable() : a.status === 'active'));
    const maxRetries = Math.max(1, activeAccounts.length);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const account = await this.accountPool.getNextAvailableAccount();

      if (!account) {
        return clientRes.status(429).json({
          type: 'error',
          error: {
            type: 'rate_limit_error',
            code: 'all_accounts_rate_limited',
            message: 'Dịch vụ Claude hiện đang trong thời gian hạ nhiệt do giới hạn tần suất (Rate limit 429). Vui lòng thử lại sau vài phút.'
          }
        });
      }

      try {
        const reqHeaders = this.buildHeaders(account);
        const upstreamUrl = `${this.config.GROK_PROXY_BASE || 'https://cli-chat-proxy.grok.com/v1'}/chat/completions`;

        const upstreamRes = await fetch(upstreamUrl, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(openAIBody)
        });

        if (upstreamRes.status === 429) {
          const retryAfter = parseInt(upstreamRes.headers?.get?.('retry-after') || '600', 10);
          const cooldownMs = (retryAfter * 1000) || (this.config.DEFAULT_COOLDOWN_MS || 10 * 60 * 1000);
          await this.markCooling(account, cooldownMs);
          continue;
        }

        if (upstreamRes.status === 401) {
          if (account.refreshToken && this.nodeHealthService) {
            const ref = await this.nodeHealthService.refreshAccountToken(account);
            if (ref.success) {
              await this.accountPool.save();
              continue;
            }
          }
          account.status = 'disabled';
          await this.accountPool.save();
          continue;
        }

        if (!upstreamRes.ok) {
          const errText = await upstreamRes.text();
          let sanitizedMsg = 'Dịch vụ Claude gặp sự cố khi xử lý yêu cầu.';
          let errType = 'api_error';

          try {
            const parsed = JSON.parse(errText);
            const rawMsg = parsed.error?.message || parsed.message || errText;
            sanitizedMsg = sanitizeToClaudeError(rawMsg);
            if (upstreamRes.status === 400) errType = 'invalid_request_error';
            else if (upstreamRes.status === 401) errType = 'authentication_error';
            else if (upstreamRes.status === 403) errType = 'permission_error';
            else if (upstreamRes.status === 404) errType = 'not_found_error';
            else if (upstreamRes.status === 429) errType = 'rate_limit_error';
            else if (upstreamRes.status >= 500) errType = 'api_error';
          } catch {
            sanitizedMsg = sanitizeToClaudeError(errText);
          }

          return clientRes.status(upstreamRes.status).json({
            type: 'error',
            error: {
              type: errType,
              message: sanitizedMsg
            }
          });
        }

        if (isStream) {
          const outputTokens = await pipeAnthropicStream(upstreamRes, clientRes, reqModel, msgId);
          await this.recordUsage(account, outputTokens);
          return;
        }

        const data = await upstreamRes.json();
        const responseData = formatAnthropicResponse(data, reqModel, msgId);
        const tokens = data.usage?.total_tokens || 0;
        await this.recordUsage(account, tokens);

        return clientRes.json(responseData);
      } catch {
        // Retry next account
      }
    }

    return clientRes.status(502).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Dịch vụ Claude tạm thời không thể hoàn tất yêu cầu sau khi thử toàn bộ tài khoản trong pool.'
      }
    });
  }

  async forwardChatCompletion(reqBody, clientRes, user = null, req = null) {
    return this.handleChatCompletion(reqBody, clientRes, user, req);
  }
}
