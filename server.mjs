import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, chmod, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, newId } from './lib/store.mjs';
import { ChannelPool } from './lib/channels.mjs';
import { Auth, sha256, token, mask } from './lib/auth.mjs';
import { LogBuffer } from './lib/logs.mjs';
import { requestUpstream, responseError, retryableStatus, errorBody, extractUsage, buildUrl, channelHeaders, estimateUsage } from './lib/upstream.mjs';
import { Metrics } from './lib/metrics.mjs';
import { Pricing } from './lib/pricing.mjs';
import { createPortal } from './lib/portal.mjs';
import { createMailer } from './lib/mail.mjs';
import { CallLedger } from './lib/calllog.mjs';
import { ConcurrencyLimits } from './lib/limits.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const VERSION = '1.0.0';
const json = (res, status, value, headers = {}) => { if (res.headersSent) return; const data = JSON.stringify(value); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), ...headers }); res.end(data); };
const fail = (res, status, message, type = 'invalid_request_error', code = null, headers = {}) => json(res, status, errorBody(message, type, code), headers);
const parseCookies = header => header ?? '';
const safeChannel = c => { const { api_key, api_key_enc, ...rest } = c; return { ...rest, api_key: mask(api_key), key_hash: c.key_hash ? mask(c.key_hash) : undefined }; };
const safeKey = k => { const { key_hash, ...rest } = k; return { ...rest, key: mask(k.key ?? key_hash) }; };

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw Object.assign(new Error('Request body exceeds 8MB'), { status: 413 }); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}
function keyPortalError(error){return ['account_unavailable','model_pricing_pending','balance_insufficient','key_budget_exhausted','invalid_output_limit','storage_unavailable'].includes(error.code);}
function cleanPath(pathname) { let p = decodeURIComponent(pathname); p = p.replace(/^(?:\/relay)+(?=\/|$)/, '') || '/'; return p; }
function getStats(data) { return data.stats ??= { keys: {}, channels: {} }; }
function bump(data, key, channel, usage = {}, failed = false) {
  const stats = getStats(data); const day = new Date().toISOString().slice(0, 10);
  for (const [group, id] of [['keys', key?.id], ['channels', channel?.id]]) { if (!id) continue; const row = stats[group][id] ??= { total: { requests: 0, prompt_tokens: 0, completion_tokens: 0, failures: 0 }, daily: {} }; const daily = row.daily[day] ??= { requests: 0, prompt_tokens: 0, completion_tokens: 0, failures: 0 }; for (const target of [row.total, daily]) { target.requests++; target.prompt_tokens += Number(usage.prompt_tokens ?? usage.input_tokens ?? 0); target.completion_tokens += Number(usage.completion_tokens ?? usage.output_tokens ?? 0); if (failed) target.failures++; } }
}
function sanitizeChannel(input, old = {}) {
  const c = { ...old, ...input };
  c.id = old.id ?? input.id ?? newId(); c.name = String(c.name ?? 'Channel'); c.base_url = String(c.base_url ?? '').replace(/\/+$/, '');
  c.api_key = input.api_key || old.api_key || ''; c.models = Array.isArray(c.models) ? c.models.map(String) : ['*']; c.weight = Math.max(1, Number(c.weight) || 1); c.enabled = c.enabled !== false;
  // 反代适配：路径前缀与自定义请求头
  c.path_prefix = String(c.path_prefix ?? '').replace(/^\/+|\/+$/g, '');
  if (c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)) {
    const clean = {}; for (const [k, v] of Object.entries(c.headers)) { const key = String(k || '').trim(); if (key) clean[key] = String(v ?? ''); }
    c.headers = clean;
  } else if (typeof c.headers === 'string' && c.headers.trim()) {
    try { c.headers = JSON.parse(c.headers); } catch { throw Object.assign(new Error('自定义请求头必须是 JSON 对象'), { status: 400 }); }
  } else { c.headers = c.headers && typeof c.headers === 'object' ? c.headers : {}; }
  if (!/^https?:\/\//i.test(c.base_url) || !c.api_key) throw Object.assign(new Error('base_url must be HTTP(S) and api_key is required'), { status: 400 });
  // ---- note: source-level rate, concurrency and timeout knobs (all optional, validated) ----
  const num = (value, fallback, label, min, max, integer = true) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) throw Object.assign(new Error(`${label} 需为 ${min} 到 ${max} 之间的${integer ? '整数' : '数字'}`), { status: 400 });
    return parsed;
  };
  c.max_concurrency = num(c.max_concurrency, 0, '并发上限', 0, 512);
  c.queue_ms = num(c.queue_ms, 0, '排队等待时长', 0, 60000);
  c.max_queue = num(c.max_queue, c.max_concurrency > 0 ? 100 : 0, '排队人数上限', 0, 1000);
  if (!c.max_concurrency) { c.queue_ms = 0; c.max_queue = 0; }
  c.timeout_ms = num(c.timeout_ms, 300000, '超时时间', 1000, 600000);
  c.retries = num(c.retries, 2, '失败重试次数', 0, 2);
  c.rate_multiplier = num(c.rate_multiplier, 1, '倍率', 0.01, 100, false);
  if (c.model_aliases === undefined) c.model_aliases = old.model_aliases || {};
  else {
    if (!c.model_aliases || typeof c.model_aliases !== 'object' || Array.isArray(c.model_aliases)) throw Object.assign(new Error('模型别名必须是对象，例如 {"gpt-4o":"gpt-4o-2024-11-20"}'), { status: 400 });
    const aliases = {};
    for (const [alias, target] of Object.entries(c.model_aliases)) {
      const key = String(alias || '').trim(); const value = String(target ?? '').trim();
      if (!key || !value) throw Object.assign(new Error('模型别名的键和值都不能为空'), { status: 400 });
      if (key.length > 120 || value.length > 120) throw Object.assign(new Error('模型别名过长'), { status: 400 });
      aliases[key] = value;
    }
    c.model_aliases = aliases;
    // Alias names must be routable to this channel, otherwise the mapping can never fire.
    const declared = new Set(c.models);
    if (!declared.has('*')) for (const alias of Object.keys(aliases)) declared.add(alias);
    c.models = [...declared];
  }
  return c;
}

/** Map a client-facing model name to what this channel expects upstream. */
const upstreamModel = (channel, model) => (channel?.model_aliases && channel.model_aliases[model]) || model;

export async function startRelay({ host = '127.0.0.1', port = 0, dataDir = resolve(here, 'data'), adminKey, portalOptions = {} } = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let secret = adminKey ?? process.env.RELAY_ADMIN_KEY;
  if (!secret) { const keyFile = resolve(dataDir, 'admin.key'); try { secret = (await readFile(keyFile, 'utf8')).trim(); } catch { secret = randomBytes(24).toString('base64url'); await writeFile(keyFile, secret, { mode: 0o600 }); await chmod(keyFile, 0o600); process.stdout.write(`Relay admin key: ${secret}\n`); } }
  const encryptionFile = resolve(dataDir, 'relay.secret');
  let encryptionSecret;
  try { encryptionSecret = await readFile(encryptionFile); }
  catch { encryptionSecret = randomBytes(32); await writeFile(encryptionFile, encryptionSecret, { mode: 0o600 }); await chmod(encryptionFile, 0o600); }
  const store = await new Store(resolve(dataDir, 'relay.json'), createHash('sha256').update(encryptionSecret).digest()).load();
  await store.save();
  const metrics = await new Metrics(resolve(dataDir, 'metrics.json')).load();
  const pricing = await new Pricing(resolve(dataDir, 'pricing.json')).load();
  process.once('beforeExit', () => metrics.flush().catch(error => process.stderr.write(`Metrics flush failed: ${error.message}\n`)));
  const auth = new Auth(secret); const pool = new ChannelPool(); const logs = new LogBuffer(store);
  // note: per-source concurrency guard (see lib/limits.mjs)
  const limits = new ConcurrencyLimits();
  // note: structured call ledger (IP/UA/request_id/cost/status) for the admin console.
  const calls = new CallLedger(store);
  const userAgent = req => String(req.headers['user-agent'] || '').slice(0, 200);
  const recordCall = (row) => calls.add(row).catch(() => {});
  // note: the upstream KEY's multiplier scales the list price for everyone routed through it.
  // Account keys (user_id) keep the portal rate (user-group multiplier × list) applied in lib/portal.mjs,
  // so an account is never charged twice; standalone console keys are billed here at list × source multiplier.
  const channelMultiplier = channel => { const value = Number(channel?.rate_multiplier); return Number.isFinite(value) && value > 0 ? Math.min(100, Math.max(0.01, value)) : 1; };
  const billingRates = (key, channel) => {
    const source = channelMultiplier(channel);
    const group = key?.group_id ? (store.data.groups || []).find(g => g.id === key.group_id) : null;
    if (key?.user_id) return { list: 1, source, group: 1, effective: source };
    const groupRate = group ? Math.min(100, Math.max(0.1, Number(group.rate_multiplier) || 1)) : 1;
    return { list: 1, source, group: groupRate, effective: Math.round(source * groupRate * 1e6) / 1e6 };
  };
  const chargeKey = (key, model, usage, channel = null) => {
    if (!key) return 0;
    const cost = Math.round(pricing.estimate(model, usage) * billingRates(key, channel).effective * 1e6) / 1e6;
    key.used_usd = Math.round((Number(key.used_usd || 0) + cost) * 1e6) / 1e6;
    return cost;
  };
  const keyGroup = key => (store.data.groups || []).find(g => g.id === key?.group_id) || null;
  // Ledger helper: accepts only DB ids / masked hints — never the bearer token.
  const logCall = (req, { key, model = '', channel = null, prompt = 0, completion = 0, cost = null, status = 0, error = '', errorCode = '', latency = 0, stream = false, requestId = '', attempt = 1, waitMs = 0 }) => {
    const promptTokens = Math.max(0, Number(prompt) || 0), completionTokens = Math.max(0, Number(completion) || 0);
    const usage = { input_tokens: promptTokens, output_tokens: completionTokens };
    const sourceGroup = (store.data.source_groups || []).find(g => (g.channel_ids || []).includes(channel?.id)) || null;
    const rates = billingRates(key, channel);
    recordCall({
      id: requestId, ts: new Date().toISOString(),
      user_id: key?.user_id || null, key_id: key?.id || null,
      key_hint: key?.suffix ? `sk-…${key.suffix}` : (key?.key_hash ? `sha256:${String(key.key_hash).slice(0, 8)}…` : ''),
      key_name: key?.name || '',
      model, upstream_model: channel ? upstreamModel(channel, model) : '',
      channel_id: channel?.id || null, channel_name: channel?.name || '',
      source_group: sourceGroup?.name || '', source_group_id: sourceGroup?.id || null,
      prompt_tokens: promptTokens, completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      list_cost: status > 0 && status < 400 ? pricing.estimate(model, usage) : 0,
      cost: cost !== null && cost !== undefined ? cost : (status > 0 && status < 400 ? Math.round(pricing.estimate(model, usage) * rates.effective * 1e6) / 1e6 : 0),
      rate_multiplier: rates.effective, source_multiplier: rates.source, group_multiplier: rates.group,
      latency_ms: latency, wait_ms: Math.max(0, Math.round(Number(waitMs) || 0)), status, error_code: errorCode, error,
      ip: req.portalClientIp || req.socket?.remoteAddress || '', ua: userAgent(req),
      stream: stream === true, attempt
    });
  };
  const publicOrigin = process.env.PUBLIC_ORIGIN || 'https://example.com';
  // The console is served on its own host (admin.example.com) but the apex host may still reach it during
  // rollout, so write-guards accept either origin instead of exactly one.
  const adminOrigin = process.env.ADMIN_ORIGIN ?? 'https://admin.example.com';
  // Secure cookies are the default. Only a local plain-HTTP experiment should set COOKIE_SECURE=false.
  const cookieSecure = process.env.COOKIE_SECURE !== 'false';
  const originAllowed = req => req.headers.origin === publicOrigin || req.headers.origin === adminOrigin;
  const mailer = createMailer({store,dataDir,origin:publicOrigin,...(portalOptions.mailer || {})});
  const portal = createPortal({store,pricing,origin:publicOrigin,origins:[adminOrigin],cookieSecure,sendMail:message=>mailer.send(message),mailReady:()=>mailer.ready(),...portalOptions});
  await store.save();
  const pulses = [];
  let pulseId = 0;
  const recordPulse = (channel, status, model = '') => { pulses.push({ id: ++pulseId, ts: new Date().toISOString(), channel: channel?.name ?? '', status, model }); if (pulses.length > 30) pulses.shift(); };
  const server = http.createServer(async (req, res) => {
    const started = Date.now(); let body; let portalReservation=null; const path = cleanPath(new URL(req.url, 'http://localhost').pathname);
    res.setHeader('x-content-type-options', 'nosniff');
    const sourceIp=String(req.socket.remoteAddress||'');
    if(/^(?:::ffff:)?(?:127\.0\.0\.1|172\.21\.0\.1)$/.test(sourceIp)||sourceIp==='::1') { const forwarded=String(req.headers['x-real-ip']||'');if(forwarded&&forwarded.length<=45&&/^[a-fA-F0-9:.]+$/.test(forwarded))req.portalClientIp=forwarded; }
    // 审计 IP 必须在这段 X-Real-IP 解析之后取值，否则经 nginx 反代时记到的是容器网关地址。
    const auditIp = req.portalClientIp || req.socket?.remoteAddress || '';
    if(path.startsWith('/portal'))req.on('aborted',()=>{});
    if (path.startsWith('/admin')) { res.setHeader('cache-control', 'no-store'); }
    try {
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, version: VERSION });
      if (req.method === 'GET' && path === '/catalog') {
        const models = [...new Set(store.data.channels
          .filter(channel => channel.enabled !== false)
          .flatMap(channel => Array.isArray(channel.models) ? channel.models : [])
          .filter(model => typeof model === 'string' && model.trim() && model !== '*'))]
          .sort()
          .map(id => {
            const rates = Object.hasOwn(pricing.table, id) ? pricing.table[id] : null;
            const validRates = rates && typeof rates === 'object' && ['in', 'out', 'cache'].every(key => Object.hasOwn(rates, key) && Number.isFinite(Number(rates[key])) && Number(rates[key]) >= 0);
            return { id, available: true, pricing: validRates ? { in: rates.in, out: rates.out, cache: rates.cache } : null };
          });
        return json(res, 200, { models, pricing_unit: 'per_1m_tokens', ...portal.billingMetadata(), updated_at: new Date().toISOString() }, { 'cache-control': 'no-store' });
      }
      if (await portal.handle(req,res,path,readBody)) return;
      if (path === '/admin/login' && req.method === 'POST') { body = await readBody(req); const result = auth.login(req.socket.remoteAddress ?? '', body.adminKey); if (!result.ok) return fail(res, result.locked ? 429 : 401, result.locked ? 'Too many failed login attempts' : 'Invalid admin key', 'authentication_error', null, result.locked ? { 'retry-after': '300' } : {}); res.setHeader('set-cookie', `relay_session=${result.sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`); return json(res, 200, { ok: true }); }
      if (path === '/admin/logout' && req.method === 'POST') { auth.logout(parseCookies(req.headers.cookie)); res.setHeader('set-cookie', 'relay_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
      if (path.startsWith('/admin/api/')) {
        if (!auth.validSession(parseCookies(req.headers.cookie))) return fail(res, 401, 'Authentication required', 'authentication_error');
        req.portalAdminAuthorized=true;
        if (await portal.handleAdmin(req,res,path,readBody)) return;
        if(path==='/admin/api/mail'||path==='/admin/api/mail/verify'||path==='/admin/api/mail/test'){
          if(req.method!=='GET'&&!originAllowed(req))return fail(res,403,'请求来源校验失败','permission_error','origin_not_allowed');
          try{
            if(path==='/admin/api/mail'&&req.method==='GET')return json(res,200,mailer.getConfig());
            if(path==='/admin/api/mail'&&req.method==='PUT')return json(res,200,await mailer.saveConfig(await readBody(req)));
            if(path==='/admin/api/mail/verify'&&req.method==='POST')return json(res,200,await mailer.verify());
            if(path==='/admin/api/mail/test'&&req.method==='POST'){const input=await readBody(req);return json(res,200,await mailer.sendTest(input.to));}
            return fail(res,404,'Not found','invalid_request_error','not_found');
          }catch(error){return fail(res,error.status||503,error.status?error.message:'邮件服务暂不可用','mail_error',error.code||'mail_error');}
        }

        if (req.method !== 'GET') { const auditPath = path.replace('/admin/api/', ''); const auditMark = store.data.audit.length; res.on('finish', () => { if (store.data.audit.length > auditMark) return; const item = { ts: new Date().toISOString(), actor: 'admin', action: req.method + ' ' + auditPath, status: res.statusCode, ip: auditIp }; store.data.audit.push(item); if (store.data.audit.length > 500) store.data.audit.splice(0, store.data.audit.length - 500); store.save().catch(() => {}); }); }
        const matchChannel = /^\/admin\/api\/channels(?:\/([^/]+)(?:\/(test))?)?$/.exec(path);
        const matchKey = /^\/admin\/api\/keys(?:\/([^/]+))?$/.exec(path);
        if (path === '/admin/api/state' && req.method === 'GET') return json(res, 200, { channels: store.data.channels.map(c => ({ ...safeChannel(c), cooldown_ms: pool.remaining(c.id) })), keys: store.data.keys.map(safeKey), stats: store.data.stats, logs: logs.list(100), version: VERSION });
        if (path === '/admin/api/logs' && req.method === 'GET') return json(res, 200, logs.list(new URL(req.url, 'http://localhost').searchParams.get('limit')));
        // note: queryable call records. Filters mirror the admin UI; the ledger never stores keys.
        if (path === '/admin/api/calls/meta' && req.method === 'GET') return json(res, 200, { ...calls.stats(), retention_days: calls.retentionDays, ...calls.facets(), channels: store.data.channels.map(c => ({ id: c.id, name: c.name, enabled: c.enabled !== false })) });
        if (path === '/admin/api/calls' && req.method === 'GET') {
          const q = new URL(req.url, 'http://localhost').searchParams;
          let result;
          try {
            result = calls.query({
              from: q.get('from') || '', to: q.get('to') || '', user: q.get('user') || '', key: q.get('key') || '',
              model: q.get('model') || '', status: q.get('status') || '', q: q.get('q') || '',
              channel: q.get('channel') || '', source: q.get('source') || '',
              limit: q.get('limit'), offset: q.get('offset')
            });
          } catch (error) { return fail(res, 400, error.message || 'Invalid query', 'invalid_request_error', 'invalid_query'); }
          return json(res, 200, { ...result, generated_at: new Date().toISOString() });
        }
        if (path === '/admin/api/pulse' && req.method === 'GET') return json(res, 200, pulses.slice(-30).map(({ ts, channel, status, model }) => ({ ts, channel, status, model })));
        if (path === '/admin/api/metrics' && req.method === 'GET') { const q = new URL(req.url, 'http://localhost').searchParams; return json(res, 200, metrics.range(q.get('range'), q.get('bucket'))); }
        if (path === '/admin/api/pricing' && req.method === 'GET') return json(res, 200, pricing.table);
        if (path === '/admin/api/overview' && req.method === 'GET') {
          const q = new URL(req.url, 'http://localhost').searchParams; const range = ['24h', '7d', '30d'].includes(q.get('range')) ? q.get('range') : '24h';
          const snap = metrics.range(range, range === '24h' ? 'hour' : 'day');
          const cost = snap.models.reduce((sum, m) => sum + pricing.estimate(m.model, m), 0);
          const todayCost = (snap.totals.today_models || []).reduce((sum, m) => sum + pricing.estimate(m.model, m), 0);
          const health = store.data.channels.map(c => ({ id: c.id, name: c.name, enabled: c.enabled !== false, cooldown_ms: pool.remaining(c.id), models: c.models ?? [], weight: c.weight ?? 1 }));
          return json(res, 200, { range, generated_at: new Date().toISOString(), totals: snap.totals, series: snap.series, models: snap.models, channels: snap.channels, cost, today_cost: todayCost, health, counts: { channels: health.length, channels_enabled: health.filter(h => h.enabled && h.cooldown_ms === 0).length, keys: store.data.keys.length, keys_enabled: store.data.keys.filter(k => k.enabled !== false).length }, version: VERSION });
        }
        if (path === '/admin/api/models' && req.method === 'GET') {
          const snap = metrics.range('24h', 'hour'); const usage = new Map(snap.models.map(m => [m.model, m])); const map = new Map();
          for (const c of store.data.channels) { for (const name of (Array.isArray(c.models) && c.models.length ? c.models : ['*'])) { if (name === '*') continue; const row = map.get(name) ?? { model: name, channels: [] }; if (!row.channels.some(x => x.id === c.id)) row.channels.push({ id: c.id, name: c.name, enabled: c.enabled !== false }); map.set(name, row); } }
          for (const m of snap.models) if (!map.has(m.model)) map.set(m.model, { model: m.model, channels: [] });
          const items = [...map.values()].map(row => { const u = usage.get(row.model) || {}; return { ...row, enabled_channels: row.channels.filter(x => x.enabled).length, requests: u.requests || 0, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cache_read_tokens: u.cache_read_tokens || 0, pricing: pricing.table[row.model] || null }; }).sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model));
          return json(res, 200, { items, pricing: pricing.table });
        }
        if (path === '/admin/api/usage' && req.method === 'GET') {
          const q = new URL(req.url, 'http://localhost').searchParams; const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 20)); const offset = Math.max(0, Number(q.get('offset')) || 0);
          const search = (q.get('q') || '').trim().toLowerCase(); const model = q.get('model') || ''; const keyName = q.get('key') || ''; const status = q.get('status') || '';
          let rows = [...logs.items].reverse().map(item => ({ ...item, cost: pricing.estimate(item.model, { input_tokens: item.prompt_tokens, output_tokens: item.completion_tokens, cache_read_tokens: item.cache_read_tokens || 0 }) }));
          if (search) rows = rows.filter(r => `${r.model} ${r.channel_name} ${r.key_name} ${r.error || ''}`.toLowerCase().includes(search));
          if (model) rows = rows.filter(r => r.model === model);
          if (keyName) rows = rows.filter(r => r.key_name === keyName);
          if (status === 'ok') rows = rows.filter(r => Number(r.status) < 400); else if (status === 'error') rows = rows.filter(r => Number(r.status) >= 400);
          return json(res, 200, { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset, revenue: rows.reduce((s, r) => s + r.cost, 0), models: [...new Set(logs.items.map(l => l.model).filter(Boolean))], keys: [...new Set(logs.items.map(l => l.key_name).filter(Boolean))] });
        }
        if (path === '/admin/api/system' && req.method === 'GET') {
          return json(res, 200, { version: VERSION, node: process.version, platform: process.platform, arch: process.arch, uptime_s: Math.round(process.uptime()), rss_mb: Math.round(process.memoryUsage().rss / 1048576), channels: store.data.channels.length, keys: store.data.keys.length, logs: logs.items.length, buckets: Object.keys(metrics.data.buckets).length, started_at: new Date(Date.now() - process.uptime() * 1000).toISOString() });
        }
        if (path === '/admin/api/audit' && req.method === 'GET') return json(res, 200, [...store.data.audit].reverse().slice(0, 200));
        if (path === '/admin/api/groups' && req.method === 'GET') return json(res, 200, store.data.groups);
        if (path === '/admin/api/groups' && req.method === 'POST') { body = await readBody(req); const g = { id: newId(), name: String(body.name ?? '分组'), models: Array.isArray(body.models) && body.models.length ? body.models.map(String) : ['*'], note: String(body.note ?? ''), enabled: body.enabled !== false, created_at: new Date().toISOString() }; store.data.groups.push(g); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'create key group', target: g.name, target_id: g.id, target_type: 'group', after: { models: g.models, enabled: g.enabled }, ip: auditIp }); await store.save(); return json(res, 201, g); }
        if (path === '/admin/api/redeem' && req.method === 'GET') return json(res, 200, [...store.data.redeem].reverse());
        if (path === '/admin/api/redeem' && req.method === 'POST') { body = await readBody(req); const count = Math.min(200, Math.max(1, Number(body.count) || 1)); const amount = Math.max(0, Number(body.amount) || 0); const created = []; store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'create redeem codes', target: 'redeem', target_type: 'redeem', after: { count, amount, note: String(body.note ?? '').slice(0, 120) }, ip: auditIp }); for (let i = 0; i < count; i++) { const item = { id: newId(), code: 'RC-' + randomBytes(6).toString('hex').toUpperCase(), amount, used: false, used_by: null, used_at: null, note: String(body.note ?? ''), created_at: new Date().toISOString() }; store.data.redeem.push(item); created.push(item); } await store.save(); return json(res, 201, created); }
        if (path === '/admin/api/announcements' && req.method === 'GET') return json(res, 200, [...store.data.announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at))));
        if (path === '/admin/api/announcements' && req.method === 'POST') { body = await readBody(req); const a = { id: newId(), title: String(body.title ?? '公告'), body: String(body.body ?? ''), level: ['info', 'warning', 'success'].includes(body.level) ? body.level : 'info', pinned: Boolean(body.pinned), published: body.published !== false, created_at: new Date().toISOString() }; store.data.announcements.push(a); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'create announcement', target: a.title, target_id: a.id, target_type: 'announcement', after: { level: a.level, pinned: a.pinned, published: a.published }, ip: auditIp }); await store.save(); return json(res, 201, a); }
        const matchGroup = /^\/admin\/api\/groups\/([^/]+)$/.exec(path);
        if (matchGroup) { const g = store.data.groups.find(x => x.id === matchGroup[1]); if (!g) return fail(res, 404, 'Group not found'); if (req.method === 'PATCH') { body = await readBody(req); const before = { name: g.name, note: g.note, enabled: g.enabled, models: g.models }; if (body.name !== undefined) g.name = String(body.name); if (body.note !== undefined) g.note = String(body.note); if (body.enabled !== undefined) g.enabled = Boolean(body.enabled); if (body.models !== undefined) g.models = Array.isArray(body.models) && body.models.length ? body.models.map(String) : ['*']; store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'update key group', target: g.name, target_id: g.id, target_type: 'group', before, after: { name: g.name, note: g.note, enabled: g.enabled, models: g.models }, ip: auditIp }); await store.save(); return json(res, 200, g); } if (req.method === 'DELETE') { store.data.groups = store.data.groups.filter(x => x.id !== g.id); for (const k of store.data.keys) if (k.group_id === g.id) k.group_id = null; await store.save(); return json(res, 200, { ok: true }); } }
        const matchRedeem = /^\/admin\/api\/redeem\/([^/]+)$/.exec(path);
        if (matchRedeem && req.method === 'DELETE') { store.data.redeem = store.data.redeem.filter(x => x.id !== matchRedeem[1]); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'delete redeem code', target: matchRedeem[1], target_type: 'redeem', ip: auditIp }); await store.save(); return json(res, 200, { ok: true }); }
        const matchAnn = /^\/admin\/api\/announcements\/([^/]+)$/.exec(path);
        if (matchAnn) { const a = store.data.announcements.find(x => x.id === matchAnn[1]); if (!a) return fail(res, 404, 'Announcement not found'); if (req.method === 'PATCH') { body = await readBody(req); const before = { title: a.title, level: a.level, pinned: a.pinned, published: a.published }; if (body.title !== undefined) a.title = String(body.title); if (body.body !== undefined) a.body = String(body.body); if (body.level !== undefined) a.level = String(body.level); if (body.pinned !== undefined) a.pinned = Boolean(body.pinned); if (body.published !== undefined) a.published = Boolean(body.published); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'update announcement', target: a.title, target_id: a.id, target_type: 'announcement', before, after: { title: a.title, level: a.level, pinned: a.pinned, published: a.published }, ip: auditIp }); await store.save(); return json(res, 200, a); } if (req.method === 'DELETE') { store.data.announcements = store.data.announcements.filter(x => x.id !== a.id); await store.save(); return json(res, 200, { ok: true }); } }
        // note: upstream source groups (which channels/models back a supplier) for the console.
        if (path === '/admin/api/source-groups' && req.method === 'GET') {
          const items = (store.data.source_groups || []).map(group => {
            const channels = (group.channel_ids || []).map(id => store.data.channels.find(c => c.id === id)).filter(Boolean);
            return { id: group.id, name: group.name, note: group.note || '', enabled: group.enabled !== false, channel_ids: group.channel_ids || [], channels: channels.map(c => ({ id: c.id, name: c.name, enabled: c.enabled !== false, cooldown_ms: pool.remaining(c.id), models: c.models || [] })), models: [...new Set(channels.flatMap(c => (c.models || []).filter(m => m !== '*')))], channel_count: channels.length, healthy: group.enabled !== false && channels.some(c => c.enabled !== false && pool.remaining(c.id) === 0), created_at: group.created_at || null };
          });
          return json(res, 200, { items });
        }
        if (path === '/admin/api/source-groups' && req.method === 'POST') {
          body = await readBody(req); const name = String(body.name ?? '').trim().slice(0, 60); if (!name) return fail(res, 400, 'Group name is required', 'invalid_request_error', 'invalid_group_name');
          if ((store.data.source_groups || []).some(g => g.name.toLowerCase() === name.toLowerCase())) return fail(res, 409, 'A source group with this name already exists', 'invalid_request_error', 'group_exists');
          const ids = Array.isArray(body.channel_ids) ? [...new Set(body.channel_ids.map(String))].filter(id => store.data.channels.some(c => c.id === id)) : [];
          const group = { id: newId(), name, note: String(body.note ?? '').slice(0, 200), enabled: body.enabled !== false, channel_ids: ids, created_at: new Date().toISOString() };
          store.data.source_groups = [...(store.data.source_groups || []), group]; store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'create source group', target: group.name, target_id: group.id, target_type: 'source_group', after: { channel_ids: group.channel_ids, note: group.note }, ip: auditIp }); await store.save(); return json(res, 201, group);
        }
        const matchSource = /^\/admin\/api\/source-groups\/([^/]+)$/.exec(path);
        if (matchSource) {
          const group = (store.data.source_groups || []).find(g => g.id === matchSource[1]); if (!group) return fail(res, 404, 'Source group not found');
          if (req.method === 'PATCH') { body = await readBody(req); const before = { name: group.name, note: group.note, enabled: group.enabled, channel_ids: group.channel_ids }; if (body.name !== undefined) { const name = String(body.name).trim().slice(0, 60); if (!name) return fail(res, 400, 'Group name is required', 'invalid_request_error', 'invalid_group_name'); group.name = name; } if (body.note !== undefined) group.note = String(body.note).slice(0, 200); if (body.enabled !== undefined) group.enabled = body.enabled === true; if (body.channel_ids !== undefined) group.channel_ids = Array.isArray(body.channel_ids) ? [...new Set(body.channel_ids.map(String))].filter(id => store.data.channels.some(c => c.id === id)) : []; store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'update source group', target: group.name, target_id: group.id, target_type: 'source_group', before, after: { name: group.name, note: group.note, enabled: group.enabled, channel_ids: group.channel_ids }, ip: auditIp }); await store.save(); return json(res, 200, group); }
          if (req.method === 'DELETE') { store.data.source_groups = (store.data.source_groups || []).filter(g => g.id !== group.id); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'delete source group', target: group.name, target_id: group.id, target_type: 'source_group', before: { channel_ids: group.channel_ids }, ip: auditIp }); await store.save(); return json(res, 200, { ok: true }); }
        }
        const matchCredit = /^\/admin\/api\/keys\/([^/]+)\/credit$/.exec(path);
        if (matchCredit && req.method === 'POST') {
          const k = store.data.keys.find(x => x.id === matchCredit[1]); if (!k) return fail(res, 404, 'Key not found');
          body = await readBody(req); const amount = Number(body.amount);
          if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return fail(res, 400, '额度需要大于 0 且不超过 100000', 'invalid_request_error', 'invalid_amount');
          // Account keys are billed from the owner's balance; a key-level quota there would be a second, invisible limiter.
          if (k.user_id) return fail(res, 400, '账户密钥按用户余额结算，请前往用户管理为该账户加额。', 'invalid_request_error', 'account_credit_required');
          const before = Math.round((Number(k.quota_usd || 0)) * 1e6) / 1e6;
          k.quota_usd = Math.round((Math.max(0, before) + amount) * 1e6) / 1e6;
          store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'credit key quota', target: k.name, target_id: k.id, target_type: 'key', key_hint: k.suffix ? `sk-…${k.suffix}` : '', amount_usd: amount, before_usd: before, after_usd: k.quota_usd, currency: 'USD', basis: 'key remaining quota (quota_usd)', note: String(body.note ?? '').slice(0, 200), ip: req.portalClientIp || req.socket?.remoteAddress || '' });
          if (store.data.audit.length > 500) store.data.audit.splice(0, store.data.audit.length - 500);
          await store.save(); return json(res, 200, { ok: true, key: safeKey(k), before, after: k.quota_usd, added: amount, unit: 'USD' });
        }
        if (path === '/admin/api/pricing' && req.method === 'PUT') { body = await readBody(req); const before = structuredClone(pricing.table); try { const next = await pricing.set(body); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'update model pricing', target: 'pricing', target_type: 'pricing', before, after: next, ip: req.portalClientIp || req.socket?.remoteAddress || '' }); await store.save(); return json(res, 200, next); } catch (e) { return fail(res, e.status ?? 400, e.message); } }
        if (path === '/admin/api/logs' && req.method === 'DELETE') { const cleared = logs.items.length; logs.items = []; store.data.logs = []; store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'clear request logs', target: 'logs', target_type: 'logs', before: { entries: cleared }, ip: auditIp }); await store.save(); return json(res, 200, { ok: true }); }
        if (path === '/admin/api/admin-key' && req.method === 'PUT') { body = await readBody(req); const next = String(body.adminKey ?? ''); if (next.length < 12) return fail(res, 400, '管理密钥至少需要 12 个字符'); auth.adminKey = next; store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'rotate admin key', target: 'admin', target_type: 'admin', note: '密钥内容不落日志', ip: auditIp }); await store.save(); return json(res, 200, { ok: true }); }
        if (path === '/admin/api/channels' && req.method === 'GET') return json(res, 200, store.data.channels.map(c => ({ ...safeChannel(c), cooldown_ms: pool.remaining(c.id), limits: limits.snapshot(c) })));
        // note: the same knobs as JSON, so a script can read -> edit -> PUT them back.
        if (path === '/admin/api/sources/config' && req.method === 'GET') {
          return json(res, 200, { version: 1, updated_at: new Date().toISOString(), sources: store.data.channels.map(c => ({ id: c.id, name: c.name, base_url: c.base_url, path_prefix: c.path_prefix || '', models: c.models || ['*'], model_aliases: c.model_aliases || {}, rate_multiplier: channelMultiplier(c), max_concurrency: Number(c.max_concurrency) || 0, queue_ms: Number(c.queue_ms) || 0, max_queue: Number(c.max_queue) || 0, timeout_ms: Number(c.timeout_ms) || 300000, retries: Number(c.retries ?? 2), weight: Number(c.weight) || 1, enabled: c.enabled !== false, headers: Object.keys(c.headers || {}) })), source_groups: (store.data.source_groups || []).map(g => ({ id: g.id, name: g.name, channel_ids: g.channel_ids || [], note: g.note || '', enabled: g.enabled !== false })) });
        }
        if (path === '/admin/api/sources/config' && req.method === 'PUT') {
          body = await readBody(req);
          const sources = Array.isArray(body?.sources) ? body.sources : null;
          if (!sources) return fail(res, 400, 'JSON 里需要 sources 数组', 'invalid_request_error', 'invalid_config');
          // Validate everything first; nothing is written unless the whole document is accepted.
          const incoming = new Map();
          for (const item of sources) {
            let next;
            try { next = sanitizeChannel({ ...item, api_key: item?.api_key || '' }, store.data.channels.find(c => c.id === item?.id) || {}); } catch (e) { return fail(res, 400, `${item?.name || item?.id || '来源'}：${e.message}`, 'invalid_request_error', 'invalid_config'); }
            if (!next.api_key) return fail(res, 400, `${item?.name || item?.id || '来源'}：缺少密钥（json 中可写 api_key，也可先保留 id 只改其他字段）`, 'invalid_request_error', 'invalid_config');
            incoming.set(next.id, next);
          }
          const before = store.data.channels.map(c => ({ id: c.id, rate_multiplier: channelMultiplier(c), max_concurrency: Number(c.max_concurrency) || 0 }));
          const kept = store.data.channels.filter(c => incoming.has(c.id)).map(c => incoming.get(c.id));
          const created = [...incoming.values()].filter(c => !store.data.channels.some(old => old.id === c.id));
          store.data.channels = kept.concat(created);
          store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'update source config (json)', target: 'channels', target_type: 'source', before, after: store.data.channels.map(c => ({ id: c.id, rate_multiplier: channelMultiplier(c), max_concurrency: Number(c.max_concurrency) || 0 })), ip: req.portalClientIp || req.socket?.remoteAddress || '' });
          await store.save();
          return json(res, 200, { ok: true, updated: kept.length, created: created.length, sources: store.data.channels.map(c => ({ ...safeChannel(c), limits: limits.snapshot(c) })), keys_note: '密钥不会通过本接口返回，只回掩码。' });
        }
        if (matchChannel) {
          const id = matchChannel[1]; const existing = store.data.channels.find(c => c.id === id);
          if (matchChannel[2] && req.method === 'POST') { if (!existing) return fail(res, 404, 'Channel not found'); const t = Date.now(); try { const response = await requestUpstream(existing, '/v1/chat/completions', { model: existing.models.find(x => x !== '*') ?? 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }); if (!response.ok) throw await responseError(response); await response.body?.cancel(); recordPulse(existing, response.status); return json(res, 200, { ok: true, latency_ms: Date.now() - t, error: null }); } catch (e) { recordPulse(existing, e.status ?? 502); return json(res, 200, { ok: false, latency_ms: Date.now() - t, error: e.message }); } }
          if (!id && req.method === 'POST') { body = await readBody(req); const channel = sanitizeChannel(body); store.data.channels.push(channel); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'create source', target: channel.name, target_id: channel.id, target_type: 'source', after: { base_url: channel.base_url, models: channel.models, rate_multiplier: channelMultiplier(channel), max_concurrency: channel.max_concurrency, timeout_ms: channel.timeout_ms, retries: channel.retries }, key_hint: mask(channel.api_key), ip: req.portalClientIp || req.socket?.remoteAddress || '' }); await store.save(); return json(res, 201, safeChannel(channel)); }
          if (id && req.method === 'PATCH') { if (!existing) return fail(res, 404, 'Channel not found'); body = await readBody(req); const before = { name: existing.name, base_url: existing.base_url, models: existing.models, rate_multiplier: channelMultiplier(existing), max_concurrency: existing.max_concurrency, timeout_ms: existing.timeout_ms, retries: existing.retries, enabled: existing.enabled !== false, key_hint: mask(existing.api_key) }; Object.assign(existing, sanitizeChannel(body, existing)); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'update source', target: existing.name, target_id: existing.id, target_type: 'source', before, after: { name: existing.name, base_url: existing.base_url, models: existing.models, rate_multiplier: channelMultiplier(existing), max_concurrency: existing.max_concurrency, timeout_ms: existing.timeout_ms, retries: existing.retries, enabled: existing.enabled !== false, key_hint: mask(existing.api_key) }, ip: req.portalClientIp || req.socket?.remoteAddress || '' }); await store.save(); return json(res, 200, safeChannel(existing)); }
          if (id && req.method === 'DELETE') { if (!existing) return fail(res, 404, 'Channel not found'); const before = { name: existing.name, base_url: existing.base_url, models: existing.models, rate_multiplier: channelMultiplier(existing), max_concurrency: existing.max_concurrency, key_hint: mask(existing.api_key) }; store.data.channels = store.data.channels.filter(c => c.id !== id); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'delete source', target: before.name, target_id: id, target_type: 'source', before, ip: req.portalClientIp || req.socket?.remoteAddress || '' }); await store.save(); return json(res, 200, { ok: true }); }
        }
        if (matchKey) {
          const id = matchKey[1]; const existing = store.data.keys.find(k => k.id === id);
          if (!id && req.method === 'POST') { body = await readBody(req); const secretKey = token(); const item = { id: newId(), name: String(body.name ?? 'API key'), key_hash: sha256(secretKey), suffix: secretKey.slice(-4), enabled: body.enabled !== false, rpm: Math.max(0, Number(body.rpm) || 0), group_id: body.group_id ? String(body.group_id) : null, quota_usd: Math.max(0, Number(body.quota_usd) || 0), used_usd: 0, note: String(body.note ?? ''), created_at: new Date().toISOString(), last_used_at: null }; store.data.keys.push(item); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'create key', target: item.name, target_id: item.id, target_type: 'key', key_hint: `sk-…${item.suffix}`, after: { name: item.name, rpm: item.rpm, quota_usd: item.quota_usd, enabled: item.enabled, group_id: item.group_id }, ip: auditIp }); await store.save(); return json(res, 201, { ...safeKey(item), key: secretKey }); }
          if (id && req.method === 'PATCH') {
            if (!existing) return fail(res, 404, 'Key not found');
            body = await readBody(req);
            if (existing.user_id) {
              if (!body || Array.isArray(body) || Object.keys(body).some(field => !['name', 'enabled', 'rpm'].includes(field))) return fail(res, 400, '账户密钥仅可修改名称、启用状态与请求频率；额度和归属由账户管理。', 'invalid_request_error', 'account_key_field_restricted');
              const name = body.name === undefined ? existing.name : String(body.name).trim();
              const rpm = body.rpm === undefined ? existing.rpm : Number(body.rpm);
              if (!name || name.length > 64 || !Number.isInteger(rpm) || rpm < 1 || rpm > 120 || body.enabled !== undefined && typeof body.enabled !== 'boolean') return fail(res, 400, '名称需为 1 至 64 个字符，请求频率需为 1 至 120 的整数，启用状态需为布尔值。', 'invalid_request_error', 'invalid_account_key');
              const kBefore1 = { name: existing.name, rpm: existing.rpm, enabled: existing.enabled };
              existing.name = name; existing.rpm = rpm;
              if (body.enabled !== undefined) existing.enabled = body.enabled;
              store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'update key', target: existing.name, target_id: existing.id, target_type: 'key', key_hint: existing.suffix ? `sk-…${existing.suffix}` : '', before: kBefore1, after: { name: existing.name, rpm: existing.rpm, enabled: existing.enabled }, ip: auditIp });
              await store.save(); return json(res, 200, safeKey(existing));
            }
            const kBefore2 = { name: existing.name, enabled: existing.enabled, rpm: existing.rpm, group_id: existing.group_id, quota_usd: existing.quota_usd, note: existing.note, used_usd: existing.used_usd };
            if (body.name !== undefined) existing.name = String(body.name); if (body.enabled !== undefined) existing.enabled = Boolean(body.enabled); if (body.rpm !== undefined) existing.rpm = Math.max(0, Number(body.rpm) || 0); if (body.group_id !== undefined) existing.group_id = body.group_id ? String(body.group_id) : null; if (body.quota_usd !== undefined) existing.quota_usd = Math.max(0, Number(body.quota_usd) || 0); if (body.note !== undefined) existing.note = String(body.note); if (body.reset_usage === true) existing.used_usd = 0;
            store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'update key', target: existing.name, target_id: existing.id, target_type: 'key', key_hint: existing.suffix ? `sk-…${existing.suffix}` : '', before: kBefore2, after: { name: existing.name, enabled: existing.enabled, rpm: existing.rpm, group_id: existing.group_id, quota_usd: existing.quota_usd, note: existing.note, used_usd: existing.used_usd }, ip: auditIp });
            await store.save(); return json(res, 200, safeKey(existing));
          }
          if (id && req.method === 'DELETE') { if (!existing) return fail(res, 404, 'Key not found'); const kBefore3 = { name: existing.name, rpm: existing.rpm, quota_usd: existing.quota_usd, used_usd: existing.used_usd, enabled: existing.enabled }; store.data.keys = store.data.keys.filter(k => k.id !== id); store.data.audit.push({ ts: new Date().toISOString(), actor: 'admin', action: 'delete key', target: kBefore3.name, target_id: id, target_type: 'key', key_hint: existing.suffix ? `sk-…${existing.suffix}` : '', before: kBefore3, ip: auditIp }); await store.save(); return json(res, 200, { ok: true }); }
        }
        return fail(res, 404, 'Not found', 'invalid_request_error');
      }
      if (path.startsWith('/admin')) {
        if (path === '/admin') { res.writeHead(308, { location: '/admin/' }); return res.end(); }
        if (path === '/admin/') return serveStatic(res, 'index.html');
        // Console assets: explicit allow-list (no traversal) covering views/*.js, both stylesheets and motion/chart scripts.
        if (/^\/admin\/(?:app\.(?:css|js)|original\.css|original-motion\.js|charts\.js|favicon\.svg|views\/[a-z0-9_-]+\.js)$/.test(path)) return serveStatic(res, path.slice('/admin/'.length));
        return fail(res, 404, 'Not found', 'invalid_request_error');
      }
      if (path.startsWith('/v1/')) {
        const key = auth.verifyKey(req.headers.authorization, store.data.keys);
        if (!key) { logCall(req, { model: String(body?.model || ''), status: 401, error: 'Invalid API key', errorCode: 'invalid_api_key', latency: Date.now() - started }); return fail(res, 401, 'Invalid API key', 'invalid_request_error'); }
        if(key.user_id){const owner=portal.userForKey(key);if(!portal.accountActive(owner)||owner.disabled||key.revoked_at){logCall(req,{key,model:String(body?.model||''),status:403,error:'账户或密钥不可用',errorCode:'account_unavailable',latency:Date.now()-started});return fail(res,403,'账户或密钥不可用','permission_error','account_unavailable');}}
        if(key.user_id&&path==='/v1/redeem')return fail(res,400,'请在用户控制台兑换账户额度','invalid_request_error','redeem_in_portal');
        const rate = auth.limit(key); if (!rate.ok) { logCall(req, { key, model: String(body?.model || ''), status: 429, error: 'Rate limit exceeded', errorCode: 'rate_limit_exceeded', latency: Date.now() - started }); return fail(res, 429, 'Rate limit exceeded', 'rate_limit_error', 'rate_limit_exceeded', { 'retry-after': String(rate.retry) }); }
        if (path !== '/v1/redeem' && Number(key.quota_usd) > 0 && Number(key.used_usd || 0) >= Number(key.quota_usd)) { logCall(req, { key, model: String(body?.model || ''), status: 402, error: 'Key quota exhausted', errorCode: 'quota_exceeded', latency: Date.now() - started }); return fail(res, 402, 'Key quota exhausted', 'insufficient_quota', 'quota_exceeded'); }
        key.last_used_at = new Date().toISOString();
        if (path === '/v1/models' && req.method === 'GET') { const names = new Set(store.data.channels.filter(c => c.enabled !== false).flatMap(c => (c.models ?? []).filter(m => m !== '*'))); return json(res, 200, { object: 'list', data: [...names].map(id => ({ id, object: 'model', created: 0, owned_by: 'relay' })) }); }
        if (path === '/v1/redeem' && req.method === 'POST') { const rbody = await readBody(req); const code = String(rbody.code ?? '').trim().toUpperCase(); const item = (store.data.redeem || []).find(r => r.code === code && !r.used); if (!item) return fail(res, 404, 'Invalid or used redeem code', 'invalid_request_error', 'redeem_invalid'); item.used = true; item.used_by = key.name; item.used_at = new Date().toISOString(); key.quota_usd = Math.round((Math.max(0, Number(key.quota_usd || 0)) + Number(item.amount || 0)) * 100) / 100; await store.save(); return json(res, 200, { ok: true, amount: item.amount, quota_usd: key.quota_usd }); }
        if (!['/v1/chat/completions', '/v1/embeddings', '/v1/responses'].includes(path) || req.method !== 'POST') return fail(res, 404, 'Unknown API endpoint', 'invalid_request_error', 'not_found');
        body = await readBody(req); const model = String(body.model ?? ''); const stream = path === '/v1/responses' ? body.stream === true : body.stream === true;
        { const grp = keyGroup(key); if (grp && (grp.enabled === false || (Array.isArray(grp.models) && grp.models.length && !grp.models.includes('*') && !grp.models.includes(model)))) { logCall(req, { key, model, status: 403, error: grp.enabled === false ? 'API key group disabled' : 'Model not allowed for this API key group', errorCode: grp.enabled === false ? 'group_disabled' : 'model_not_allowed', latency: Date.now() - started }); return fail(res, 403, 'Model not allowed for this API key group', 'permission_error', 'model_not_allowed'); } }
        try{portalReservation=await portal.authorizeKey(key,model,body,path);}catch(error){logCall(req,{key,model,status:error.status||503,error:String(error.message||'').slice(0,200),errorCode:error.code||'account_error',latency:Date.now()-started});return fail(res,error.status||503,error.message,'account_error',error.code);}
        const excluded = new Set(); let lastError; let selected; let response; let waitedMs = 0; let attemptsMade = 0; const upstreamAbort = new AbortController();
        const abortOnDisconnect=()=>{if(!res.writableEnded)upstreamAbort.abort();};
        res.once('close',abortOnDisconnect);
        const maxAttempts = 3; // one channel + up to two failovers, same ceiling as before
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          attemptsMade = attempt + 1;
          selected = pool.select(store.data.channels, model, excluded); if (!selected) break; excluded.add(selected.id);
          // note: per-source concurrency guard (防挤爆). Unlimited sources get a no-op lease.
          const admit = await limits.acquire(selected);
          if (!admit.ok) {
            lastError = Object.assign(new Error(admit.message), { status: admit.status, code: admit.code, retryAfter: admit.retry_after });
            recordPulse(selected, admit.status, model);
            if (attempt >= maxAttempts - 1) break;
            continue; // try the next source instead of failing outright
          }
          const lease = admit.lease; waitedMs = Number(lease?.waited_ms) || 0;
          // The slot stays taken until the client response finishes (streaming included), so a source
          // with max_concurrency=1 really serves one request at a time.
          let releaseNow = true;
          try {
            // model alias: the client keeps its own name, the source gets the upstream name
            const target = upstreamModel(selected, model);
            const payload = target === model ? body : { ...body, model: target };
            const timeout = Math.min(600_000, Math.max(1000, Number(selected.timeout_ms) || 300_000));
            const rounds = 1 + Math.min(2, Math.max(0, Number(selected.retries ?? 2) || 0));
            let upstreamResponse;
            for (let round = 0; round < rounds; round++) {
              upstreamResponse = await requestUpstream(selected, path, payload, { timeout, signal: upstreamAbort.signal });
              if (!retryableStatus(upstreamResponse.status) || round + 1 >= rounds) break;
              try { await upstreamResponse.body?.cancel(); } catch { /* already consumed */ }
              await new Promise(resolve => setTimeout(resolve, 200 * (round + 1)));
            }
            response = upstreamResponse;
            if (response.status >= 400) {
              const upstreamErr = await responseError(response);
              if (upstreamErr.retriable) pool.markFailure(selected.id);
              lastError = upstreamErr;
              if (upstreamErr.retriable && attempt < maxAttempts - 1) continue;
              if (!upstreamErr.retriable) {
                const payloadBytes = Buffer.from(await response.arrayBuffer()); const latency = Date.now()-started;
                recordPulse(selected, response.status, model); bump(store.data, key, selected, {}, true);
                metrics.record({model,channel_id:selected.id,channel_name:selected.name,failure:true,latency_ms:latency,ttft_ms:latency});
                await logs.add({ key_id:key.id,user_id:key.user_id||null,key_name: key.name, model, channel_name: selected.name, status: response.status, latency_ms: latency, prompt_tokens: 0, completion_tokens: 0, stream, error: upstreamErr.message });
                await portal.settle(portalReservation,{}, {status:response.status,latency_ms:latency});portalReservation=null;
                logCall(req,{key,model,channel:selected,status:response.status,error:upstreamErr.message,errorCode:upstreamErr.code||'upstream_error',latency,stream,attempt:attempt+1,waitMs:waitedMs});
                res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json', 'content-length': payloadBytes.length }); res.end(payloadBytes); return;
              }
              break;
            }
            releaseNow = false;
            res.once('close', () => limits.release(lease));
            res.once('finish', () => limits.release(lease));
            break;
          } catch (error) { lastError = error; pool.markFailure(selected.id); if (attempt >= maxAttempts - 1) break; }
          finally { if (releaseNow) limits.release(lease); }
        }
        if (!response || response.status >= 400) { const status = lastError?.status ?? 503; const latency=Date.now()-started; const failedChannel=selected && (lastError?.status !== undefined || lastError?.code !== 'no_channel') ? selected : null; recordPulse(failedChannel, status, model); bump(store.data, key, failedChannel, {}, true); metrics.record({model,channel_id:failedChannel?.id ?? 'none',channel_name:failedChannel?.name ?? '未路由',failure:true,latency_ms:latency,ttft_ms:latency}); await logs.add({ key_id:key.id,user_id:key.user_id||null,key_name: key.name, model, channel_name: failedChannel?.name ?? '', status, latency_ms: latency, prompt_tokens: 0, completion_tokens: 0, stream, error: lastError?.message ?? 'No eligible channel' }); await store.save();await portal.settle(portalReservation,{}, {status,latency_ms:latency});portalReservation=null; logCall(req,{key,model,channel:failedChannel,status,error:lastError?.message ?? 'No eligible channel',errorCode:lastError?.code ?? 'no_channel',latency,attempt:attemptsMade,waitMs:waitedMs}); return fail(res, status, lastError?.message ?? 'No eligible channel for this model', status === 429 ? 'rate_limit_error' : 'server_error', lastError?.code ?? 'no_channel', lastError?.retryAfter ? { 'retry-after': String(lastError.retryAfter) } : {}); }
        pool.markSuccess(selected.id);
        recordPulse(selected, response.status, model);
        if (stream || path === '/v1/responses' && response.headers.get('content-type')?.includes('text/event-stream')) {
          res.statusCode=response.status;
          res.setHeader('content-type',response.headers.get('content-type')||'text/event-stream');
          res.setHeader('cache-control','no-cache');res.setHeader('connection','keep-alive');res.setHeader('x-accel-buffering','no');res.flushHeaders();
          let bytes=0,ttft=null,carry='',outputChars=0,streamStatus=200;
          const streamUsage={},decoder=new TextDecoder();
          const parseLine=line=>{if(!line.startsWith('data:'))return;try{const value=JSON.parse(line.slice(5).trim());if(value.error||value.response?.error||['error','response.failed','response.incomplete'].includes(value.type))streamStatus=502;const usage=value.usage||value.response?.usage;if(usage)Object.assign(streamUsage,usage);else{const delta=value?.choices?.[0]?.delta?.content??value?.choices?.[0]?.text??(value.type==='response.output_text.delta'?value.delta:null);if(typeof delta==='string')outputChars+=delta.length;}}catch{}};
          const waitDrain=()=>new Promise((resolve,reject)=>{
            const cleanup=()=>{res.off('drain',drained);res.off('close',closed);res.off('error',failed);};
            const drained=()=>{cleanup();resolve();};const closed=()=>{cleanup();reject(Object.assign(new Error('Client disconnected'),{status:499}));};const failed=error=>{cleanup();reject(error);};
            res.once('drain',drained);res.once('close',closed);res.once('error',failed);if(res.destroyed)closed();
          });
          try{
            for await(const chunk of response.body||[]){
              if(res.destroyed||upstreamAbort.signal.aborted)throw Object.assign(new Error('Client disconnected'),{status:499});
              if(ttft===null)ttft=Date.now()-started;bytes+=chunk.length;carry+=decoder.decode(chunk,{stream:true});
              const lines=carry.split('\n');carry=lines.pop()||'';for(const line of lines)parseLine(line);
              if(!res.write(chunk))await waitDrain();
            }
            carry+=decoder.decode();if(carry)parseLine(carry);
          }catch(error){streamStatus=res.destroyed||upstreamAbort.signal.aborted||error.status===499?499:502;upstreamAbort.abort();}
          if(!(streamUsage.prompt_tokens??streamUsage.input_tokens))Object.assign(streamUsage,estimateUsage(body,'x'.repeat(outputChars)));
          const latency=Date.now()-started;
          await portal.settle(portalReservation,streamUsage,{status:streamStatus,latency_ms:latency});portalReservation=null;
          metrics.record({model,channel_id:selected.id,channel_name:selected.name,failure:streamStatus>=400,latency_ms:latency,ttft_ms:ttft??latency,input_tokens:streamUsage.input_tokens??streamUsage.prompt_tokens??0,output_tokens:streamUsage.output_tokens??streamUsage.completion_tokens??0,cache_read_tokens:streamUsage.cache_read_tokens??streamUsage.prompt_tokens_details?.cached_tokens??0});
          bump(store.data,key,selected,streamUsage,streamStatus>=400);let streamCost=0;if(streamStatus<400)streamCost=chargeKey(key,model,streamUsage,selected);
          logCall(req,{key,model,channel:selected,prompt:streamUsage.prompt_tokens??streamUsage.input_tokens??0,completion:streamUsage.completion_tokens??streamUsage.output_tokens??0,cost:streamCost,status:streamStatus,error:streamStatus>=400?'Upstream stream failed':'',errorCode:streamStatus>=400?'upstream_error':'',latency,stream:true,attempt:attemptsMade,waitMs:waitedMs});
          await logs.add({key_id:key.id,user_id:key.user_id||null,key_name:key.name,model,channel_name:selected.name,status:streamStatus,latency_ms:latency,prompt_tokens:streamUsage.prompt_tokens??streamUsage.input_tokens??0,completion_tokens:streamUsage.completion_tokens??streamUsage.output_tokens??0,stream:true});
          if(!res.destroyed){if(streamStatus>=400)res.write(`\ndata: ${JSON.stringify(errorBody('Upstream stream failed','server_error','upstream_error'))}\n\n`);res.end();}
          return;
        }
        const firstByte=Date.now()-started; const raw = await response.text(); let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; } const usage = extractUsage(parsed, body, parsed?.choices?.[0]?.message?.content ?? ''); const latency=Date.now()-started;
        await portal.settle(portalReservation,usage,{status:res.destroyed?499:response.status,latency_ms:latency});portalReservation=null;
        metrics.record({model,channel_id:selected.id,channel_name:selected.name,failure:false,latency_ms:latency,ttft_ms:firstByte,input_tokens:usage.input_tokens??usage.prompt_tokens??0,output_tokens:usage.output_tokens??usage.completion_tokens??0,cache_read_tokens:usage.cache_read_tokens??usage.prompt_tokens_details?.cached_tokens??0});
        bump(store.data, key, selected, usage, false); const callCost = chargeKey(key, model, usage, selected); await logs.add({ key_id:key.id,user_id:key.user_id||null,key_name: key.name, model, channel_name: selected.name, status: response.status, latency_ms: latency, prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0, completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0, stream: false });
        logCall(req,{key,model,channel:selected,prompt:usage.prompt_tokens??usage.input_tokens??0,completion:usage.completion_tokens??usage.output_tokens??0,cost:callCost,status:res.destroyed?499:response.status,error:res.destroyed?'Client disconnected':'',errorCode:res.destroyed?'client_closed':'',latency,attempt:attemptsMade,waitMs:waitedMs}); await store.save();
        return json(res, response.status, parsed);
      }
      if (req.method === 'GET' && !path.startsWith('/v1/')) { const name = path === '/' ? 'index.html' : path.slice(1); return serveStatic(res, name); }
      return fail(res, 404, 'Not found', 'invalid_request_error', 'not_found');
    } catch (error) { if(portalReservation)await portal.release(portalReservation).catch(()=>{});if(!res.headersSent&&error.code&&keyPortalError(error))return fail(res,error.status||503,error.message,'account_error',error.code); if (res.headersSent) { process.stderr.write(`response aborted after headers: ${error?.message||error}\n`); res.destroy(error); return; } fail(res, error.status ?? 500, error.status === 413 ? 'Request body exceeds 8MB' : error.status === 400 ? 'Invalid JSON body' : 'Internal server error', error.status === 400 || error.status === 413 ? 'invalid_request_error' : 'server_error'); }
  });
  async function serveStatic(res, name) {
    const root = resolve(here, 'public'); const file = resolve(root, name); if (!file.startsWith(root + sep) && file !== root) return fail(res, 403, 'Forbidden');
    try { const content = await readFile(file); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }; res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache, must-revalidate', 'content-length': content.length }); res.end(content); } catch { fail(res, 404, 'Not found', 'invalid_request_error', 'not_found'); }
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  return { server, port: typeof address === 'object' ? address.port : port, close: async () => { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await metrics.flush(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startRelay({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 8787), dataDir: process.env.DATA_DIR ?? resolve(here, 'data'), adminKey: process.env.RELAY_ADMIN_KEY }).then(({ port }) => process.stdout.write(`Relay listening on ${process.env.HOST ?? '127.0.0.1'}:${port}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
