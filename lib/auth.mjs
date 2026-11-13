import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const token = () => `sk-relay-${randomBytes(18).toString('base64url').replace(/[-_]/g, 'A').slice(0, 24)}`;
export const mask = value => { if (!value) return ''; const str = String(value); return `sk-\u2026${str.slice(-4)}`; };
const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export class Auth {
  constructor(adminKey) { this.adminKey = adminKey; this.sessions = new Map(); this.loginFailures = new Map(); this.rpm = new Map(); }
  login(ip, key) {
    const state = this.loginFailures.get(ip) ?? { count: 0, until: 0 };
    if (state.until > Date.now()) return { ok: false, locked: true };
    if (!safeEqual(key ?? '', this.adminKey)) { state.count++; if (state.count >= 5) { state.count = 0; state.until = Date.now() + 300_000; } this.loginFailures.set(ip, state); return { ok: false }; }
    this.loginFailures.delete(ip); const sid = randomBytes(32).toString('hex'); this.sessions.set(sid, Date.now() + 86_400_000); return { ok: true, sid };
  }
  validSession(cookie = '') { const sid = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('relay_session='))?.slice(14); const expiry = this.sessions.get(sid); if (!expiry || expiry < Date.now()) { if (sid) this.sessions.delete(sid); return false; } return true; }
  logout(cookie = '') { const sid = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('relay_session='))?.slice(14); if (sid) this.sessions.delete(sid); }
  verifyKey(header, keys) { const candidate = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1]; if (!candidate) return null; const digest = sha256(candidate); return keys.find(k => k.enabled !== false && safeEqual(k.key_hash ?? '', digest)) ?? null; }
  limit(key) { if (!(Number(key.rpm) > 0)) return { ok: true }; const now = Date.now(); const list = (this.rpm.get(key.id) ?? []).filter(t => t > now - 60_000); if (list.length >= Number(key.rpm)) { this.rpm.set(key.id, list); return { ok: false, retry: Math.max(1, Math.ceil((list[0] + 60_000 - now) / 1000)) }; } list.push(now); this.rpm.set(key.id, list); return { ok: true }; }
}
