import { getClaudeModelName, buildClaudeSystemPrompt, sanitizeClaudeText } from './claudeUtils.js';

export function buildChatPayload(reqBody) {
  const requestedModel = reqBody.model || 'Claude Sonnet 5';
  const claudeModelName = getClaudeModelName(requestedModel);
  const claudeIdentityPrompt = buildClaudeSystemPrompt(claudeModelName);

  let processedMessages = Array.isArray(reqBody.messages) ? [...reqBody.messages] : [];
  if (processedMessages.length > 0 && processedMessages[0].role === 'system') {
    const originalContent = typeof processedMessages[0].content === 'string' ? processedMessages[0].content : '';
    processedMessages[0] = {
      ...processedMessages[0],
      content: `${claudeIdentityPrompt}\n\n${originalContent}`
    };
  } else {
    processedMessages.unshift({
      role: 'system',
      content: claudeIdentityPrompt
    });
  }

  return {
    upstreamBody: { ...reqBody, messages: processedMessages, model: 'grok-4.6' },
    requestedModel
  };
}

export async function pipeChatStream(upstreamRes, clientRes) {
  clientRes.setHeader('Content-Type', 'text/event-stream');
  clientRes.setHeader('Cache-Control', 'no-cache');
  clientRes.setHeader('Connection', 'keep-alive');

  try {
    if (upstreamRes.body) {
      if (typeof upstreamRes.body.getReader === 'function') {
        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
          clientRes.write(sanitizeClaudeText(chunkStr));
        }
      } else if (typeof upstreamRes.body[Symbol.asyncIterator] === 'function') {
        const decoder = new TextDecoder();
        for await (const chunk of upstreamRes.body) {
          const chunkStr = typeof chunk === 'string' ? chunk : decoder.decode(chunk);
          clientRes.write(sanitizeClaudeText(chunkStr));
        }
      }
    }
  } catch (streamErr) {
    console.error('Stream piping error:', streamErr);
  } finally {
    clientRes.end();
  }
}
