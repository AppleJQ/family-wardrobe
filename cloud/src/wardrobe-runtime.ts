import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';
import { BusinessError } from './service';
import { Input } from './model';
import { createWardrobeService } from './wardrobe-service';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
const service = createWardrobeService(createRepository(), createStorage());
export async function invokeWardrobe(event: Input) {
  try {
    const context = cloud.getWXContext();
    const data = await service(event || {}, { openid: context.OPENID || '', appid: context.APPID || '', source: context.SOURCE || '' });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message } };
    console.error('WARDROBE_DOMAIN_FAILED', error instanceof Error ? error.name : 'UnknownError');
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '云端暂时不可用，请稍后重试' } };
  } finally {
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE']) delete process.env[key];
  }
}
