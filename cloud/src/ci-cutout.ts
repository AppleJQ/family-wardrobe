import COS from 'cos-nodejs-sdk-v5';
import { PNG } from 'pngjs';

export type CutoutMode = 'goods' | 'common';
export interface CutoutProvider {
  configured: boolean;
  process(url: string, mode: CutoutMode): Promise<Buffer>;
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export class CutoutError extends Error {
  constructor(public code: string, message: string, public uncertain = false) { super(message); }
}
export function validateCutout(bytes: Buffer): Buffer {
  try {
    if (bytes.length > 12 * 1024 * 1024) throw new CutoutError('CUTOUT_RESULT_TOO_LARGE', '抠图结果过大，原图已保留');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new CutoutError('CUTOUT_INVALID_PNG', '抠图服务未返回透明PNG，原图已保留');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 4000000) throw new Error('size');
    // CI may append provider bytes after IEND. Decode only complete PNG chunks;
    // pngjs still verifies their CRCs before any pixels are accepted.
    let end = 8, complete = false;
    while (end + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(end), next = end + 12 + length;
      if (next > bytes.length) throw new Error('truncated PNG chunk');
      const type = bytes.toString('ascii', end + 4, end + 8); end = next;
      if (type === 'IEND') { if (length !== 0) throw new Error('invalid IEND'); complete = true; break; }
    }
    if (!complete) throw new Error('missing IEND');
    const raw = PNG.sync.read(bytes.subarray(0, end), { checkCRC: true });
    let clear = 0, solid = 0;
    for (let i = 3; i < raw.data.length; i += 4) { if (raw.data[i] < 128) clear++; else solid++; }
    if (!clear || !solid) throw new CutoutError(!solid ? 'CUTOUT_EMPTY' : 'CUTOUT_OPAQUE', !solid ? '这张照片未提取到衣物，原图已保留' : '这张照片未分离出背景，原图已保留。可换用通用抠图。');
    // Re-encode pixels only; never pass provider metadata to the client.
    for (const longest of [1600, 1280, 1024, 800, 640, 512, 384, 320]) {
      const scale = Math.min(1, longest / Math.max(width, height)), w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      const pixels = new PNG({ width: w, height: h });
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const from = (Math.min(height - 1, Math.floor(y / scale)) * width + Math.min(width - 1, Math.floor(x / scale))) * 4, to = (y * w + x) * 4;
        raw.data.copy(pixels.data, to, from, from + 4);
      }
      const clean = PNG.sync.write(pixels);
      if (clean.length <= 512 * 1024) return clean;
    }
    throw new CutoutError('CUTOUT_RESULT_TOO_LARGE', '抠图结果过大，原图已保留');
  } catch (error) { if (error instanceof CutoutError) throw error; throw new CutoutError('CUTOUT_INVALID_PNG', '暂未得到有效的透明PNG，原图已保留'); }
}
export function createCiCutout(options: { bucket: string; region: string; credentials: () => { secretId: string; secretKey: string; token?: string }; fetchImpl?: typeof fetch }): CutoutProvider {
  const { bucket, region } = options;
  if (!/^[a-z0-9-]+-\d+$/.test(bucket) || !/^ap-[a-z]+$/.test(region)) throw new Error('Invalid cutout bucket configuration');
  const fetcher = options.fetchImpl || fetch;
  const client = () => { const c = options.credentials(); return new COS({ SecretId: c.secretId, SecretKey: c.secretKey, SecurityToken: c.token, Timeout: 8000, AutoSwitchHost: false }); };
  const assertKey = (key: string) => { if (!/^wardrobe-cutouts\/v1\/[a-f0-9/]+\.png$/.test(key)) throw new Error('Invalid cutout key'); };
  return {
    configured: true,
    async process(url, mode) {
      const credentials = options.credentials();
      if (!credentials.secretId || !credentials.secretKey) throw new CutoutError('CUTOUT_NOT_CONFIGURED', '智能去背景尚未配置');
      const host = `${bucket}.cos.${region}.myqcloud.com`, query = { 'ci-process': mode === 'goods' ? 'GoodsMatting' : 'AIPicMatting', 'detect-url': url };
      const authorization = COS.getAuthorization({ SecretId: credentials.secretId, SecretKey: credentials.secretKey, Method: 'GET', Key: '/', Query: query, Headers: { host }, Expires: 60 });
      const target = new URL(`https://${host}/`); Object.entries(query).forEach(([key, value]) => target.searchParams.set(key, value));
      let response: Response;
      try { response = await fetcher(target, { headers: { Authorization: authorization, ...(credentials.token ? { 'x-cos-security-token': credentials.token } : {}) }, signal: AbortSignal.timeout(14000), redirect: 'error' }); }
      catch { throw new CutoutError('CUTOUT_UNKNOWN', '去背景结果暂不确定，请重查；原图已保留', true); }
      if (!response.ok) {
        await response.body?.cancel();
        const rejected = [400, 401, 403, 404, 429].includes(response.status);
        throw new CutoutError(rejected ? 'CUTOUT_REJECTED' : 'CUTOUT_UNKNOWN', response.status === 403 ? '抠图服务权限不足，请检查数据万象授权' : '抠图服务暂不可用，原图已保留', !rejected);
      }
      try {
        const chunks: Buffer[] = []; let total = 0;
        if (!response.body) throw new Error('empty');
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { total += chunk.length; if (total > 12 * 1024 * 1024) throw new CutoutError('CUTOUT_RESULT_TOO_LARGE', '抠图结果过大，原图已保留'); chunks.push(Buffer.from(chunk)); }
        const bytes = Buffer.concat(chunks);
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
          const code = /<(?:Code|code)>([a-zA-Z0-9._-]{1,80})<\//.exec(bytes.toString('utf8', 0, 2048))?.[1];
          throw new CutoutError(code ? `CUTOUT_PROVIDER_${code}` : 'CUTOUT_INVALID_PNG', '抠图服务未返回透明图片，请检查服务开通状态');
        }
        return validateCutout(bytes);
      } catch (error) {
        if (error instanceof CutoutError) throw error;
        const kind = error instanceof Error ? error.name.replace(/[^A-Za-z]/g, '').slice(0, 30) : 'Unknown';
        console.error('CI_RESULT_READ_FAILED', kind);
        throw new CutoutError(`CUTOUT_READ_${kind.toUpperCase()}`, '抠图结果未完整返回，请重查原任务', true);
      }
    },
    async put(key, bytes) { assertKey(key); await client().putObject({ Bucket: bucket, Region: region, Key: key, Body: bytes, ContentType: 'image/png', ACL: 'private', CacheControl: 'private, no-store' }); },
    async get(key) { assertKey(key); try { const result = await client().getObject({ Bucket: bucket, Region: region, Key: key }); return validateCutout(Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body || '', 'binary')); } catch (error) { if ((error as {code?: string})?.code === 'NoSuchKey') throw new CutoutError('CUTOUT_CACHE_MISSING', '抠图预览已过期'); throw error; } },
    async remove(key) { assertKey(key); await client().deleteObject({ Bucket: bucket, Region: region, Key: key }); },
  };
}
