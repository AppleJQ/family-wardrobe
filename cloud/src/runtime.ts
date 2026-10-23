import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';
import { BusinessError, createService } from './service';
import { Input } from './model';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
const service = createService(createRepository(), createStorage());

export async function invoke(group: string, event: Input) {
  try {
    // Never accept event.openid/userId/role. These functions have no HTTP or timer entry.
    const context = cloud.getWXContext();
    const data = await service(group, event || {}, { openid: context.OPENID || '', appid: context.APPID || '', source: context.SOURCE || '' });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message } };
    // Do not log event (contains image bytes / invitation tokens), raw context or credentials.
    console.error('WARDROBE_REQUEST_FAILED', error instanceof Error ? error.name : 'UnknownError');
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '云端暂时不可用，请稍后重试' } };
  } finally {
    // Prevent a subsequent non-WeChat invocation from inheriting a warm instance's identity.
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE']) delete process.env[key];
  }
}
