import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { AppConfig } from '../src/config.js';
import { JsonStorage } from '../src/storage/JsonStorage.js';
import { AccountPool } from '../src/services/AccountPool.js';
import { UserService } from '../src/services/UserService.js';
import { ProxyService } from '../src/services/ProxyService.js';
import { createAuthMiddleware } from '../src/middlewares/AuthMiddleware.js';
import { buildOpenAIPayload, formatAnthropicResponse } from '../src/services/claudeTranslator.js';
import { pipeAnthropicStream } from '../src/services/claudeStreamer.js';
import path from 'node:path';
import os from 'node:os';

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

async function setupTestApp(customApiKey = null) {
  const tmpDir = path.join(os.tmpdir(), 'grok-5prompts-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const config = new AppConfig({ DATA_DIR: tmpDir, API_KEY: customApiKey || 'sk-keychinhan-xtchinhan-YOUR_KEY' });
  const storage = new JsonStorage();
  const pool = new AccountPool(storage, config);
  await pool.init();
  await pool.addAccount({ email: 'node1@test.com', ssoToken: 'valid-token-node1' });

  const userService = new UserService(storage, config);
  await userService.init();

  const authMiddleware = createAuthMiddleware(userService, config);
  const proxyService = new ProxyService(pool, config);

  const app = createApp({ config, pool, userService, proxyService, authMiddleware, storage });
  return { app, config, pool, proxyService, userService, authMiddleware };
}

// PROMPT 1: Full-scale Project Creation (Scaffolding multi-file project without hallucinated completion)
test('Prompt 1 - Full-scale Project Scaffolding: Injects strict non-hallucination and project directives', async () => {
  const userRequest = {
    model: 'claude-3-5-sonnet-20241022',
    messages: [
      {
        role: 'user',
        content: 'Hãy tạo cho tôi 1 dự án fullstack Todo App với Express backend, SQLite, và frontend HTML/CSS/JS. Bắt buộc tạo đầy đủ các file package.json, server.js, public/index.html, README.md.'
      }
    ],
    tools: [
      { name: 'Bash', description: 'Run shell commands', input_schema: { type: 'object', properties: { command: { type: 'string' } } } },
      { name: 'Write', description: 'Write file content to disk', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } } } }
    ]
  };

  const payload = buildOpenAIPayload(userRequest, 'claude-3-5-sonnet-20241022');
  const sysMsg = payload.messages.find(m => m.role === 'system');

  // Must enforce zero hallucinated completion and multi-file directive
  assert.ok(sysMsg.content.includes('STRICT BAN ON HALLUCINATED COMPLETION'));
  assert.ok(sysMsg.content.includes('PROJECT SCAFFOLDING & MULTI-FILE EXECUTION DIRECTIVE'));
  assert.ok(sysMsg.content.includes('STEP 1 - DIRECTORY & INITIALIZATION'));
  assert.ok(sysMsg.content.includes('STEP 2 - WRITE EVERY SINGLE CODE FILE'));
  assert.ok(sysMsg.content.includes('STEP 3 - INSTALL & VERIFY'));

  // Test SSE streaming tool use response when creating files
  const sseChunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_scaffold_1","function":{"name":"Write","arguments":"{\\"file_path\\":\\"package.json\\",\\"content\\":\\\"{\\\\\\\"name\\\\\\\":\\\\\\\"todo-app\\\\\\\"}\\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n'
  ];

  const upstreamRes = {
    body: (async function* () {
      for (const chunk of sseChunks) yield new TextEncoder().encode(chunk);
    })()
  };

  const clientRes = new MockStreamResponse();
  await pipeAnthropicStream(upstreamRes, clientRes, 'claude-3-5-sonnet-20241022', 'msg_p1');
  const streamOutput = clientRes.chunks.join('');

  assert.ok(streamOutput.includes('"type":"tool_use"'));
  assert.ok(streamOutput.includes('"name":"Write"'));
  assert.ok(streamOutput.includes('package.json'));
  assert.ok(streamOutput.includes('"stop_reason":"tool_use"'));
});

// PROMPT 2: Self-Healing on String Mismatch (Edit tool recovery)
test('Prompt 2 - Edit String Mismatch Recovery: Injects autonomous self-healing instructions', async () => {
  const reqBody = {
    model: 'claude-3-5-sonnet-20241022',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_edit_failed',
            is_error: true,
            content: 'File edit failed: String to replace not found in src/server.js'
          }
        ]
      },
      {
        role: 'user',
        content: 'Sửa lại file server.js cho tôi, lúc nãy bị lỗi không tìm thấy chuỗi.'
      }
    ],
    tools: [{ name: 'Edit', description: 'Edit file content', input_schema: {} }]
  };

  const payload = buildOpenAIPayload(reqBody, 'claude-3-5-sonnet-20241022');
  const toolMsg = payload.messages.find(m => m.role === 'tool');

  assert.ok(toolMsg.content.includes('[TOOL ERROR - EDIT STRING MISMATCH]'));
  assert.ok(toolMsg.content.includes('Tuyệt đối KHÔNG đoán nội dung file'));
  assert.ok(toolMsg.content.includes('Sao chép chính xác 100%'));
  assert.ok(toolMsg.content.includes('thử lại công cụ Edit'));
});

// PROMPT 3: Command Execution Failure Recovery (Bash tool recovery)
test('Prompt 3 - Bash Command Failure Recovery: Injects self-healing directive for build/test failure', async () => {
  const reqBody = {
    model: 'claude-3-5-sonnet-20241022',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_bash_failed',
            is_error: true,
            content: 'Command failed with exit code 1: Error: Cannot find module express'
          }
        ]
      },
      {
        role: 'user',
        content: 'Chạy lại test cho tôi, sao lại lỗi vậy?'
      }
    ],
    tools: [{ name: 'Bash', description: 'Bash commands', input_schema: {} }]
  };

  const payload = buildOpenAIPayload(reqBody, 'claude-3-5-sonnet-20241022');
  const toolMsg = payload.messages.find(m => m.role === 'tool');

  assert.ok(toolMsg.content.includes('[TOOL ERROR - COMMAND EXECUTION FAILED]'));
  assert.ok(toolMsg.content.includes('Phân tích kỹ thông báo lỗi bên dưới'));
  assert.ok(toolMsg.content.includes('tự động sửa chữa trước khi tiếp tục'));
});

// PROMPT 4: Deep Reasoning + Tool Calling (Reasoning Effort & Thinking Block SSE Stream)
test('Prompt 4 - Deep Architecture Reasoning with Thinking Blocks: Streams reasoning then tools', async () => {
  const reqBody = {
    model: 'claude-opus-5',
    messages: [
      {
        role: 'user',
        content: 'Phân tích kiến trúc bảo mật OAuth2 PKCE cho hệ thống phân tán, sau đó viết module authService.js và config.js.'
      }
    ],
    tools: [
      { name: 'Write', description: 'Write file to disk', input_schema: {} }
    ]
  };

  const payload = buildOpenAIPayload(reqBody, 'claude-opus-5');
  assert.equal(payload.reasoning_effort, 'high');

  // Simulate streaming with thinking and tool calls
  const sseChunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"We need to design PKCE code_verifier and code_challenge hashing with SHA-256."}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Tôi bắt đầu tạo file authService.js."}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_oauth_1","function":{"name":"Write","arguments":"{\\"file_path\\":\\"authService.js\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n'
  ];

  const upstreamRes = {
    body: (async function* () {
      for (const chunk of sseChunks) yield new TextEncoder().encode(chunk);
    })()
  };

  const clientRes = new MockStreamResponse();
  await pipeAnthropicStream(upstreamRes, clientRes, 'claude-opus-5', 'msg_p4');
  const output = clientRes.chunks.join('');

  // Assert thinking block
  assert.ok(output.includes('"type":"thinking"'));
  assert.ok(output.includes('code_verifier and code_challenge'));
  assert.ok(output.includes('"type":"signature_delta"'));

  // Assert transition to text and tool use
  assert.ok(output.includes('"type":"text_delta"'));
  assert.ok(output.includes('"type":"tool_use"'));
  assert.ok(output.includes('"name":"Write"'));
  assert.ok(output.includes('authService.js'));
  assert.ok(output.includes('"stop_reason":"tool_use"'));
});

// PROMPT 5: Permanent Master API Key Authentication & Zero 401 Rejection
test('Prompt 5 - Permanent Master Key Auth: Passes /v1/messages and /messages without expiration or 401', async () => {
  const { app, pool } = await setupTestApp('sk-permanent-custom-key');
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    // Upstream mock
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl-master-key-ok',
        choices: [{ message: { role: 'assistant', content: 'Success with permanent master key!' } }],
        usage: { total_tokens: 35 }
      })
    };
  };

  try {
    // 1. Request with configured permanent API key
    const res1 = await originalFetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-permanent-custom-key'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Ping' }]
      })
    });

    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.type, 'message');
    assert.equal(data1.content[0].text, 'Success with permanent master key!');

    // 2. Request with default master key fallback ('sk-keychinhan-xtchinhan-YOUR_KEY')
    const res2 = await originalFetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-keychinhan-xtchinhan-YOUR_KEY'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Ping' }]
      })
    });

    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.type, 'message');

    // 3. Request without any token -> rejected with 401
    const resNoAuth = await originalFetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Ping' }] })
    });
    assert.equal(resNoAuth.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
  }
});
