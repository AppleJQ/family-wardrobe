import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';
import { createNotebookService } from './notebook-service';
import { createDeepSeekClient } from './deepseek';
import { BusinessError } from './service';
import { Input } from './model';
import { readNotebookWechatConfig } from './notebook-reminders';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
const notebook = createNotebookService(createRepository(), createStorage(), {
  provider: createDeepSeekClient({ apiKey: process.env.DEEPSEEK_API_KEY }),
  dailyLimit: Number(process.env.NOTEBOOK_AI_DAILY_LIMIT || 30),
  wechatReminders: readNotebookWechatConfig(process.env),
});
export async function invokeNotebook(event: Input) {
  try {
    const context = cloud.getWXContext();
    return { ok: true, data: await notebook.handle(event || {}, { openid: context.OPENID || '', appid: context.APPID || '', source: context.SOURCE || '' }) };
  } catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message } };
    console.error('NOTEBOOK_DOMAIN_FAILED');
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '家庭记事暂时不可用，请稍后重试' } };
  } finally {
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE']) delete process.env[key];
  }
}
