#!/usr/bin/env node
// 本地 Mock 上游：模拟一个 OpenAI 兼容服务，只用于离线自测。
// 不连接任何真实厂商，不产生费用。
//   node test/mock-upstream.mjs            # 默认监听 127.0.0.1:18901
//   MOCK_PORT=18901 MOCK_HOST=127.0.0.1 node test/mock-upstream.mjs
import http from 'node:http';

const HOST = process.env.MOCK_HOST || '127.0.0.1';
const PORT = Number(process.env.MOCK_PORT || 18901);
const AUTH = process.env.MOCK_AUTH || 'sk-mock-upstream';

const usage = (prompt, completion) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('invalid json'), { status: 400 })); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    return json(200, { object: 'list', data: [{ id: 'mock-gpt', object: 'model', created: 0, owned_by: 'mock' }] });
  }

  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (req.method === 'POST' && !bearer.startsWith('sk-')) {
    return json(401, { error: { message: 'missing or invalid bearer token', type: 'authentication_error', code: 'invalid_api_key' } });
  }
  if (req.method === 'POST' && AUTH && bearer !== AUTH) {
    return json(401, { error: { message: 'unknown api key (mock rejects everything except the demo value)', type: 'authentication_error', code: 'invalid_api_key' } });
  }

  if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
    const body = await readBody(req).catch(error => { json(error.status || 400, { error: { message: error.message } }); return null; });
    if (!body) return;
    const prompt = Array.isArray(body.messages) ? body.messages.length * 8 + 4 : 12;
    const answer = `mock answer for ${body.model || 'unknown-model'}`;
    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const frames = [
        { id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
        { id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] },
        { id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: usage(prompt, 6) }
      ];
      for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    return json(200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: usage(prompt, 6)
    });
  }

  if (req.method === 'POST' && url.pathname.endsWith('/embeddings')) {
    const body = await readBody(req).catch(() => ({}));
    return json(200, {
      object: 'list',
      model: body.model,
      data: [{ object: 'embedding', index: 0, embedding: [0.01, 0.02, 0.03] }],
      usage: usage(5, 0)
    });
  }

  if (req.method === 'POST' && url.pathname.endsWith('/responses')) {
    const body = await readBody(req).catch(() => ({}));
    return json(200, {
      id: 'resp-mock',
      object: 'response',
      model: body.model,
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'mock response' }] }],
      usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 }
    });
  }

  return json(404, { error: { message: `mock upstream has no route for ${req.method} ${url.pathname}`, type: 'invalid_request_error', code: 'not_found' } });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`mock upstream listening on http://${HOST}:${PORT}/v1 (demo key: ${AUTH})\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
