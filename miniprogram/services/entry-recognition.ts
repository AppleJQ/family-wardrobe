import { getAiTask, recognizePhoto } from './ai';
import { prepareImage } from './cloud';
import { BatchEntry, requestId } from './batch';

interface RecognitionHooks { current: () => BatchEntry | undefined; active: () => boolean; checkpoint: () => void }
/** The local photo/request is durable; image bytes exist only for the outbound request. */
export async function recognizeEntry(entry: BatchEntry, memberId: string, hooks: RecognitionHooks): Promise<void> {
  if (!hooks.active() || entry.submittedPatch || entry.status === 'saved' || !memberId) return;
  const localId = entry.id, path = entry.path, before = { ...entry.form };
  const request = entry.recognition || { requestId: requestId(), memberId, status: 'running' as const, error: '' };
  const current = () => {
    const row = hooks.current();
    return hooks.active() && row?.id === localId && row.path === path ? row : undefined;
  };
  const initial = current(); if (!initial) return;
  initial.recognition = { ...request, status: 'running', error: '' }; hooks.checkpoint();
  try {
    let task;
    if (request.taskId) task = await getAiTask(request.taskId);
    else {
      const prepared = await prepareImage(path);
      if (!current()) return;
      task = await recognizePhoto(request.memberId, request.requestId, prepared.base64);
    }
    const row = current(); if (!row) return;
    row.recognition = { ...request, taskId: task.id, status: task.status === 'running' ? 'running' : task.status,
      error: task.status === 'unknown' ? '识别结果暂未返回，可稍后查看或手动填写'
        : task.status === 'failed' ? '自动识别未成功，可手动填写名称、颜色' : '' };
    const values = task.status === 'succeeded' ? task.result?.suggestions : undefined;
    if (values && !row.submittedPatch && row.status !== 'saved' && row.form.memberIndex === before.memberIndex) {
      const form = { ...row.form };
      for (const field of ['name', 'color'] as const) {
        if (!row.editedFields?.includes(field) && form[field] === before[field] && values[field]) form[field] = values[field];
      }
      row.form = form;
    }
    hooks.checkpoint();
  } catch (error) {
    const row = current(); if (!row) return;
    const code = (error as { code?: string } | null)?.code;
    const unknown = ['NETWORK', 'AI_SUBMISSION_UNKNOWN', 'AI_UNAVAILABLE'].includes(code || '') || !code;
    row.recognition = { ...request, status: unknown ? 'unknown' : 'failed', error: unknown
      ? '识别结果暂未返回，可稍后查看或手动填写'
      : '自动识别未成功，可手动填写名称、颜色' };
    hooks.checkpoint();
    if (['NO_FAMILY', 'UNAUTHENTICATED'].includes(code || '')) throw error;
  }
}
