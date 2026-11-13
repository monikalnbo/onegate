import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const empty = () => ({ buckets: {} });
const blank = () => ({ requests: 0, failures: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, latency_ms: 0, latency_samples: 0, latency_values: [], ttft_ms: 0, ttft_samples: 0 });
const hourKey = ts => new Date(ts).toISOString().slice(0, 13) + ':00:00.000Z';
const inc = (row, event) => {
  row.requests++; if (event.failure) row.failures++;
  row.input_tokens += Number(event.input_tokens || 0); row.output_tokens += Number(event.output_tokens || 0); row.cache_read_tokens += Number(event.cache_read_tokens || 0);
  if (Number.isFinite(Number(event.latency_ms))) { const n = Math.max(0, Number(event.latency_ms)); row.latency_ms += n; row.latency_samples++; row.latency_values.push(n); if (row.latency_values.length > 500) row.latency_values.shift(); }
  if (Number.isFinite(Number(event.ttft_ms))) { row.ttft_ms += Math.max(0, Number(event.ttft_ms)); row.ttft_samples++; }
};
const ensure = (obj, id) => obj[id] ??= blank();
const prune = buckets => { const cutoff = Date.now() - 30 * 86400_000; for (const [key, value] of Object.entries(buckets)) { if (Date.parse(key) < cutoff) delete buckets[key]; else { for (const group of ['models', 'channels']) for (const row of Object.values(value[group] ?? {})) if (!Array.isArray(row.latency_values)) row.latency_values = []; } } };

export class Metrics {
  constructor(file) { this.file = file; this.data = empty(); this.timer = null; this.queue = Promise.resolve(); }
  async load() { try { const data = JSON.parse(await readFile(this.file, 'utf8')); this.data = { ...empty(), ...data }; } catch (e) { if (e.code !== 'ENOENT') throw e; } prune(this.data.buckets); return this; }
  record(event) {
    const ts = event.ts ?? new Date().toISOString(), key = hourKey(ts), bucket = this.data.buckets[key] ??= { ...blank(), models: {}, channels: {} };
    inc(bucket, event); inc(ensure(bucket.models, event.model || 'unknown'), event);
    const channelId = String(event.channel_id || event.channel || 'unknown'); const channel = ensure(bucket.channels, channelId); inc(channel, event); channel.id = channelId; channel.name = event.channel_name || channel.name || channelId;
    prune(this.data.buckets); clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(error => process.stderr.write(`Metrics flush failed: ${error.message}\n`)), 500); this.timer.unref?.();
  }
  async flush() { clearTimeout(this.timer); this.timer = null; const snapshot = JSON.stringify(this.data); this.queue = this.queue.then(async () => { await mkdir(dirname(this.file), { recursive: true }); const temp = `${this.file}.${randomUUID()}.tmp`; await writeFile(temp, snapshot, { mode: 0o600 }); await rename(temp, this.file); }); return this.queue; }
  range(range = '24h', bucket = 'hour') {
    const hours = range === '7d' ? 168 : range === '30d' ? 720 : 24; const step = bucket === 'day' ? 24 : 1; const now = Date.now(), start = Math.floor(now / 3600_000) * 3600_000 - (hours - 1) * 3600_000;
    const slots = [], slotBuckets = []; for (let t = start; t <= now; t += step * 3600_000) { const end = t + step * 3600_000, keys = Object.keys(this.data.buckets).filter(k => Date.parse(k) >= t && Date.parse(k) < end); const row = blank(), channels = {}; for (const key of keys) { const value=this.data.buckets[key]; combine(row, value); for (const [id, item] of Object.entries(value.channels||{})) { const target=channels[id]??={...blank(),id,name:item.name||id}; combine(target,item); } } slots.push({ t: new Date(t).toISOString(), ...pick(row) }); slotBuckets.push(channels); }
    const all = blank(); for (const value of Object.values(this.data.buckets)) combine(all, value);
    const modelMap = new Map(), channelMap = new Map(); for (const value of Object.values(this.data.buckets)) { for (const [id, row] of Object.entries(value.models || {})) { const target = modelMap.get(id) ?? blank(); combine(target, row); modelMap.set(id, target); } for (const [id, row] of Object.entries(value.channels || {})) { const target = channelMap.get(id) ?? { ...blank(), id, name: row.name || id, spark: [] }; combine(target, row); target.id = id; target.name = row.name || target.name; channelMap.set(id, target); } }
    const today = Object.entries(this.data.buckets).filter(([k]) => k.slice(0, 10) === new Date().toISOString().slice(0, 10)).reduce((a, [,v]) => (combine(a,v),a), blank());
    const todayModels = new Map(); for (const [k, v] of Object.entries(this.data.buckets)) { if (k.slice(0, 10) !== new Date().toISOString().slice(0, 10)) continue; for (const [id, row] of Object.entries(v.models || {})) { const target = todayModels.get(id) ?? blank(); combine(target, row); todayModels.set(id, target); } }
    const selected = blank(), selectedLatencies=[]; for (const [key,value] of Object.entries(this.data.buckets)) { const stamp=Date.parse(key); if(stamp>=start&&stamp<now+3600_000) { combine(selected,value); selectedLatencies.push(...(value.latency_values||[])); } }
    const rangeModels = new Map(), rangeChannels = new Map(); for (const [key, value] of Object.entries(this.data.buckets)) { const stamp=Date.parse(key); if (stamp < start || stamp >= now + 3600_000) continue; for (const [id,row] of Object.entries(value.models||{})) { const target=rangeModels.get(id)??blank(); combine(target,row); rangeModels.set(id,target); } for (const [id,row] of Object.entries(value.channels||{})) { const target=rangeChannels.get(id)??{...blank(),id,name:row.name||id}; combine(target,row); rangeChannels.set(id,target); } }
    return { series: slots.map(pickSeries), models: [...rangeModels].map(([model, v]) => ({ model, requests: v.requests, ratio: selected.requests ? v.requests / selected.requests : 0, input_tokens: v.input_tokens, output_tokens: v.output_tokens, cache_read_tokens: v.cache_read_tokens })).sort((a,b)=>b.requests-a.requests), channels: [...rangeChannels.values()].map(v => ({ id:v.id, name:v.name, requests:v.requests, tokens:v.input_tokens+v.output_tokens+v.cache_read_tokens, failures:v.failures, avg_latency:v.latency_samples?Math.round(v.latency_ms/v.latency_samples):0, spark: slotBuckets.slice(-12).map(group=>group[v.id]?.requests||0) })), totals: { requests: selected.requests, failures: selected.failures, avg_latency: selected.latency_samples ? Math.round(selected.latency_ms/selected.latency_samples) : 0, p95_latency: percentile(selectedLatencies, .95), input_tokens: selected.input_tokens, output_tokens: selected.output_tokens, cache_read_tokens: selected.cache_read_tokens, today_requests: today.requests, today_failures: today.failures, today_tokens: today.input_tokens+today.output_tokens+today.cache_read_tokens, today_input_tokens:today.input_tokens, today_output_tokens:today.output_tokens, today_cache_read_tokens:today.cache_read_tokens, all_requests: all.requests, all_failures:all.failures, all_tokens: all.input_tokens+all.output_tokens+all.cache_read_tokens, today_models: [...todayModels].map(([model, v]) => ({ model, input_tokens: v.input_tokens, output_tokens: v.output_tokens, cache_read_tokens: v.cache_read_tokens })) } };
  }
}
function combine(a,b) { for (const k of ['requests','failures','input_tokens','output_tokens','cache_read_tokens','latency_ms','latency_samples','ttft_ms','ttft_samples']) a[k] = Number(a[k]||0)+Number(b[k]||0); a.latency_values = [...(a.latency_values||[]), ...(b.latency_values||[])].slice(-500); return a; }
function percentile(values, p) { if (!values?.length) return 0; const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]; }
const pick = r => ({ requests:r.requests, failures:r.failures, input_tokens:r.input_tokens, output_tokens:r.output_tokens, cache_read_tokens:r.cache_read_tokens, latency_ms:r.latency_ms });
const pickSeries = r => ({ t:r.t, ...pick(r) });
