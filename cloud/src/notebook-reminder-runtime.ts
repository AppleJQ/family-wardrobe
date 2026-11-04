import cloud from 'wx-server-sdk';
import { createRepository } from './adapter';
import { Input } from './model';
import { BusinessError } from './service';
import { assertNotebookTimer, createNotebookReminders, readNotebookWechatConfig } from './notebook-reminders';
import { createNotebookAndroidReminders } from './notebook-android-reminders';
import { createGetuiClient, readGetuiConfig } from './getui';

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
    const repo = createRepository(), android = createGetuiClient(readGetuiConfig(process.env));
    const reminders = createNotebookReminders(repo, {
      config: readNotebookWechatConfig(process.env),
      send: message => cloud.openapi.subscribeMessage.send(message),
    });
    const wechat = await reminders.run();
    const androidResult = await createNotebookAndroidReminders(repo, android).run();
    return { ok: true, data: { ...wechat, android: androidResult } };
  } catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message } };
    console.error('NOTEBOOK_REMINDERS_FAILED');
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '日程提醒任务暂时不可用' } };
  } finally {
    // Clear user identity, while preserving platform-managed timer/token metadata:
    // the SDK needs TRIGGER_SRC and WX_CONTEXT_KEYS to select timer API credentials.
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'TCB_SOURCE']) delete process.env[key];
  }
}
