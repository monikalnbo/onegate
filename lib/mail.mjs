import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

const HEADER_CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/u;
const MAX_BODY_BYTES = 256 * 1024;
const own = (object, key) => Object.hasOwn(object, key);
const error = (status, message, code) => Object.assign(new Error(message), { status, code });
const invalid = message => error(400, message, 'mail_invalid_input');
const unavailable = () => error(503, '邮件服务尚未配置并验证。', 'mail_not_ready');

function headerString(value, label, limit, { optional = false } = {}) {
  if (typeof value !== 'string' || HEADER_CONTROL.test(value) || value.length > limit) throw invalid(`${label}格式不正确。`);
  const clean = value.trim();
  if (!clean && !optional) throw invalid(`请填写${label}。`);
  return clean;
}

function domain(value) {
  const ascii = domainToASCII(value).toLowerCase();
  if (!ascii || ascii.length > 253 || isIP(ascii) || !ascii.includes('.')) return false;
  const labels = ascii.split('.');
  return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && !/^\d+$/.test(labels.at(-1));
}

function smtpHost(value, optional = false) {
  const clean = headerString(value, 'SMTP 主机', 253, { optional });
  if (!clean && optional) return '';
  if (/[/:\\@\s]/.test(clean) || !domain(clean)) throw invalid('SMTP 主机应为完整域名。');
  return domainToASCII(clean).toLowerCase();
}

function email(value, label = '邮箱', optional = false) {
  const clean = headerString(value, label, 254, { optional });
  if (!clean && optional) return '';
  const parts = clean.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !domain(parts[1]) ||
      !/^[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.]+$/.test(parts[0]) || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) {
    throw invalid(`${label}应为单个有效邮箱地址。`);
  }
  return `${parts[0]}@${domainToASCII(parts[1]).toLowerCase()}`;
}

function defaults(source = {}) {
  return {
    enabled: source.enabled === true,
    host: typeof source.host === 'string' ? source.host : '',
    port: source.port === 587 ? 587 : 465,
    secure: source.port === 587 ? false : true,
    username: typeof source.username === 'string' ? source.username : '',
    from: typeof source.from === 'string' ? source.from : '',
    fromName: typeof source.fromName === 'string' ? source.fromName : 'OneGate',
    pass_enc: typeof source.pass_enc === 'string' ? source.pass_enc : '',
    verified_hash: typeof source.verified_hash === 'string' ? source.verified_hash : '',
    last_verified_at: typeof source.last_verified_at === 'string' ? source.last_verified_at : null,
    last_test_at: typeof source.last_test_at === 'string' ? source.last_test_at : null
  };
}

function fingerprint(config) {
  return createHash('sha256').update(JSON.stringify({
    enabled: config.enabled, host: config.host, port: config.port, secure: config.secure,
    username: config.username, from: config.from, fromName: config.fromName, pass_enc: config.pass_enc
  })).digest('hex');
}

function validate(config, complete = false) {
  const must = complete || config.enabled;
  config.host = smtpHost(config.host, !must);
  config.username = headerString(config.username, 'SMTP 用户名', 254, { optional: !must });
  config.from = email(config.from, '发件邮箱', !must);
  config.fromName = headerString(config.fromName, '发件人名称', 100, { optional: true });
  if (![465, 587].includes(config.port) || config.secure !== (config.port === 465)) throw invalid('SMTP 仅支持 465 加密连接或 587 STARTTLS。');
  if (must && !config.pass_enc) throw invalid('请填写 SMTP 密码或授权码。');
  return config;
}

/**
 * Uses only the supplied encrypted Store. The optional transport factory exists
 * for isolated tests; production uses nodemailer without logger/debug output.
 */
export function createMailer({ store, dataDir, origin = 'https://example.com', createTransport } = {}) {
  if (!store?.data || typeof store.save !== 'function' || typeof store.encrypt !== 'function' || typeof store.decrypt !== 'function') {
    throw error(503, '邮件配置需要可用的加密存储。', 'mail_encryption_required');
  }
  const transportFactory = createTransport || (options => nodemailer.createTransport(options));
  if (typeof transportFactory !== 'function') throw error(503, '邮件传输服务未就绪。', 'mail_transport_unavailable');
  let saveQueue = Promise.resolve();
  let publicOrigin;
  try {
    const parsed = new URL(origin);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    publicOrigin = parsed.origin;
  } catch { throw invalid('网站地址格式不正确。'); }
  // dataDir is part of the integration contract; persistence belongs to Store.
  void dataDir;

  const current = () => defaults(store.data.mail);
  function queue(operation) {
    const next = saveQueue.then(operation);
    saveQueue = next.catch(() => {});
    return next;
  }
  async function persist(config) {
    const previous = store.data.mail;
    store.data.mail = config;
    try { await store.save(); }
    catch {
      store.data.mail = previous;
      throw error(503, '邮件配置保存失败，请重试。', 'mail_config_save_failed');
    }
  }
  function password(config) {
    try {
      const value = store.decrypt(config.pass_enc);
      if (typeof value !== 'string' || !value || HEADER_CONTROL.test(value) || value.length > 4096) throw new Error();
      return value;
    } catch { throw unavailable(); }
  }
  function configured(config) {
    try { validate({ ...config }, true); password(config); return true; }
    catch { return false; }
  }
  function readyNow(config = current()) {
    return config.enabled && configured(config) && !!config.last_verified_at && config.verified_hash === fingerprint(config);
  }
  function getConfig() {
    const config = current();
    const sameVerification = config.verified_hash === fingerprint(config);
    return {
      enabled: config.enabled, host: config.host, port: config.port, secure: config.secure,
      username: config.username, from: config.from, fromName: config.fromName,
      password_configured: !!config.pass_enc,
      ready: readyNow(config),
      last_verified_at: sameVerification ? config.last_verified_at : null,
      last_test_at: config.last_test_at
    };
  }
  async function ready() { await saveQueue; return readyNow(); }

  async function saveConfig(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('邮件配置格式不正确。');
    return queue(async () => {
      const old = current(), next = { ...old };
      for (const name of ['host', 'username', 'from', 'fromName']) if (own(input, name)) next[name] = input[name];
      if (own(input, 'enabled')) {
        if (typeof input.enabled !== 'boolean') throw invalid('启用状态格式不正确。');
        next.enabled = input.enabled;
      }
      if (own(input, 'port')) {
        next.port = Number(input.port);
        if (![465, 587].includes(next.port)) throw invalid('SMTP 端口仅支持 465 或 587。');
        if (!own(input, 'secure')) next.secure = next.port === 465;
      }
      if (own(input, 'secure')) {
        if (typeof input.secure !== 'boolean') throw invalid('SMTP 加密方式格式不正确。');
        next.secure = input.secure;
      }
      if (own(input, 'password')) {
        if (typeof input.password !== 'string' || input.password.length > 4096 || HEADER_CONTROL.test(input.password)) throw invalid('SMTP 密码或授权码格式不正确。');
        if (input.password) {
          try {
            const encrypted = store.encrypt(input.password);
            if (typeof encrypted !== 'string' || !encrypted || encrypted === input.password || store.decrypt(encrypted) !== input.password) throw new Error();
            next.pass_enc = encrypted;
          } catch { throw error(503, '邮件密码加密失败，请检查加密存储。', 'mail_encryption_failed'); }
        }
      }
      validate(next);
      if (fingerprint(old) !== fingerprint(next)) {
        next.verified_hash = '';
        next.last_verified_at = null;
        next.last_test_at = null;
      }
      await persist(next);
      return getConfig();
    });
  }

  function transport(config) {
    return transportFactory({
      host: config.host, port: config.port, secure: config.port === 465,
      requireTLS: config.port === 587, ignoreTLS: false,
      auth: { user: config.username, pass: password(config) },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: config.host },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
      logger: false, debug: false, pool: false,
      disableFileAccess: true, disableUrlAccess: true
    });
  }
  function close(client) { try { client?.close?.(); } catch { /* Closing cannot disclose an SMTP error. */ } }

  async function verify() {
    await saveQueue;
    const snapshot = current();
    if (!configured(snapshot)) throw unavailable();
    const revision = fingerprint(snapshot);
    let client;
    try {
      client = transport(snapshot);
      const ok = await client.verify();
      if (ok !== true) throw new Error();
    } catch {
      await queue(async () => {
        const config = current();
        if (fingerprint(config) === revision) {
          config.verified_hash = ''; config.last_verified_at = null;
          await persist(config);
        }
      });
      throw error(502, 'SMTP 验证失败，请检查服务器、凭据与加密方式。', 'mail_verify_failed');
    } finally { close(client); }
    return queue(async () => {
      const config = current();
      if (fingerprint(config) !== revision) throw error(409, '邮件配置已更新，请重新验证。', 'mail_config_changed');
      config.verified_hash = revision;
      config.last_verified_at = new Date().toISOString();
      await persist(config);
      return { ok: true, config: getConfig() };
    });
  }

  async function deliver(input, isTest = false) {
    const recipient = email(input?.to, '收件邮箱');
    const subject = headerString(input?.subject, '邮件主题', 200);
    for (const name of ['text', 'html']) {
      if (input[name] !== undefined && (typeof input[name] !== 'string' || Buffer.byteLength(input[name], 'utf8') > MAX_BODY_BYTES)) throw invalid('邮件正文格式不正确或内容过长。');
    }
    if (!input.text?.trim() && !input.html?.trim()) throw invalid('邮件正文不能为空。');
    if (input.purpose !== undefined && (typeof input.purpose !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.purpose))) throw invalid('邮件用途格式不正确。');
    await saveQueue;
    const snapshot = current();
    if (!readyNow(snapshot)) throw unavailable();
    const revision = fingerprint(snapshot);
    let client;
    try {
      client = transport(snapshot);
      const result = await client.sendMail({
        from: { name: snapshot.fromName, address: snapshot.from },
        to: { address: recipient },
        envelope: { from: snapshot.from, to: [recipient] },
        subject, text: input.text, html: input.html,
        disableFileAccess: true, disableUrlAccess: true
      });
      if (!Array.isArray(result?.accepted) || !result.accepted.length || result.rejected?.length) throw new Error();
    } catch { throw error(502, '邮件发送失败，请稍后重试或检查发信配置。', 'mail_send_failed'); }
    finally { close(client); }
    if (isTest) await queue(async () => {
      const config = current();
      if (fingerprint(config) === revision) {
        config.last_test_at = new Date().toISOString();
        await persist(config);
      }
    });
    return { ok: true };
  }
  async function send(input) { return deliver(input); }
  async function sendTest(to) {
    const recipient = email(to, '测试收件邮箱');
    return deliver({
      to: recipient, subject: 'OneGate 邮件服务测试', purpose: 'admin-test',
      text: `这是一封由管理员主动发送的邮件服务测试。\n\n网站：${publicOrigin}\n\n如果你未请求这次测试，可以忽略这封邮件。`
    }, true);
  }
  return { ready, send, getConfig, saveConfig, verify, sendTest };
}
