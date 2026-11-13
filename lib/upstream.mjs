// 上游请求层：把一条通道（官方 API 或反代端点）变成一次可用的 HTTP 调用
// 反代适配要点：路径前缀可配、自定义请求头可配、返回体可能没有 usage、错误体可能不规范

export class UpstreamError extends Error {
  constructor(message, status = 502, code = 'upstream_error', retriable = true) {
    super(message);
    this.status = status;
    this.code = code;
    this.retriable = retriable;
  }
}

export const errorBody = (message, type = 'server_error', code = null) => ({ error: { message, type, code } });

/**
 * 拼出真正要请求的 URL：
 * - base_url 以 /v1 结尾时去掉重复的 /v1（官方 API 常见）
 * - path_prefix 用于反代挂在子路径的情况（如 /openai、/api/openai/v1）
 */
export function buildUrl(channel, path) {
  const base = String(channel.base_url || '').replace(/\/+$/, '');
  const prefix = String(channel.path_prefix || '').replace(/^\/+|\/+$/g, '');
  const endpoint = path.startsWith('/') ? path : `/${path}`;
  let tail = endpoint;
  if (base.endsWith('/v1') && tail.startsWith('/v1/')) tail = tail.slice(3);
  const mid = prefix ? `/${prefix}` : '';
  // 前缀本身可能已经带 v1（反代常见 /openai/v1），与 tail 的 /v1 去重
  return `${base}${mid}${tail}`.replace(/(\/v1)+(?=\/)/g, '/v1');
}

/** 通道自定义请求头（反代常要 x-api-key、自定义 UA、Referer 等） */
export function channelHeaders(channel) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${channel.api_key}` };
  const custom = channel.headers && typeof channel.headers === 'object' ? channel.headers : {};
  for (const [rawKey, rawValue] of Object.entries(custom)) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (lower === 'content-length' || lower === 'host' || lower === 'connection') continue;
    headers[lower] = String(rawValue ?? '');
  }
  return headers;
}

export async function requestUpstream(channel, path, body, { signal, timeout = 300_000, method = 'POST' } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const url = buildUrl(channel, path);
  try {
    return await fetch(url, {
      method,
      headers: channelHeaders(channel),
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal: requestSignal
    });
  } catch (error) {
    if (signal?.aborted) throw new UpstreamError('Client disconnected', 499, 'client_closed', false);
    const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    throw new UpstreamError(timedOut ? 'Upstream request timed out' : 'Could not connect to upstream', 502, 'upstream_error', true);
  }
}

export function retryableStatus(status) {
  return status === 429 || status >= 500;
}

export async function responseError(response) {
  let message = `上游返回 HTTP ${response.status}`;
  try {
    const text = await response.clone().text();
    try {
      const data = JSON.parse(text);
      message = data?.error?.message ?? data?.message ?? data?.msg ?? data?.detail ?? message;
    } catch {
      // 反代有时直接返回 HTML / 纯文本错误页
      const flat = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (flat) message = `${message}：${flat.slice(0, 160)}`;
    }
  } catch { /* 读不出就用状态码 */ }
  return new UpstreamError(message, response.status, 'upstream_error', retryableStatus(response.status));
}

/** 上游没给 usage（反代常见）时按字符估算，误差约 ±20%，日志里标 estimated */
export function estimateUsage(body, text) {
  const promptChars = JSON.stringify(body?.messages ?? body?.input ?? '').length;
  const outputChars = String(text ?? '').length;
  const prompt = Math.max(1, Math.round(promptChars / 3.6));
  const completion = Math.max(0, Math.round(outputChars / 3.6));
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, estimated: true };
}

/** 取上游 usage；取不到就估算 */
export function extractUsage(parsed, body, fallbackText = '') {
  const usage = parsed?.usage ?? parsed?.usage_metadata ?? null;
  if (usage && (usage.prompt_tokens ?? usage.input_tokens) != null) {
    return {
      prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
      cache_read_tokens: usage.cache_read_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
      estimated: false
    };
  }
  const text = fallbackText || parsed?.choices?.[0]?.message?.content || parsed?.output_text || '';
  return { ...estimateUsage(body, text), cache_read_tokens: 0 };
}
