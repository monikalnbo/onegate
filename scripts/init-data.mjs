#!/usr/bin/env node
// 初始化数据目录：只创建空的数据结构，不生成任何真实账户或密钥。
//   node scripts/init-data.mjs
// 可用 DATA_DIR 指定目录；已存在的数据文件不会被覆盖。
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const dataDir = resolve(process.env.DATA_DIR || './data');
const files = {
  'relay.json': { channels: [], keys: [], logs: [], stats: { keys: {}, channels: {} }, groups: [], redeem: [], announcements: [], audit: [] },
  'pricing.json': {},
  'metrics.json': { buckets: {} }
};

const exists = async file => { try { await readFile(file); return true; } catch { return false; } };

await mkdir(dataDir, { recursive: true, mode: 0o700 });
await chmod(dataDir, 0o700);
let created = 0;
for (const [name, value] of Object.entries(files)) {
  const file = join(dataDir, name);
  if (await exists(file)) { console.log(`skip  ${file}（已存在，不覆盖）`); continue; }
  await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(file, 0o600);
  created++;
  console.log(`create ${file}`);
}

console.log(`\n数据目录：${dataDir}`);
console.log(`新创建 ${created} 个文件。下一步：`);
console.log('  1. cp .env.example .env 并按注释填写');
console.log('  2. npm ci && npm start');
console.log('  3. 首次启动若未设置 RELAY_ADMIN_KEY，控制台提示的管理员密钥只打印一次，请立即保存。');
console.log('  4. 浏览器打开 http://127.0.0.1:8787/admin/ 登录。');
console.log('\n提示：data/ 内是密钥与账户数据，已在 .gitignore 中，切勿提交或打包进镜像。');
