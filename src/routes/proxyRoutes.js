import { Router } from 'express';

export function createProxyRouter(proxyService, authMiddleware) {
  const router = Router();

  const auth = (req, res, next) => {
    if (authMiddleware) {
      const fn = authMiddleware.requireAuth || authMiddleware.handle || (typeof authMiddleware === 'function' ? authMiddleware : null);
      if (fn) return fn(req, res, next);
    }
    next();
  };

  // OpenAI Chat Completions
  router.post('/v1/chat/completions', auth, (req, res) => {
    if (typeof proxyService.chatCompletions === 'function') {
      return proxyService.chatCompletions(req, res);
    }
    return proxyService.handleChatCompletion(req.body, res, req.user || null, req);
  });

  // Models list
  router.get('/v1/models', auth, (req, res) => {
    if (typeof proxyService.listModels === 'function') {
      return proxyService.listModels(req, res);
    }
    return res.json({
      object: 'list',
      data: [
        { id: 'grok-4.6', object: 'model', created: 1786947792, owned_by: 'xai' },
        { id: 'grok-beta', object: 'model', created: 1786947792, owned_by: 'xai' },
        { id: 'gpt-4o', object: 'model', created: 1786947792, owned_by: 'xai' },
        { id: 'claude-3-5-sonnet', object: 'model', created: 1786947792, owned_by: 'xai' },
        { id: 'claude-3-5-sonnet-20241022', object: 'model', created: 1786947792, owned_by: 'xai' },
        { id: 'claude-3-7-sonnet-20250219', object: 'model', created: 1786947792, owned_by: 'xai' },
        { id: 'claude-3-opus-20240229', object: 'model', created: 1786947792, owned_by: 'xai' }
      ]
    });
  });

  // Anthropic Messages Gateway (mount /v1/messages and /messages for Claude Code CLI)
  router.post('/v1/messages', auth, (req, res) => {
    if (typeof proxyService.anthropicMessages === 'function') {
      return proxyService.anthropicMessages(req, res);
    }
    return proxyService.handleAnthropicMessages(req.body, res, req.user || null, req);
  });

  router.post('/messages', auth, (req, res) => {
    if (typeof proxyService.anthropicMessages === 'function') {
      return proxyService.anthropicMessages(req, res);
    }
    return proxyService.handleAnthropicMessages(req.body, res, req.user || null, req);
  });

  return router;
}
