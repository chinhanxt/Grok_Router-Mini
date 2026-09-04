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
