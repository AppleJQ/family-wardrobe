import { isIP } from 'node:net';
import { AuthService } from './auth-service';
import { Identity, Input } from './model';
import { BusinessError } from './service';
import { wechatUserId } from './identity';

const MAX_BODY_BYTES = 1024 * 1024;
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
const actions: Record<string, readonly string[]> = {
  updates: ['check'],
  auth: ['register', 'login', 'logout', 'me', 'bind'],
  bootstrapUser: ['bootstrap', 'home'],
  families: ['create', 'get', 'rename', 'remove', 'transfer', 'leave'],
  familyInvites: ['create', 'revoke', 'preview', 'accept'],
  members: ['list', 'create', 'rename'],
  garments: ['beginUpload', 'save', 'upload', 'list', 'get', 'image', 'photoBase64', 'update', 'delete'],
  wardrobe: ['status', 'home', 'list', 'batchUpdate', 'batchDelete', 'trash', 'restore', 'purge',
    'locations.list', 'locations.create', 'locations.update', 'locations.delete',
    'outfits.list', 'outfits.get', 'outfits.create', 'outfits.update', 'outfits.delete', 'exportPage'],
  ai: ['status', 'recognize', 'recognizePhoto', 'recommend', 'get', 'list'],
  cutout: ['get', 'process', 'apply', 'getPhoto', 'processPhoto'],
};
function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('INVALID_INPUT', '请求格式无效');
  return value as Input;
}
function rpc(value: unknown, wechatEvent = false) {
  const input = object(value);
  // wx.cloud.callFunction injects userInfo and tcbContext. Ignore these only in
  // Event mode; identity always comes from getWXContext even if either is forged.
  if (Object.keys(input).some(key => !['group', 'action', 'data'].includes(key)
    && !(wechatEvent && ['userInfo', 'tcbContext'].includes(key)))) return fail('INVALID_INPUT', '请求字段无效');
  const { group, action } = input;
  if (typeof group !== 'string' || !Object.prototype.hasOwnProperty.call(actions, group) || typeof action !== 'string'
    || !actions[group].includes(action)) return fail('INVALID_ACTION', '暂不支持此操作');
  const data = input.data === undefined ? {} : object(input.data);
  // userId is only a *target* in these two existing owner-only operations.
  // Authentication always comes from the verified principal, never this target field.
  const targetUserId = group === 'families' && ['remove', 'transfer'].includes(action);
  if (Object.keys(data).some(key => ['openid', 'appid', 'source', 'role', 'identity', 'principal', '__proto__', 'constructor', 'prototype', 'action'].includes(key)
    || (key === 'userId' && !targetUserId))) return fail('INVALID_INPUT', '请求包含无效身份字段');
  if (group === 'auth' && Buffer.byteLength(JSON.stringify(data), 'utf8') > 4096) return fail('PAYLOAD_TOO_LARGE', '请求过大');
  return { group, action, data };
}
function errorResponse(error: unknown) {
  if (error instanceof BusinessError) return { ok: false as const, error: { code: error.code, message: error.message } };
  // Do not log input, raw errors, credentials, tokens, images or context.
  console.error('WARDROBE_GATEWAY_FAILED');
  return { ok: false as const, error: { code: 'INTERNAL_ERROR', message: '云端暂时不可用，请稍后重试' } };
}
function status(code: string) {
  if (code === 'UNAUTHENTICATED' || code === 'AUTH_FAILED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'PAYLOAD_TOO_LARGE') return 413;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'INTERNAL_ERROR') return 500;
  return 400;
}
export function configuredOrigins(value: string): string[] {
  return [...new Set(value.split(',').map(origin => origin.trim()).filter(Boolean))].map(origin => {
    const parsed = new URL(origin);
    if (origin.includes('*') || !['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) throw new Error('INVALID_GATEWAY_ORIGIN');
    return origin;
  });
}
export function createGateway(options: {
  auth: AuthService;
  dispatch: (group: string, data: Input, identity: Identity) => Promise<unknown>;
  allowedOrigins: readonly string[];
  wxIdentity: () => Identity;
  clientIp?: () => string;
  updates?: (data: Input) => unknown;
}) {
  return async (event: Input) => {
    const isHttp = typeof event?.httpMethod === 'string';
    if (!isHttp) {
      try {
        const request = rpc(event, true);
        // Event mode exists only to bind/inspect the current trusted WeChat account.
        if (request.group !== 'auth' || !['bind', 'me'].includes(request.action)) return fail('FORBIDDEN', '请使用对应业务云函数');
        const identity = options.wxIdentity(), userId = wechatUserId(identity);
        if (!userId) return fail('UNAUTHENTICATED', '仅支持本小程序的微信登录');
        const serialized = JSON.stringify(event);
        if (Buffer.byteLength(serialized, 'utf8') > 4096) return fail('PAYLOAD_TOO_LARGE', '请求过大');
        return { ok: true, data: await options.auth.handle(request.action, request.data, { identity, clientKey: `wx/${userId}` }) };
      } catch (error) { return errorResponse(error); }
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
    };
    const response = (statusCode: number, body: unknown) => ({ statusCode, headers, isBase64Encoded: false, body: body === '' ? '' : JSON.stringify(body) });
    try {
      const inputHeaders = event.headers === undefined ? {} : object(event.headers);
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(inputHeaders)) {
        if (typeof value !== 'string' || key.length > 100 || value.length > 8192) return fail('INVALID_INPUT', '请求头无效');
        const lower = key.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(normalized, lower)) return fail('INVALID_INPUT', '请求头重复');
        normalized[lower] = value;
      }
      const origin = normalized.origin;
      if (origin && !options.allowedOrigins.includes(origin)) return fail('FORBIDDEN', '当前来源未获授权');
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      // Native app / non-browser clients do not send Origin. They still need Bearer authentication.
      if (event.httpMethod === 'OPTIONS') {
        const requested = (normalized['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (!origin || normalized['access-control-request-method'] !== 'POST' || requested.some(value => !['content-type', 'authorization'].includes(value))) return fail('FORBIDDEN', '预检请求无效');
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
        headers['Access-Control-Max-Age'] = '600';
        return response(204, '');
      }
      if (event.httpMethod !== 'POST') return fail('INVALID_INPUT', '仅支持POST请求');
      if (!/^application\/json(?:\s*;|$)/i.test(normalized['content-type'] || '')) return fail('INVALID_INPUT', '请使用JSON请求');
      if (typeof event.body !== 'string') return fail('INVALID_INPUT', '请求正文无效');
      if (Buffer.byteLength(event.body, 'utf8') > (event.isBase64Encoded === true ? Math.ceil(MAX_BODY_BYTES / 3) * 4 : MAX_BODY_BYTES)) return fail('PAYLOAD_TOO_LARGE', '请求过大');
      const body = event.isBase64Encoded === true ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return fail('PAYLOAD_TOO_LARGE', '请求过大');
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return fail('INVALID_INPUT', '请求正文不是有效JSON'); }
      const { group, action, data } = rpc(parsed);
      if (group === 'updates') {
        if (!options.updates) return fail('UPDATE_NOT_CONFIGURED', '更新信息暂不可用，请稍后重试');
        return response(200, { ok: true, data: await options.updates(data) });
      }
      if (group === 'auth' && action === 'bind') return fail('FORBIDDEN', '请在原微信账号中绑定登录账号');
      const authorization = normalized.authorization || '';
      const token = /^Bearer [A-Za-z0-9_-]{43}$/i.test(authorization) ? authorization.slice(7) : '';
      // Use only gateway context, never X-Forwarded-For or RPC fields, for the client bucket.
      const requestContext = event.requestContext && typeof event.requestContext === 'object' ? event.requestContext as Input : {};
      const rawIp = options.clientIp?.() || requestContext.sourceIp;
      const clientKey = typeof rawIp === 'string' && isIP(rawIp) ? `ip/${rawIp}` : 'gateway/unknown';
      const result = group === 'auth'
        ? await options.auth.handle(action, data, { token, clientKey })
        : await options.dispatch(group, { ...data, action }, await options.auth.authenticate(token));
      return response(200, { ok: true, data: result });
    } catch (error) {
      const result = errorResponse(error);
      return response(status(result.error.code), result);
    }
  };
}
