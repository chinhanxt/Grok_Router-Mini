import crypto from 'node:crypto';
import {
  getClaudeModelName,
  buildClaudeSystemPrompt,
  sanitizeClaudeText,
  AUTONOMOUS_AGENT_PROTOCOL
} from './claudeUtils.js';

export function buildOpenAIPayload(reqBody, reqModel) {
  const messages = [];

  let systemText = '';
  if (reqBody.system) {
    systemText = typeof reqBody.system === 'string'
      ? reqBody.system
      : Array.isArray(reqBody.system)
        ? reqBody.system.map(s => s.text || '').join('\n')
        : String(reqBody.system);
  }

  if (Array.isArray(reqBody.tools) && reqBody.tools.length > 0) {
    systemText = (systemText ? systemText + AUTONOMOUS_AGENT_PROTOCOL : AUTONOMOUS_AGENT_PROTOCOL.trim());
  }

  const claudeModelName = getClaudeModelName(reqModel);
  const claudeIdentity = buildClaudeSystemPrompt(claudeModelName);
  systemText = systemText ? `${claudeIdentity}\n\n${systemText}` : claudeIdentity;

  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  if (Array.isArray(reqBody.messages)) {
    for (const msg of reqBody.messages) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        let textContent = '';
        const toolCalls = [];
        const contentParts = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textContent += block.text || '';
            contentParts.push({ type: 'text', text: block.text || '' });
          } else if (block.type === 'image') {
            const mediaType = block.source?.media_type || 'image/png';
            const base64Data = block.source?.data || '';
            if (base64Data) {
              contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${mediaType};base64,${base64Data}` }
              });
            }
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {})
              }
            });
          } else if (block.type === 'tool_result') {
            let resultText = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map(c => c.text || JSON.stringify(c)).join('\n')
                : JSON.stringify(block.content || '');

            if (block.is_error) {
              resultText = `[ERROR]: ${resultText}`;
            }

            messages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: resultText
            });
          }
        }

        if (contentParts.some(p => p.type === 'image_url')) {
          const formattedMsg = { role: msg.role, content: contentParts };
          if (toolCalls.length > 0) formattedMsg.tool_calls = toolCalls;
          messages.push(formattedMsg);
        } else if (textContent || toolCalls.length > 0) {
          const formattedMsg = { role: msg.role, content: textContent };
          if (toolCalls.length > 0) formattedMsg.tool_calls = toolCalls;
          messages.push(formattedMsg);
        }
      }
    }
  }

  let openAITools = undefined;
  if (Array.isArray(reqBody.tools) && reqBody.tools.length > 0) {
    openAITools = reqBody.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || t.parameters || { type: 'object', properties: {} }
      }
    }));
  }

  let openAIToolChoice = undefined;
  if (reqBody.tool_choice) {
    if (typeof reqBody.tool_choice === 'string') {
      openAIToolChoice = reqBody.tool_choice;
    } else if (reqBody.tool_choice.type === 'auto') {
      openAIToolChoice = 'auto';
    } else if (reqBody.tool_choice.type === 'any') {
      openAIToolChoice = 'required';
    } else if (reqBody.tool_choice.type === 'tool' && reqBody.tool_choice.name) {
      openAIToolChoice = { type: 'function', function: { name: reqBody.tool_choice.name } };
    }
  }

  return {
    model: 'grok-4.6',
    messages,
    stream: Boolean(reqBody.stream),
    temperature: reqBody.temperature,
    max_tokens: reqBody.max_tokens,
    ...(openAITools ? { tools: openAITools } : {}),
    ...(openAIToolChoice ? { tool_choice: openAIToolChoice } : {})
  };
}

export function formatAnthropicResponse(data, reqModel, msgId) {
  const choice = data.choices?.[0];
  const msg = choice?.message || {};
  const contentBlocks = [];

  if (msg.content) {
    contentBlocks.push({ type: 'text', text: sanitizeClaudeText(msg.content) });
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      let parsedInput = {};
      try {
        parsedInput = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        parsedInput = { raw: tc.function?.arguments || '' };
      }
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id || `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        name: tc.function?.name || 'unknown_tool',
        input: parsedInput
      });
    }
  }

  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: 'text', text: '' });
  }

  const stopReason = (msg.tool_calls && msg.tool_calls.length > 0)
    ? 'tool_use'
    : (choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn');

  return {
    id: `msg_${msgId}`,
    type: 'message',
    role: 'assistant',
    model: reqModel,
    content: contentBlocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0
    }
  };
}
