import cloud from 'wx-server-sdk';
import { createRepository } from './adapter';
import { Input } from './model';
import { BusinessError } from './service';
import { assertNotebookTimer, createNotebookReminders, readNotebookWechatConfig } from './notebook-reminders';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });

export async function invokeNotebookReminders(event: Input) {
  try {
    const context = cloud.getWXContext();
    // CloudBase injects TRIGGER_SRC=timer for scheduled invocations. wx-server-sdk
    // SOURCE does not read that variable; neither SOURCE nor caller payload grants
    // timer authority. Keep deployment invoke:false in addition to this check.
    assertNotebookTimer(event || {}, {
      source: process.env.TRIGGER_SRC === 'timer' ? 'timer' : '',
      openid: context.OPENID || process.env.WX_OPENID || process.env.OPENID || '',
    });
    const reminders = createNotebookReminders(createRepository(), {
      config: readNotebookWechatConfig(process.env),
      send: message => cloud.openapi.subscribeMessage.send(message),
    });
    return { ok: true, data: await reminders.run() };
  } catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message } };
    console.error('NOTEBOOK_REMINDERS_FAILED');
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '日程提醒任务暂时不可用' } };
  } finally {
    // The SDK reads these process globals; do not retain a prior invocation's identity.
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE', 'TRIGGER_SRC']) delete process.env[key];
  }
}
