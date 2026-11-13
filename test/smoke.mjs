#!/usr/bin/env node
// 离线冒烟测试：启动 mock 上游 + 网关（临时数据目录、非特权端口），
// 走完「管理员登录 → 建通道 → 建密钥 → 发起 /v1 调用 → 调用记录/审计可查」。
// 不需要任何真实上游密钥，不访问外网。
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(resolve(tmpdir(), 'onegate-smoke-'));
// 运行时随机生成，避免仓库里出现任何形似口令的字面量
const adminKey = randomUUID() + randomUUID();
const mockPort = Number(process.env.SMOKE_MOCK_PORT || 18901);
const port = Number(process.env.SMOKE_PORT || 18902);
const base = `http://127.0.0.1:${port}`;
const children = [];

const log = message => process.stdout.write(`${message}\n`);
const start = (name, args, env) => {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stderr.on('data', chunk => process.stderr.write(`[${name}] ${chunk}`));
  return child;
};
const stopAll = async () => {
  for (const child of children) child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 150));
};

async function waitFor(url, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内没有就绪：${url}`);
}

let cookie = '';
async function api(path, { method = 'GET', body, auth } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.getSetCookie?.() || [];
  const session = setCookie.find(item => item.startsWith('relay_session='));
  if (session) cookie = session.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

try {
  start('mock', ['test/mock-upstream.mjs'], { MOCK_PORT: String(mockPort), MOCK_AUTH: 'sk-mock-upstream' });
  start('relay', ['server.mjs'], {
    HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir,
    RELAY_ADMIN_KEY: adminKey, PUBLIC_ORIGIN: base, ADMIN_ORIGIN: base, COOKIE_SECURE: 'false'
  });
  await waitFor(`http://127.0.0.1:${mockPort}/v1/models`, 'mock upstream');
  await waitFor(`${base}/health`, 'relay');

  const bad = await api('/admin/login', { method: 'POST', body: { adminKey: `wrong-${randomUUID()}` } });
  assert.equal(bad.status, 401, '错误管理员密钥必须被拒绝');
  log('PASS 错误管理员密钥被拒绝 (401)');

  const login = await api('/admin/login', { method: 'POST', body: { adminKey } });
  assert.equal(login.status, 200, '管理员登录应成功');
  assert.ok(cookie.startsWith('relay_session='), '登录后应下发会话 Cookie');
  log('PASS 管理员登录成功并拿到会话 Cookie');

  const channel = await api('/admin/api/channels', { method: 'POST', body: {
    name: 'Mock 上游', base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: 'sk-mock-upstream',
    models: ['mock-gpt'], path_prefix: '', rate_multiplier: 1, max_concurrency: 4, queue_ms: 0, timeout_ms: 15000, retries: 0
  } });
  assert.equal(channel.status, 201, `建通道应成功：${JSON.stringify(channel.data)}`);
  assert.notEqual(channel.data.api_key, 'sk-mock-upstream', '通道响应不得回显上游明文密钥');
  assert.match(String(channel.data.api_key || ''), /^(sk-…|$)/, '通道响应里的密钥只能是掩码');
  log(`PASS 创建通道成功，响应中的上游密钥为掩码（${channel.data.api_key || '未返回'}）`);

  const createdKey = await api('/admin/api/keys', { method: 'POST', body: { name: 'smoke key', rpm: 60 } });
  assert.equal(createdKey.status, 201, `建密钥应成功：${JSON.stringify(createdKey.data)}`);
  const secret = createdKey.data.key;
  assert.ok(/^sk-/.test(secret), '应返回一次明文密钥');
  log(`PASS 创建下游密钥成功（明文只在创建时返回一次，形如 ${secret.slice(0, 7)}…${secret.slice(-4)}）`);

  const completion = await api('/v1/chat/completions', { method: 'POST', auth: secret, body: { model: 'mock-gpt', messages: [{ role: 'user', content: 'ping' }] } });
  assert.equal(completion.status, 200, `普通调用应成功：${JSON.stringify(completion.data)}`);
  assert.match(String(completion.data.choices?.[0]?.message?.content), /mock answer for mock-gpt/);
  log('PASS /v1/chat/completions 经 mock 上游返回 200');

  const streamRes = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ model: 'mock-gpt', messages: [{ role: 'user', content: 'stream' }], stream: true })
  });
  assert.equal(streamRes.status, 200, '流式调用应成功');
  const streamText = await streamRes.text();
  assert.match(streamText, /data: \[DONE\]/, '流式响应应包含结束标记');
  log('PASS 流式 /v1/chat/completions 返回 SSE 并以 [DONE] 结束');

  const models = await api('/v1/models', { auth: secret });
  assert.equal(models.status, 200);
  assert.ok(models.data.data.some(item => item.id === 'mock-gpt'), '/v1/models 应包含通道模型');
  log('PASS /v1/models 列出已配置模型');

  const calls = await api('/admin/api/calls?limit=50');
  assert.equal(calls.status, 200);
  const rows = calls.data.items ?? calls.data.calls ?? calls.data.rows ?? [];
  assert.ok(rows.length >= 2, `调用记录应有 >=2 条，实际 ${rows.length}`);
  assert.ok(rows.every(row => !JSON.stringify(row).includes(secret)), '调用记录不得包含明文密钥');
  const chatRow = rows.find(row => row.model === 'mock-gpt' && row.status === 200);
  assert.ok(chatRow, '应能查到成功的调用记录');
  assert.ok(chatRow.channel_name === 'Mock 上游', '调用记录应带通道名');
  log(`PASS 调用记录可查：${rows.length} 条，含状态 200 的 mock-gpt 记录，且未泄露明文密钥`);

  const audit = await api('/admin/api/audit');
  assert.equal(audit.status, 200);
  const auditText = JSON.stringify(audit.data);
  assert.ok(/create source/.test(auditText), '审计应记录建通道动作');
  assert.ok(/create key/.test(auditText), '审计应记录建密钥动作');
  assert.ok(!auditText.includes(secret), '审计不得包含明文密钥');
  log('PASS 审计记录包含 create source / create key，且不含明文密钥');

  const state = await api('/admin/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.keys.length, 1);
  log('PASS /admin/api/state 返回通道与密钥概览');

  log(`\n全部冒烟测试通过。临时数据目录：${dataDir}`);
} catch (error) {
  console.error(`\nFAIL ${error.message}\n${error.stack}`);
  process.exitCode = 1;
} finally {
  await stopAll();
  if (process.env.KEEP_DATA !== '1') await rm(dataDir, { recursive: true, force: true });
}
