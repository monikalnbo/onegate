// note: queryable call ledger ("调用记录"). One structured row per /v1 request,
// kept inside relay.json under `calls` (JSON store, no extra DB). Hard rules enforced here:
//   * the full API key / Authorization header is never accepted as an input; only key_id + a
//     short masked hint (`key_hint`, "sk-…" + last 4 chars) is stored;
//   * passwords and verification codes are never part of a row;
//   * IP only comes from nginx's X-Real-IP for local proxies, never from the client body.
const MAX_ROWS = Math.max(1000, Number(process.env.RELAY_CALL_ROWS) || 20000);
const RETENTION_DAYS = Math.max(1, Number(process.env.RELAY_CALL_RETENTION_DAYS) || 90);
const DAY = 86_400_000;
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

export class CallLedger {
  constructor(store, { max = MAX_ROWS, retentionDays = RETENTION_DAYS } = {}) {
    this.store = store; this.max = max; this.retentionDays = retentionDays;
    this.data = store.data;
    if (!Array.isArray(this.data.calls)) this.data.calls = [];
    // Indexes are logical selects over the in-memory array; they are rebuilt on load and are kept
    // in this order because every query starts from a ts range (newest first).
    this.data.calls.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    this.prune();
  }
  prune() {
    const cutoff = Date.now() - this.retentionDays * DAY;
    const calls = this.data.calls;
    let keepFrom = 0;
    while (keepFrom < calls.length && Date.parse(calls[keepFrom].ts) < cutoff) keepFrom++;
    if (keepFrom) calls.splice(0, keepFrom);
    if (calls.length > this.max) calls.splice(0, calls.length - this.max);
    return calls.length;
  }
  async add(row) {
    const ts = row.ts || new Date().toISOString();
    const record = {
      id: row.request_id || clean(row.id, 80) || '',
      ts,
      user_id: row.user_id || null,
      key_id: row.key_id || null,
      key_hint: clean(row.key_hint, 24),
      key_name: clean(row.key_name, 80),
      model: clean(row.model, 120),
      // note: which source served the call, what it was renamed to upstream, and the
      // multiplier that was actually billed (list price × source × key group).
      upstream_model: clean(row.upstream_model, 120),
      channel_id: row.channel_id || null,
      channel_name: clean(row.channel_name, 120),
      source_group: clean(row.source_group, 120),
      source_group_id: row.source_group_id || null,
      prompt_tokens: Math.max(0, Number(row.prompt_tokens) || 0),
      completion_tokens: Math.max(0, Number(row.completion_tokens) || 0),
      total_tokens: Math.max(0, Number(row.total_tokens) || (Number(row.prompt_tokens) || 0) + (Number(row.completion_tokens) || 0)),
      list_cost: Math.round((Number(row.list_cost) || 0) * 1e6) / 1e6,
      cost: Math.round((Number(row.cost) || 0) * 1e6) / 1e6,
      rate_multiplier: Math.round((Number(row.rate_multiplier) || 1) * 1e6) / 1e6,
      source_multiplier: Math.round((Number(row.source_multiplier) || 1) * 1e6) / 1e6,
      group_multiplier: Math.round((Number(row.group_multiplier) || 1) * 1e6) / 1e6,
      wait_ms: Math.max(0, Math.round(Number(row.wait_ms) || 0)),
      latency_ms: Math.max(0, Math.round(Number(row.latency_ms) || 0)),
      status: Math.max(0, Number(row.status) || 0),
      error_code: clean(row.error_code, 80),
      error: clean(row.error, 200),
      ip: clean(row.ip, 45),
      ua: clean(row.ua, 200),
      stream: row.stream === true,
      attempt: Math.max(1, Number(row.attempt) || 1)
    };
    if (!record.id) record.id = `${ts}-${Math.random().toString(36).slice(2, 10)}`;
    this.data.calls.push(record);
    this.prune();
    await this.store.save();
    return record;
  }
  /** Newest-first page with the filters the admin UI exposes. */
  query({ from, to, user, key, model, status, q, channel, source, limit = 50, offset = 0 } = {}) {
    const fromTs = from ? Date.parse(from) : NaN;
    const toTs = to ? Date.parse(to) : NaN;
    const rows = [];
    const calls = this.data.calls;
    for (let i = calls.length - 1; i >= 0; i--) {
      const row = calls[i];
      const ts = Date.parse(row.ts);
      if (!Number.isNaN(fromTs) && ts < fromTs) break; // sorted: everything older is out of range
      if (!Number.isNaN(toTs) && ts > toTs) continue;
      rows.push(row);
    }
    let list = rows;
    if (user) list = list.filter(r => r.user_id === user || r.key_id === user);
    if (key) list = list.filter(r => r.key_id === key);
    if (model) list = list.filter(r => r.model === model || r.upstream_model === model);
    if (channel) list = list.filter(r => r.channel_id === channel || r.channel_name === channel);
    if (source) list = list.filter(r => r.source_group_id === source || r.source_group === source);
    if (status === 'ok') list = list.filter(r => r.status > 0 && r.status < 400);
    else if (status === 'error') list = list.filter(r => r.status >= 400 || r.status === 0);
    else if (status) list = list.filter(r => String(r.status) === String(status) || r.error_code === status);
    if (q) {
      const needle = String(q).toLowerCase();
      list = list.filter(r => `${r.model} ${r.upstream_model} ${r.channel_name} ${r.source_group} ${r.key_name} ${r.key_hint} ${r.error} ${r.error_code} ${r.ip} ${r.id}`.toLowerCase().includes(needle));
    }
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.min(200, Math.max(1, Number(limit) || 50));
    return {
      items: list.slice(start, start + size),
      total: list.length,
      limit: size, offset: start,
      totals: {
        requests: list.length,
        errors: list.filter(r => r.status >= 400 || r.status === 0).length,
        prompt_tokens: list.reduce((s, r) => s + r.prompt_tokens, 0),
        completion_tokens: list.reduce((s, r) => s + r.completion_tokens, 0),
        total_tokens: list.reduce((s, r) => s + r.total_tokens, 0),
        cost: Math.round(list.reduce((s, r) => s + r.cost, 0) * 1e6) / 1e6,
        avg_latency_ms: list.length ? Math.round(list.reduce((s, r) => s + r.latency_ms, 0) / list.length) : 0
      }
    };
  }
  stats() {
    const calls = this.data.calls;
    const oldest = calls.length ? calls[0].ts : null;
    return { rows: calls.length, cap: this.max, retention_days: this.retentionDays, oldest, newest: calls.length ? calls.at(-1).ts : null };
  }
  /** Filters are answered from the stored rows; these lists feed the pickers. */
  facets() {
    const keys = new Map(), models = new Set(), users = new Set(), channels = new Map(), sources = new Map();
    for (const r of this.data.calls) {
      if (r.key_id && !keys.has(r.key_id)) keys.set(r.key_id, { id: r.key_id, label: r.key_name || r.key_hint || r.key_id, hint: r.key_hint });
      if (r.model) models.add(r.model);
      if (r.user_id) users.add(r.user_id);
      if (r.channel_id && !channels.has(r.channel_id)) channels.set(r.channel_id, { id: r.channel_id, name: r.channel_name || r.channel_id });
      if (r.source_group_id && !sources.has(r.source_group_id)) sources.set(r.source_group_id, { id: r.source_group_id, name: r.source_group });
    }
    return { keys: [...keys.values()], models: [...models].sort(), users: [...users], channels: [...channels.values()], source_groups: [...sources.values()] };
  }
}
