import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneToolResult, buildOpenAIPayload, formatAnthropicResponse } from '../src/services/claudeTranslator.js';
import { AUTONOMOUS_AGENT_PROTOCOL } from '../src/services/claudeUtils.js';
import { pipeAnthropicStream } from '../src/services/claudeStreamer.js';
import { createSetupRouter } from '../src/routes/setupRoutes.js';
import express from 'express';

class MockStreamResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.ended = false;
    this.headersSent = false;
  }
  status(code) { this.statusCode = code; return this; }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; this.headersSent = true; return this; }
  write(chunk) { this.headersSent = true; this.chunks.push(chunk); return true; }
  flush() {}
  end() { this.ended = true; return this; }
}

test('Agent Protocol includes precise Edit string matching and ReAct verification rules', () => {
  assert.ok(AUTONOMOUS_AGENT_PROTOCOL.includes('PRECISE STRING MATCHING FOR EDIT'));
  assert.ok(AUTONOMOUS_AGENT_PROTOCOL.includes('AUTONOMOUS REACT WORKFLOW'));
  assert.ok(AUTONOMOUS_AGENT_PROTOCOL.includes('SELF-HEALING AND RESILIENCE'));
  assert.ok(AUTONOMOUS_AGENT_PROTOCOL.includes('DIRECT ACTION OVER EXPLANATION'));
});

test('pruneToolResult prunes older large outputs while preserving recent and error context', () => {
  // 1. Short text should be unchanged
  assert.equal(pruneToolResult('short text', false, false), 'short text');

  // 2. Older turn with 100 lines should be pruned
  const oldLong = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
  const prunedOld = pruneToolResult(oldLong, false, false);
  assert.ok(prunedOld.includes('Truncated'));
  assert.ok(prunedOld.includes('line 1'));
  assert.ok(prunedOld.includes('line 100'));
  assert.ok(!prunedOld.includes('line 50')); // middle line omitted

  // 3. Recent turn with normal length (< 15000 chars) should NOT be pruned
  const recentMedium = Array.from({ length: 60 }, (_, i) => `recent line ${i + 1}`).join('\n');
  const keptRecent = pruneToolResult(recentMedium, true, false);
  assert.equal(keptRecent, recentMedium);

  // 4. Error result should preserve error details up to 8000 chars
  const errorMsg = 'Critical error: ' + 'x'.repeat(3000);
  const keptError = pruneToolResult(errorMsg, false, true);
  assert.equal(keptError, errorMsg);
});

test('buildOpenAIPayload injects self-healing instructions on tool edit mismatch and command failure', () => {
  const reqBody = {
    model: 'claude-3-5-sonnet-20241022',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_edit_1',
            is_error: true,
            content: 'File edit failed: String to replace not found in src/app.js'
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_bash_2',
            is_error: true,
            content: 'Command failed with exit code 1: npm test failed'
          }
        ]
      }
    ]
  };

  const payload = buildOpenAIPayload(reqBody, 'claude-3-5-sonnet-20241022');
  const toolMsgs = payload.messages.filter(m => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);

  // Check Edit Mismatch recovery instruction
  assert.ok(toolMsgs[0].content.includes('[TOOL ERROR - EDIT STRING MISMATCH]'));
  assert.ok(toolMsgs[0].content.includes('Tuyệt đối KHÔNG đoán nội dung file'));
  assert.ok(toolMsgs[0].content.includes('Sao chép chính xác 100%'));

  // Check Bash Command failure recovery instruction
  assert.ok(toolMsgs[1].content.includes('[TOOL ERROR - COMMAND EXECUTION FAILED]'));
  assert.ok(toolMsgs[1].content.includes('Phân tích kỹ thông báo lỗi bên dưới'));
});

test('pipeAnthropicStream streams thinking events when reasoning_content is present', async () => {
  const sseChunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"Let me analyze the problem step by step."}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":" First, we check the imports."}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"I will now inspect the files."}}]}\n\n',
    'data: [DONE]\n\n'
  ];

  const upstreamRes = {
    body: (async function* () {
      for (const chunk of sseChunks) {
        yield new TextEncoder().encode(chunk);
      }
    })()
  };

  const clientRes = new MockStreamResponse();
  const tokens = await pipeAnthropicStream(upstreamRes, clientRes, 'claude-3-5-sonnet-20241022', 'msg_test_reasoning');

  assert.ok(tokens > 0);
  assert.equal(clientRes.ended, true);

  const fullOutput = clientRes.chunks.join('');
  // Thinking block started and delta emitted
  assert.ok(fullOutput.includes('event: content_block_start'));
  assert.ok(fullOutput.includes('"type":"thinking"'));
  assert.ok(fullOutput.includes('"type":"thinking_delta"'));
  assert.ok(fullOutput.includes('Let me analyze the problem step by step.'));
  assert.ok(fullOutput.includes('First, we check the imports.'));

  // Signature delta emitted when thinking closes
  assert.ok(fullOutput.includes('"type":"signature_delta"'));

  // Clean transition to text block
  assert.ok(fullOutput.includes('"type":"text"'));
  assert.ok(fullOutput.includes('"type":"text_delta"'));
  assert.ok(fullOutput.includes('I will now inspect the files.'));
  assert.ok(fullOutput.includes('event: message_stop'));
});

test('formatAnthropicResponse includes thinking content block when reasoning is present', () => {
  const mockData = {
    choices: [
      {
        message: {
          role: 'assistant',
          reasoning_content: 'Architectural planning for authentication module',
          content: 'Here is the plan.'
        },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 25 }
  };

  const formatted = formatAnthropicResponse(mockData, 'claude-3-5-sonnet-20241022', 'msg_fmt_reasoning');
  assert.equal(formatted.type, 'message');
  assert.equal(formatted.content.length, 2);
  assert.equal(formatted.content[0].type, 'thinking');
  assert.equal(formatted.content[0].thinking, 'Architectural planning for authentication module');
  assert.ok(formatted.content[0].signature);
  assert.equal(formatted.content[1].type, 'text');
  assert.equal(formatted.content[1].text, 'Here is the plan.');
});

test('Setup routes configure auto-approved read permissions in claude.sh and claude.ps1', async () => {
  const app = express();
  app.use('/', createSetupRouter());
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const bashRes = await fetch(`${baseUrl}/claude.sh`);
    const bashText = await bashRes.text();
    assert.ok(bashText.includes('"allow": ["View", "Read", "Glob", "Grep", "LS"]'));

    const psRes = await fetch(`${baseUrl}/claude.ps1`);
    const psText = await psRes.text();
    assert.ok(psText.includes('"allow": ["View", "Read", "Glob", "Grep", "LS"]'));
  } finally {
    server.close();
  }
});
