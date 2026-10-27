import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';
import { BusinessError } from './service';
import { Input } from './model';
import { createWardrobeService } from './wardrobe-service';
import { measureRepository, RequestTimings } from './performance';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
const service = createWardrobeService(createRepository(), createStorage());
export async function invokeWardrobe(event: Input) {
  const timings = event?.__measure === true ? new RequestTimings() : undefined;
  try {
    const context = cloud.getWXContext();
    const handler = timings ? createWardrobeService(measureRepository(createRepository(), timings), createStorage(timings)) : service;
    const data = await handler(event || {}, { openid: context.OPENID || '', appid: context.APPID || '', source: context.SOURCE || '' });
    return { ok: true, data, ...(timings ? { performance: timings.snapshot() } : {}) };
  } catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message }, ...(timings ? { performance: timings.snapshot() } : {}) };
    console.error('WARDROBE_DOMAIN_FAILED', error instanceof Error ? error.name : 'UnknownError');
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '云端暂时不可用，请稍后重试' }, ...(timings ? { performance: timings.snapshot() } : {}) };
  } finally {
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE']) delete process.env[key];
  }
}
