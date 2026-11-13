import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export class Pricing {
  constructor(file) { this.file = file; this.table = {}; }
  async load() { try { this.table = JSON.parse(await readFile(this.file, 'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; } if (!this.table || Array.isArray(this.table) || typeof this.table !== 'object') throw new Error('Pricing table must be an object'); return this; }
  async set(table) { if (!table || Array.isArray(table) || typeof table !== 'object') throw Object.assign(new Error('Pricing must be a JSON object'), {status:400}); for (const [model, rates] of Object.entries(table)) { if (!model || !rates || typeof rates !== 'object' || Array.isArray(rates) || !['in','out','cache'].every(k => Number.isFinite(Number(rates[k])) && Number(rates[k]) >= 0)) throw Object.assign(new Error(`Invalid pricing for ${model}`), {status:400}); } await mkdir(dirname(this.file), {recursive:true}); await writeFile(this.file, JSON.stringify(table,null,2), {mode:0o600}); this.table=table; return table; }
  estimate(model, usage={}) { const r=this.table[model] || {}; return (Number(usage.input_tokens||usage.prompt_tokens||0)*Number(r.in||0)+Number(usage.output_tokens||usage.completion_tokens||0)*Number(r.out||0)+Number(usage.cache_read_tokens||0)*Number(r.cache||0))/1_000_000; }
}
