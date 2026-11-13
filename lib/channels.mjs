export class ChannelPool {
  constructor() { this.current = new Map(); this.failures = new Map(); this.cooldowns = new Map(); }
  eligible(channels, model) {
    const now = Date.now();
    return channels.filter(c => c.enabled !== false && Array.isArray(c.models) && (c.models.includes('*') || c.models.includes(model)) && (this.cooldowns.get(c.id) ?? 0) <= now);
  }
  select(channels, model, excluded = new Set()) {
    const choices = this.eligible(channels, model).filter(c => !excluded.has(c.id));
    if (!choices.length) return null;
    let state = this.current.get(model);
    if (!state) { state = new Map(); this.current.set(model, state); }
    let total = 0; let selected; let best = -Infinity;
    for (const c of choices) { const weight = Math.max(1, Number(c.weight) || 1); const value = (state.get(c.id) ?? 0) + weight; state.set(c.id, value); total += weight; if (value > best) { best = value; selected = c; } }
    state.set(selected.id, (state.get(selected.id) ?? 0) - total);
    return selected;
  }
  markSuccess(id) { this.failures.delete(id); this.cooldowns.delete(id); }
  markFailure(id) { const count = (this.failures.get(id) ?? 0) + 1; this.failures.set(id, count); this.cooldowns.set(id, Date.now() + Math.min(300_000, 30_000 * (2 ** (count - 1)))); }
  remaining(id) { return Math.max(0, (this.cooldowns.get(id) ?? 0) - Date.now()); }
}
