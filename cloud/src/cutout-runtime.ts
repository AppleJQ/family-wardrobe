import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';
import { createCiCutout } from './ci-cutout';
import { createCutoutService } from './cutout-service';
import { BusinessError } from './service';
import { Input } from './model';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
const provider = createCiCutout({ bucket: 'family-wardrobe-cutout-1306311302', region: 'ap-shanghai', credentials: () => ({ secretId: process.env.TENCENTCLOUD_SECRETID || '', secretKey: process.env.TENCENTCLOUD_SECRETKEY || '', token: process.env.TENCENTCLOUD_SESSIONTOKEN }) });
const storage = createStorage();
const service = createCutoutService(createRepository(), provider, async fileId => { const urls = await storage.urls([fileId]); if (!urls[fileId]) throw new Error('IMAGE_UNAVAILABLE'); return urls[fileId]; }, { storage });
export async function invokeCutout(event: Input) {
  try { const context = cloud.getWXContext(); return { ok: true, data: await service(event || {}, { openid: context.OPENID || '', appid: context.APPID || '', source: context.SOURCE || '' }) }; }
  catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message } };
    console.error('WARDROBE_CUTOUT_FAILED'); return { ok: false, error: { code: 'CUTOUT_UNAVAILABLE', message: '去背景暂不可用，原图已保留' } };
  } finally { for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE']) delete process.env[key]; }
}
