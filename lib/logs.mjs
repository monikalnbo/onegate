export class LogBuffer {
  constructor(store, max = 500) { this.store = store; this.max = max; this.items = [...(store.data.logs ?? [])].slice(-max); }
  async add(item) { this.items.push({ ts: new Date().toISOString(), ...item }); if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max); this.store.data.logs = this.items.slice(-200); await this.store.save(); return this.items.at(-1); }
  list(limit = 100) { return this.items.slice(-Math.max(0, Math.min(500, Number(limit) || 100))).reverse(); }
}
