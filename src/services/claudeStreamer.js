import crypto from 'node:crypto';
import { sanitizeClaudeText, sanitizeToClaudeError } from './claudeUtils.js';

export async function pipeAnthropicStream(upstreamRes, clientRes, reqModel, msgId) {
  clientRes.setHeader('Content-Type', 'text/event-stream');
  clientRes.setHeader('Cache-Control', 'no-cache');
  clientRes.setHeader('Connection', 'keep-alive');

  clientRes.write(`event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: `msg_${msgId}`,
      type: 'message',
      role: 'assistant',
      model: reqModel,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 1 }
    }
  })}\n\n`);

  let outputTokens = 0;
  let buffer = '';
  let textBlockStarted = false;
  let currentBlockIndex = 0;
  const openToolBlocks = new Map();

  const processChunk = (chunkStr) => {
    buffer += chunkStr;
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(dataStr);
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          if (!textBlockStarted) {
            textBlockStarted = true;
            clientRes.write(`event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: currentBlockIndex,
              content_block: { type: 'text', text: '' }
            })}\n\n`);
          }
          outputTokens += 1;
          clientRes.write(`event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: currentBlockIndex,
            delta: { type: 'text_delta', text: sanitizeClaudeText(delta.content) }
          })}\n\n`);
        }

        if (Array.isArray(delta.tool_calls)) {
          if (textBlockStarted) {
            clientRes.write(`event: content_block_stop\ndata: ${JSON.stringify({
              type: 'content_block_stop',
              index: currentBlockIndex
            })}\n\n`);
            textBlockStarted = false;
            currentBlockIndex += 1;
          }

          for (const tc of delta.tool_calls) {
            const tcIdx = tc.index ?? 0;
            if (!openToolBlocks.has(tcIdx)) {
              const toolBlockIdx = currentBlockIndex++;
              const toolId = tc.id || `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
              const toolName = tc.function?.name || 'tool';
              openToolBlocks.set(tcIdx, { index: toolBlockIdx, id: toolId, name: toolName });

              clientRes.write(`event: content_block_start\ndata: ${JSON.stringify({
                type: 'content_block_start',
                index: toolBlockIdx,
                content_block: {
                  type: 'tool_use',
                  id: toolId,
                  name: toolName
                }
              })}\n\n`);
            }

            const blockInfo = openToolBlocks.get(tcIdx);
            const argsChunk = tc.function?.arguments;
            if (argsChunk) {
              outputTokens += 1;
              clientRes.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: blockInfo.index,
                delta: {
                  type: 'input_json_delta',
                  partial_json: argsChunk
                }
              })}\n\n`);
            }
          }
        }
      } catch {
        // Ignore partial JSON chunks
      }
    }
  };

  try {
    if (upstreamRes.body) {
      if (typeof upstreamRes.body.getReader === 'function') {
        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
          processChunk(chunkStr);
        }
      } else if (typeof upstreamRes.body[Symbol.asyncIterator] === 'function') {
        const decoder = new TextDecoder();
        for await (const chunk of upstreamRes.body) {
          const chunkStr = typeof chunk === 'string' ? chunk : decoder.decode(chunk);
          processChunk(chunkStr);
        }
      }
    }
  } catch (streamErr) {
    console.error('Claude Stream error:', streamErr);
    const sanitizedErr = sanitizeToClaudeError(streamErr.message);
    if (!clientRes.headersSent) {
      clientRes.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: `Lỗi luồng dữ liệu Claude: ${sanitizedErr}`
        }
      });
    } else {
      try {
        clientRes.write(`event: error\ndata: ${JSON.stringify({
          type: 'error',
          error: {
            type: 'api_error',
            message: `Lỗi luồng dữ liệu Claude: ${sanitizedErr}`
          }
        })}\n\n`);
      } catch {}
    }
  } finally {
    if (textBlockStarted) {
      clientRes.write(`event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index: currentBlockIndex
      })}\n\n`);
    }
    for (const [, blockInfo] of openToolBlocks) {
      clientRes.write(`event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index: blockInfo.index
      })}\n\n`);
    }

    const stopReason = openToolBlocks.size > 0 ? 'tool_use' : 'end_turn';

    clientRes.write(`event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: Math.max(1, outputTokens) }
    })}\n\n`);
    clientRes.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    clientRes.end();
  }

  return outputTokens;
}
