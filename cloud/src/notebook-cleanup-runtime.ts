import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';
import { createNotebookCleanup } from './notebook-cleanup';
import { assertNotebookTimer } from './notebook-reminders';
import { BusinessError } from './service';
import { Input } from './model';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
export async function invokeNotebookCleanup(event: Input) {
  try {
    const wx = cloud.getWXContext();
    // Scheduled CloudBase invocations inject TRIGGER_SRC=timer; SOURCE/TCB_SOURCE
    // and event fields are not substitutes for this trusted platform variable.
    const context = { source: process.env.TRIGGER_SRC === 'timer' ? 'timer' : '', openid: wx.OPENID || process.env.WX_OPENID || process.env.OPENID || '' };
    assertNotebookTimer(event || {}, context);
    return { ok: true, data: await createNotebookCleanup(createRepository(), createStorage()).run(event || {}, context) };
  } catch (error) {
    if (error instanceof BusinessError) return { ok: false, error: { code: error.code, message: error.message } };
    console.error('NOTEBOOK_CLEANUP_FAILED');
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '记事清理任务暂时不可用，待下次继续' } };
  } finally {
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE', 'TRIGGER_SRC']) delete process.env[key];
  }
}
