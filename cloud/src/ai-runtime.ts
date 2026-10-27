import cloud from 'wx-server-sdk';
import { createRepository } from './adapter';
import { createAiService } from './ai-service';
import { createDeepSeekClient } from './deepseek';
import { Input } from './model';
import { BusinessError } from './service';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
const service = createAiService(createRepository(), createDeepSeekClient({ apiKey: process.env.DEEPSEEK_API_KEY }),
  async fileID => {
    const result = await cloud.downloadFile({ fileID });
    return result.fileContent;
  }, { dailyLimit: Number(process.env.AI_DAILY_LIMIT || 30) });

export async function invokeAi(event: Input) {
  try {
    const context = cloud.getWXContext();
    const data = await service(event || {}, { openid: context.OPENID || '', appid: context.APPID || '', source: context.SOURCE || '' });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message } };
    console.error('WARDROBE_AI_REQUEST_FAILED');
    return { ok: false, error: { code: 'AI_UNAVAILABLE', message: '智能服务暂不可用，请稍后查看原任务' } };
  } finally {
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE']) delete process.env[key];
  }
}
