import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const defaults = () => ({ channels: [], keys: [], logs: [], stats: { keys: {}, channels: {} }, groups: [], redeem: [], announcements: [], audit: [] });

export class Store {
  constructor(file, encryptionKey = null) { this.file = file; this.encryptionKey = encryptionKey; this.data = defaults(); this.queue = Promise.resolve(); }
  async load() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      this.data = { ...defaults(), ...JSON.parse(await readFile(this.file, 'utf8')) };
      for (const channel of this.data.channels ?? []) if (channel.api_key_enc && this.encryptionKey) channel.api_key = this.decrypt(channel.api_key_enc);
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; await this.save(); }
    if (!Array.isArray(this.data.channels)) this.data.channels = [];
    if (!Array.isArray(this.data.keys)) this.data.keys = [];
    if (!Array.isArray(this.data.logs)) this.data.logs = [];
    if (!Array.isArray(this.data.groups)) this.data.groups = [];
    if (!Array.isArray(this.data.redeem)) this.data.redeem = [];
    if (!Array.isArray(this.data.announcements)) this.data.announcements = [];
    if (!Array.isArray(this.data.audit)) this.data.audit = [];
    this.data.stats ??= { keys: {}, channels: {} };
    return this;
  }
  async save() {
    const op = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      const snapshot = structuredClone(this.data);
      for (const channel of snapshot.channels ?? []) {
        if (channel.api_key && this.encryptionKey) { channel.api_key_enc = this.encrypt(channel.api_key); delete channel.api_key; }
      }
      await writeFile(temp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, this.file);
    });
    this.queue = op.catch(() => {});
    return op;
  }
  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
  }
  decrypt(value) {
    const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
  async mutate(fn) { return this.queue.then(async () => { const result = await fn(this.data); await this.save(); return result; }); }
}

export function newId() { return randomUUID(); }
