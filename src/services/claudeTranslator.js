import crypto from 'node:crypto';
import {
  getClaudeModelName,
  buildClaudeSystemPrompt,
  sanitizeClaudeText,
  AUTONOMOUS_AGENT_PROTOCOL
} from './claudeUtils.js';

export function resolveReasoningEffort(reqModel, explicitEffort = null) {
  if (explicitEffort) return explicitEffort;
  const m = String(reqModel || '').toLowerCase();
  if (m.includes('haiku') || m.includes('mini') || m.includes('fast') || m.includes('flash')) {
    return 'low';
  }
  if (m.includes('opus') || m.includes('fable') || m.includes('3-7') || m.includes('3.7')) {
    return 'high';
  }
  return 'medium';
}

export function pruneToolResult(text, isRecent = false, isError = false) {
  if (!text || typeof text !== 'string') return text || '';

  // If error, preserve full error unless massively bloated
  if (isError) {
    if (text.length <= 8000) return text;
    const lines = text.split('\n');
    if (lines.length > 50) {
      const head = lines.slice(0, 25).join('\n');
      const tail = lines.slice(-25).join('\n');
      return `${head}\n\n[... Truncated ${lines.length - 50} lines of error details by Grok Router ...]\n\n${tail}`;
    }
    return text.slice(0, 4000) + '\n[... Truncated error details ...]\n' + text.slice(-4000);
  }

  // If recent (last 2-3 turns), keep full content unless massive
  if (isRecent) {
    if (text.length <= 15000) return text;
    const lines = text.split('\n');
    if (lines.length > 100) {
      const head = lines.slice(0, 50).join('\n');
      const tail = lines.slice(-50).join('\n');
      return `${head}\n\n[... Truncated ${lines.length - 100} lines of large tool output by Grok Router ...]\n\n${tail}`;
    }
    return text.slice(0, 7500) + '\n[... Truncated large tool output ...]\n' + text.slice(-7500);
  }

  // For older turns, prune aggressively by line count (> 30 lines) or character length (> 1500 chars)
  const lines = text.split('\n');
  if (lines.length > 30) {
    const head = lines.slice(0, 12).join('\n');
    const tail = lines.slice(-12).join('\n');
    return `${head}\n\n[... Truncated ${lines.length - 24} lines of previous tool output by Grok Router to preserve context ...]\n\n${tail}`;
  }
  if (text.length > 1500) {
    return text.slice(0, 700) + '\n[... Truncated previous output by Grok Router ...]\n' + text.slice(-700);
  }

  return text;
}

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
    const totalMsgs = reqBody.messages.length;
    for (let msgIdx = 0; msgIdx < totalMsgs; msgIdx++) {
      const msg = reqBody.messages[msgIdx];
      const isRecent = msgIdx >= totalMsgs - 4;

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

            const isError = Boolean(block.is_error);

            // Autonomous self-healing recovery hints
            if (isError || resultText.includes('String to replace not found') || resultText.includes('File edit failed')) {
              if (resultText.includes('String to replace not found') || resultText.includes('File edit failed') || resultText.includes('does not match')) {
                resultText = `[TOOL ERROR - EDIT STRING MISMATCH]:
Chuỗi old_string không khớp chính xác với nội dung file thực tế trên đĩa.
[AUTONOMOUS RECOVERY INSTRUCTION]:
1. Tuyệt đối KHÔNG đoán nội dung file. Hãy gọi ngay công cụ View (hoặc file read) để đọc lại chính xác các dòng code cần sửa.
2. Sao chép chính xác 100% từng ký tự, dấu cách thụt lề (indentation) và ngắt dòng từ kết quả View vào old_string.
3. Sau đó thử lại công cụ Edit với old_string chuẩn xác.
Chi tiết lỗi gốc: ${resultText}`;
              } else if (resultText.toLowerCase().includes('command failed') || resultText.includes('exit code')) {
                resultText = `[TOOL ERROR - COMMAND EXECUTION FAILED]:
Lệnh Bash vừa thực thi bị lỗi hoặc kết thúc với mã lỗi khác 0.
[AUTONOMOUS RECOVERY INSTRUCTION]:
Phân tích kỹ thông báo lỗi bên dưới, xác định nguyên nhân (sai đường dẫn, thiếu module, cú pháp...) và tự động sửa chữa trước khi tiếp tục.
Chi tiết lỗi: ${resultText}`;
              } else {
                resultText = `[TOOL ERROR]: ${resultText}\n[AUTONOMOUS RECOVERY INSTRUCTION]: Công cụ gặp lỗi. Hãy kiểm tra nguyên nhân và thử cách tiếp cận thay thế phù hợp.`;
              }
            }

            // Context pruning for older turns
            resultText = pruneToolResult(resultText, isRecent, isError);

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

  const reasoningEffort = resolveReasoningEffort(reqModel, reqBody.reasoning_effort);

  return {
    model: 'grok-4.6',
    messages,
    stream: Boolean(reqBody.stream),
    temperature: reqBody.temperature,
    max_tokens: reqBody.max_tokens,
    reasoning_effort: reasoningEffort,
    ...(openAITools ? { tools: openAITools } : {}),
    ...(openAIToolChoice ? { tool_choice: openAIToolChoice } : {})
  };
}

export function formatAnthropicResponse(data, reqModel, msgId) {
  const choice = data.choices?.[0];
  const msg = choice?.message || {};
  const contentBlocks = [];

  const reasoning = msg.reasoning_content || msg.thought || msg.reasoning;
  if (reasoning) {
    contentBlocks.push({
      type: 'thinking',
      thinking: reasoning,
      signature: 'sig_' + crypto.randomUUID().replace(/-/g, '').slice(0, 32)
    });
  }

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
