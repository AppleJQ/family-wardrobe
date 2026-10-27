import { call, prepareImage } from './cloud';
import { categories, emptyForm, GarmentForm } from './wardrobe';

export interface BatchEntry {
  id: string; path: string; form: GarmentForm; requestId: string; garmentId: string;
  status: 'pending' | 'saving' | 'failed' | 'saved'; error: string; errorCode?: string; canRestart?: boolean; beginUncertain?: boolean;
  submittedPatch?: Record<string, unknown>;
  saveMode?: 'combined';
  editedFields?: Array<'name' | 'color'>;
  recognition?: { requestId: string; memberId: string; taskId?: string;
    status: 'running' | 'succeeded' | 'failed' | 'unknown'; error: string };
  cutout?: { requestId: string; status: 'running' | 'succeeded' | 'failed' | 'unknown' | 'expired'; previewPath: string; applied: boolean; error: string };
}
export const requestId = () => `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
const key = (familyId: string) => `wardrobe_batch_v02_${familyId}`;
export function persistBatch(familyId: string, entries: BatchEntry[]) { wx.setStorageSync(key(familyId), entries); }
export function resumeBatch(familyId: string): BatchEntry[] {
  const value = wx.getStorageSync(key(familyId));
  if (!Array.isArray(value)) return [];
  const entries: BatchEntry[] = value.slice(0, 9).filter(e => e && typeof e.path === 'string' && typeof e.requestId === 'string' && e.form);
  if (entries.length && entries.every(entry => entry.status === 'saved')) { discardBatch(familyId, entries); return []; }
  return entries.map(e => ({ ...e, ...(!e.submittedPatch && !e.garmentId ? { saveMode: 'combined' as const } : {}), status: e.status === 'saving' ? 'failed' : e.status, canRestart: canRestartBatch(e), error: e.status === 'saving' ? '上次保存中断，可安全重试同一请求' : e.error,
    ...(e.cutout?.status === 'running' ? { cutout: { ...e.cutout, status: 'unknown', error: '上次去背景中断，可稍后查看结果' } } : {}),
    ...(e.recognition?.status === 'running' ? { recognition: { ...e.recognition, status: 'unknown', error: '上次识别中断，可重查原任务或手动填写' } } : {}) }));
}
export function discardBatch(familyId: string, entries: BatchEntry[]) {
  wx.removeStorageSync(key(familyId));
  entries.forEach(removeBatchPhoto);
}
export function removeBatchPhoto(entry: BatchEntry) {
  for (const path of new Set([entry.path, entry.cutout?.previewPath || ''])) {
    if (!path.startsWith(`${wx.env.USER_DATA_PATH}/wardrobe-batch-`)) continue;
    try { wx.getFileSystemManager().unlinkSync(path); } catch { /* Already removed by the system. */ }
  }
}
export function createBatchEntry(tempPath: string, form: GarmentForm = emptyForm): BatchEntry {
  const id = requestId();
  const extension = /\.(png|jpe?g)$/i.exec(tempPath)?.[1].toLowerCase() || 'jpg';
  const path = `${wx.env.USER_DATA_PATH}/wardrobe-batch-${id}.${extension}`;
  wx.getFileSystemManager().copyFileSync(tempPath, path);
  return { id, path, form: { ...form }, requestId: id, garmentId: '', status: 'pending', error: '', saveMode: 'combined' };
}
export function formPatch(form: GarmentForm, memberId: string): Record<string, unknown> {
  return { name: form.name.trim(), memberId, category: categories[form.categoryIndex], color: form.color.trim(), notes: form.notes.trim() };
}
export function canRestartBatch(entry: BatchEntry): boolean {
  return entry.status === 'failed' && !!entry.submittedPatch && ['INVALID_IMAGE', 'UPLOAD_INVALID', 'NOT_FOUND', 'INVALID_INPUT', 'REQUEST_CONFLICT'].includes(entry.errorCode || '');
}
/** Each checkpoint is persisted before the next remote step; a network retry reuses the same frozen request. */
export async function saveBatchEntry(entry: BatchEntry, memberId: string, checkpoint: () => void, isActive: () => boolean): Promise<void> {
  if (entry.status === 'saved' || !isActive()) return;
  if (!entry.form.name.trim() || !memberId) { entry.status = 'failed'; entry.error = '请填写名称并选择归属档案'; checkpoint(); return; }
  // Older persisted frozen drafts without a server ID may already have an ambiguous begin response.
  const previouslyUncertain = entry.beginUncertain ?? (!!entry.submittedPatch && !entry.garmentId);
  let stage: 'prepare' | 'begin' | 'upload' = 'prepare';
  entry.submittedPatch ||= formPatch(entry.form, memberId);
  entry.status = 'saving'; entry.error = ''; entry.errorCode = ''; entry.canRestart = false; checkpoint();
  try {
    const prepared = await prepareImage(entry.cutout?.applied ? entry.cutout.previewPath : entry.path);
    if (!isActive()) return;
    if (entry.saveMode === 'combined' && !entry.garmentId) {
      stage = 'begin'; entry.beginUncertain = true; checkpoint();
      const saved = await call<{ id: string }>('garments', 'save', { ...entry.submittedPatch, requestId: entry.requestId,
        base64: prepared.base64, ...(entry.cutout?.applied ? { transparent: true } : {}) });
      if (!isActive()) return;
      entry.garmentId = saved.id; entry.beginUncertain = false;
    } else {
    if (!entry.garmentId) {
      stage = 'begin'; entry.beginUncertain = true; checkpoint();
      const draft = await call<{ id: string }>('garments', 'beginUpload', { ...entry.submittedPatch, requestId: entry.requestId });
      if (!isActive()) return;
      entry.garmentId = draft.id; entry.beginUncertain = false; checkpoint();
    }
    stage = 'upload';
    await call('garments', 'upload', { garmentId: entry.garmentId, base64: prepared.base64, ...(entry.cutout?.applied ? { transparent: true } : {}) });
    }
    if (!isActive()) return;
    entry.status = 'saved'; entry.error = ''; entry.errorCode = ''; checkpoint();
  } catch (error) {
    if (!isActive()) return;
    entry.status = 'failed'; entry.error = error instanceof Error ? error.message : '保存失败，请重试'; entry.errorCode = (error as {code?: string} | null)?.code || '';
    if (!entry.garmentId && !previouslyUncertain && (stage === 'prepare' || (stage === 'begin' && ['INVALID_INPUT', 'NOT_FOUND'].includes(entry.errorCode)))) {
      // These validations reject the transaction before creating a draft; correcting its fields is safe.
      delete entry.submittedPatch; entry.beginUncertain = false; entry.error += '；可修正信息后重试';
    }
    entry.canRestart = canRestartBatch(entry); checkpoint();
    if (error instanceof Error && ['NO_FAMILY', 'UNAUTHENTICATED', 'FORBIDDEN'].includes((error as { code?: string }).code || '')) throw error;
  }
}
