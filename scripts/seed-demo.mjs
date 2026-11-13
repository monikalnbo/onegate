#!/usr/bin/env node
// 演示数据：一条指向本地 mock 上游的通道 + 一个演示密钥 + 一份示例价格表 + 一条公告。
// 全部是明显的假数据（sk-mock-upstream / sk-relay-demo…），不会连接真实服务。
//   node scripts/seed-demo.mjs
// 幂等：同名通道已存在时跳过，不会重复写入。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Store, newId } from '../lib/store.mjs';
import { sha256, token } from '../lib/auth.mjs';

const dataDir = resolve(process.env.DATA_DIR || './data');
const mockPort = Number(process.env.MOCK_PORT || 18901);
await mkdir(dataDir, { recursive: true, mode: 0o700 });

let secretBytes;
try { secretBytes = await readFile(resolve(dataDir, 'relay.secret')); }
catch {
  secretBytes = randomBytes(32);
  await writeFile(resolve(dataDir, 'relay.secret'), secretBytes, { mode: 0o600 });
  console.log('生成 relay.secret（加密通道密钥用）');
}

const store = await new Store(resolve(dataDir, 'relay.json'), createHash('sha256').update(secretBytes).digest()).load();
store.data.portal ??= {};
store.data.portal.settings ??= {};
store.data.portal.settings.registration_enabled ??= true;
store.data.calls ??= [];
store.data.source_groups ??= [];

if (!store.data.channels.some(channel => channel.name === 'Mock 上游（演示）')) {
  store.data.channels.push({
    id: newId(),
    name: 'Mock 上游（演示）',
    base_url: `http://127.0.0.1:${mockPort}/v1`,
    api_key: 'sk-mock-upstream',
    models: ['mock-gpt'],
    model_aliases: {},
    weight: 1,
    enabled: true,
    path_prefix: '',
    headers: {},
    rate_multiplier: 1,
    max_concurrency: 4,
    queue_ms: 0,
    max_queue: 0,
    timeout_ms: 30000,
    retries: 0
  });
  console.log('创建演示通道：Mock 上游（演示）→ http://127.0.0.1:' + mockPort + '/v1');
} else {
  console.log('跳过演示通道：同名通道已存在');
}

const demo = store.data.keys.find(item => item.name === '演示密钥');
let demoKey = null;
if (!demo) {
  demoKey = token();
  store.data.keys.push({
    id: newId(), name: '演示密钥', key_hash: sha256(demoKey), suffix: demoKey.slice(-4),
    enabled: true, rpm: 60, group_id: null, quota_usd: 1, used_usd: 0,
    note: '按 scripts/seed-demo.mjs 生成，仅用于本地演示', created_at: new Date().toISOString(), last_used_at: null
  });
  console.log('创建演示密钥（额度 1，RPM 60）');
} else {
  console.log('跳过演示密钥：已存在（明文无法找回，如忘记请删除该条后重跑，或在控制台另建）');
}

const pricingFile = resolve(dataDir, 'pricing.json');
let table = {};
try { table = JSON.parse(await readFile(pricingFile, 'utf8')); } catch { /* 首次运行 */ }
if (!table['mock-gpt']) {
  table['mock-gpt'] = { in: 0.5, out: 1.5, cache: 0.1 };
  await writeFile(pricingFile, JSON.stringify(table, null, 2), { mode: 0o600 });
  console.log('写入示例价格：mock-gpt（每 1M tokens，in 0.5 / out 1.5 / cache 0.1）');
}

if (!store.data.announcements.some(item => item.title === '演示公告')) {
  store.data.announcements.push({
    id: newId(), title: '演示公告', body: '这是演示公告，可随时在控制台修改或删除。',
    level: 'info', pinned: false, published: true, created_at: new Date().toISOString()
  });
  console.log('创建演示公告');
}

await store.save();
console.log('\n演示数据已写入：' + dataDir);
console.log('演示通道指向本地 mock，请先在另一个终端运行：node test/mock-upstream.mjs');
if (demoKey) console.log('演示密钥（只显示这一次，请自行保存）：' + demoKey);
console.log('\n冒烟测试会影响这个数据目录，建议演示用独立 DATA_DIR。');
