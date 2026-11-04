import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { NotebookAndroidMessage, NotebookAndroidSender, NotebookAndroidNotSubmittedError } from './notebook-notification-model';

/** Server-only configuration. These values must never be serialized in API responses. */
export interface GetuiConfig { enabled: boolean; appId: string; appKey: string; masterSecret: string; xiaomiChannelId: string; androidOfflineChannels: string[] }
export type GetuiRequest = (url: string, body: Record<string, unknown>, headers: Record<string, string>) => Promise<unknown>;
const credential = /^[A-Za-z0-9_-]{8,128}$/;
const CHANNEL = /^[A-Za-z0-9_.-]{1,64}$/;
const ANDROID_OFFLINE_CHANNELS = new Set(['XM', 'HW', 'HO', 'OP', 'VV', 'MZ', 'FCM']);
const PACKAGE = 'com.applejq.familyhome';
const TITLE = '家庭日程提醒', CONTENT = '家庭日程即将开始，打开查看最新安排';
const MAX_TTL = 5 * 60_000;
export function readGetuiConfig(env: Record<string, string | undefined>): GetuiConfig {
  const appId = env.GETUI_APP_ID || '', appKey = env.GETUI_APP_KEY || '', masterSecret = env.GETUI_MASTER_SECRET || '';
  const xiaomiChannelId = env.GETUI_XIAOMI_CHANNEL_ID || '';
  const requestedChannels = (env.GETUI_ANDROID_OFFLINE_CHANNELS || '').split(',').map(value => value.trim().toUpperCase());
  const androidOfflineChannels = [...new Set(requestedChannels.filter(value => ANDROID_OFFLINE_CHANNELS.has(value)
    && (value !== 'XM' || CHANNEL.test(xiaomiChannelId))))];
  const enabled = env.NOTEBOOK_ANDROID_ENABLED === '1' && credential.test(appId) && credential.test(appKey)
    && credential.test(masterSecret);
  return enabled ? { enabled, appId, appKey, masterSecret, xiaomiChannelId: CHANNEL.test(xiaomiChannelId) ? xiaomiChannelId : '', androidOfflineChannels }
    : { enabled: false, appId: '', appKey: '', masterSecret: '', xiaomiChannelId: '', androidOfflineChannels: [] };
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const post: GetuiRequest = (url, body, headers) => new Promise((resolve, reject) => {
  const request = httpsRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json;charset=utf-8', ...headers } }, response => {
    const chunks: Buffer[] = []; let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) { response.destroy(); reject(new Error('PUSH_RESPONSE_INVALID')); } else chunks.push(chunk);
    });
    response.on('error', () => reject(new Error('PUSH_NETWORK_ERROR')));
    response.on('end', () => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { reject(new Error('PUSH_HTTP_ERROR')); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('PUSH_RESPONSE_INVALID')); }
    });
  });
  request.setTimeout(8000, () => request.destroy(new Error('PUSH_TIMEOUT')));
  request.on('error', () => reject(new Error('PUSH_NETWORK_ERROR')));
  request.end(JSON.stringify(body));
});

export function createGetuiClient(config: GetuiConfig, options: { now?: () => number; request?: GetuiRequest } = {}): { configured: boolean; offlineAvailable: boolean; send: NotebookAndroidSender } {
  const now = options.now || Date.now, request = options.request || post;
  const configured = config.enabled && credential.test(config.appId) && credential.test(config.appKey)
    && credential.test(config.masterSecret);
  const offlineAvailable = configured && config.androidOfflineChannels.length > 0;
  const base = `https://restapi.getui.com/v2/${configured ? config.appId : 'disabled'}`;
  let cachedToken = '', validUntil = 0, pendingAuth: Promise<string> | null = null;
  async function token() {
    if (cachedToken && validUntil > now()) return cachedToken;
    if (pendingAuth) return pendingAuth;
    pendingAuth = (async () => {
      try {
        const timestamp = String(now());
        const sign = createHash('sha256').update(config.appKey + timestamp + config.masterSecret).digest('hex');
        const result = object(await request(`${base}/auth`, { sign, timestamp, appkey: config.appKey }, {}));
        const data = object(result.data), expiresAt = Number(data.expire_time), value = data.token;
        if (result.code !== 0 || typeof value !== 'string' || !/^[A-Za-z0-9_.-]{8,512}$/.test(value)
          || !Number.isFinite(expiresAt) || expiresAt <= now() + 60_000) throw new Error('INVALID_AUTH');
        cachedToken = value; validUntil = Math.min(expiresAt - 60_000, now() + 23 * 3600_000);
        return value;
      } catch { throw new NotebookAndroidNotSubmittedError(); }
      finally { pendingAuth = null; }
    })();
    return pendingAuth;
  }
  async function send(message: NotebookAndroidMessage) {
    if (!configured) throw new Error('ANDROID_PUSH_UNAVAILABLE');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(message.cid) || !/^[A-Za-z0-9_-]{1,120}$/.test(message.entryId)
      || !/^[A-Za-z0-9_-]{10,32}$/.test(message.requestId) || !Number.isFinite(message.expiresAt)) throw new Error('ANDROID_PUSH_INVALID_MESSAGE');
    if (message.expiresAt <= now()) throw new Error('ANDROID_PUSH_EXPIRED');
    const authorization = await token();
    // Authentication may take time; never revive an expired reminder with a fresh TTL.
    const ttl = Math.min(MAX_TTL, Math.floor(message.expiresAt - now()));
    if (ttl <= 0) throw new Error('ANDROID_PUSH_EXPIRED');
    const payload = JSON.stringify({ type: 'notebook-reminder', entryId: message.entryId });
    // UniPush 1 requires these intent extras for push click callbacks.
    const intent = `intent://io.dcloud.unipush/?#Intent;scheme=unipush;launchFlags=0x4000000;component=${PACKAGE}/io.dcloud.PandoraEntry;S.UP-OL-SU=true;S.title=${encodeURIComponent(TITLE)};S.content=${encodeURIComponent(CONTENT)};S.payload=${encodeURIComponent(payload)};end`;
    // UniPush 1 parses this special transmission shape and renders the online Android notification.
    const transmission = JSON.stringify({ title: TITLE, content: CONTENT, payload, options: { channelId: 'family-reminders' } });
    const body = { request_id: message.requestId, audience: { cid: [message.cid] }, settings: { ttl },
      push_message: { transmission },
      push_channel: { android: { ups: { notification: { title: TITLE, body: CONTENT, click_type: 'intent', intent },
        ...(config.androidOfflineChannels.includes('XM') ? { options: { XM: { '/extra.channel_id': config.xiaomiChannelId } } } : {}) } } } };
    try {
      const result = object(await request(`${base}/push/single/cid`, body, { token: authorization }));
      const code = result.code;
      if (code === 10001) { cachedToken = ''; validUntil = 0; }
      // No retry after submission: a timeout or malformed response has an unknown outcome.
      return typeof code === 'number' && Number.isSafeInteger(code) ? { code } : {};
    } catch { throw new Error('ANDROID_PUSH_SEND_UNKNOWN'); }
  }
  return { configured, offlineAvailable, send };
}
