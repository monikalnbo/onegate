// Per-channel concurrency guard ("防挤爆").
// A source can carry `max_concurrency` (0 = unlimited), `queue_ms` (how long a request may wait
// for a free slot) and `max_queue` (how many may wait). Requests either run, wait, or get a 429
// with code `concurrency_limit_exceeded` — never silently dropped, never unbounded.
const MAX_SLOTS = 512;
const MAX_QUEUE = 1000;
const MAX_WAIT = 60_000;

export class ConcurrencyLimits {
  constructor() { this.active = new Map(); this.waiting = new Map(); this.stats = new Map(); }

  limitsFor(channel) {
    const max = Math.min(MAX_SLOTS, Math.max(0, Math.floor(Number(channel?.max_concurrency) || 0)));
    if (!max) return null;
    const queueMs = Math.min(MAX_WAIT, Math.max(0, Math.floor(Number(channel?.queue_ms) || 0)));
    const maxQueue = Math.min(MAX_QUEUE, Math.max(0, Math.floor(Number(channel?.max_queue ?? 100) || 0)));
    return { max, queueMs, maxQueue };
  }

  stateFor(id) {
    if (!this.stats.has(id)) this.stats.set(id, { admitted: 0, rejected: 0, timedOut: 0, waits: 0, wait_ms_total: 0, last_wait_ms: 0 });
    return this.stats.get(id);
  }

  acquire(channel) {
    const id = String(channel?.id || '');
    const limit = this.limitsFor(channel);
    if (!limit) return Promise.resolve({ ok: true, lease: { id: null, channelId: id, tracked: false } });
    const active = this.active.get(id) || 0;
    const stats = this.stateFor(id);
    if (active < limit.max) { this.active.set(id, active + 1); stats.admitted++; return Promise.resolve({ ok: true, lease: { id, channelId: id, tracked: true } }); }
    stats.rejected++;
    if (!limit.queueMs || limit.maxQueue === 0) return Promise.resolve(this.rejection(id, limit));
    let queue = this.waiting.get(id);
    if (!queue) { queue = []; this.waiting.set(id, queue); }
    if (queue.length >= limit.maxQueue) return Promise.resolve(this.rejection(id, limit));
    const started = Date.now();
    return new Promise(resolve => {
      const entry = { resolve, done: false };
      const timer = setTimeout(() => {
        if (entry.done) return;
        entry.done = true;
        const list = this.waiting.get(id) || [];
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
        const wait = Date.now() - started;
        stats.timedOut++; stats.waits++; stats.wait_ms_total += wait; stats.last_wait_ms = wait;
        resolve({ ok: false, status: 429, code: 'concurrency_limit_exceeded', message: `模型来源「${channel?.name || id}」并发已满，排队 ${Math.round(wait)}ms 后仍未腾出名额`, retry_after: Math.ceil(Math.max(1000, limit.queueMs) / 1000) });
      }, limit.queueMs);
      entry.grant = () => {
        if (entry.done) return;
        entry.done = true; clearTimeout(timer);
        const wait = Date.now() - started;
        stats.admitted++; stats.waits++; stats.wait_ms_total += wait; stats.last_wait_ms = wait;
        this.active.set(id, (this.active.get(id) || 0) + 1);
        resolve({ ok: true, lease: { id, channelId: id, tracked: true, waited_ms: wait } });
      };
      queue.push(entry);
    });
  }

  rejection(id, limit) {
    return { ok: false, status: 429, code: 'concurrency_limit_exceeded', message: `模型来源并发已达上限 ${limit.max}，已拒绝本次请求`, retry_after: 1 };
  }

  release(lease) {
    if (!lease || !lease.tracked || lease.released) return;
    lease.released = true;
    const id = lease.id;
    if (!id) return;
    this.active.set(id, Math.max(0, (this.active.get(id) || 0) - 1));
    const queue = this.waiting.get(id);
    if (queue && queue.length) {
      const next = queue.shift();
      if (next && typeof next.grant === 'function') next.grant();
    }
  }

  snapshot(channel) {
    const id = String(channel?.id || '');
    const limit = this.limitsFor(channel);
    const stats = this.stateFor(id);
    return {
      max_concurrency: limit ? limit.max : 0,
      queue_ms: limit ? limit.queueMs : 0,
      max_queue: limit ? limit.maxQueue : 0,
      active: this.active.get(id) || 0,
      waiting: (this.waiting.get(id) || []).length,
      admitted: stats.admitted, rejected: stats.rejected, timed_out: stats.timedOut,
      avg_wait_ms: stats.waits ? Math.round(stats.wait_ms_total / stats.waits) : 0,
      last_wait_ms: stats.last_wait_ms
    };
  }
}
