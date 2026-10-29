import {localPath,copyFile,removeFile} from '../platform/files';
import { BatchEntry, requestId } from './batch';
import { prepareImage } from './cloud';
import { getPhotoCutout, processPhotoCutout, saveCutoutPreview } from './cutout';

interface Hooks { current: () => BatchEntry | undefined; active: () => boolean; checkpoint: () => void }
export const entryPhoto = (entry: BatchEntry) => entry.cutout?.applied ? entry.cutout.previewPath : entry.path;

/** Persist the request before submission. Every later tap queries it first. */
export async function previewEntryCutout(entry: BatchEntry, hooks: Hooks) {
  if (entry.submittedPatch || entry.status === 'saved' || entry.cutout?.applied || !hooks.active()) return;
  const id = entry.id, path = entry.path;
  const current = () => { const row = hooks.current(); return hooks.active() && row?.id === id && row.path === path ? row : undefined; };
  const task = entry.cutout || { requestId: requestId(), status: 'running' as const, previewPath: '', applied: false, error: '' };
  entry.cutout = task; hooks.checkpoint();
  try {
    let result = await getPhotoCutout(task.requestId);
    if (!current()) return;
    if (result.status === 'none') {
      const prepared = await prepareImage(path);
      if (!current()) return;
      result = await processPhotoCutout(task.requestId, prepared.base64);
    }
    const row = current(); if (!row) return;
    let previewPath = task.previewPath;
    if (result.status === 'succeeded' && result.base64) {
      const temporary = await saveCutoutPreview(result.base64);
      previewPath = localPath(`wardrobe-batch-cutout-${id}-${task.requestId}.png`);
      try { await copyFile(temporary,previewPath); }
      finally { try { await removeFile(temporary); } catch { /* Temporary preview only. */ } }
    }
    row.cutout = { ...task, status: result.status === 'none' ? 'unknown' : result.status,
      previewPath, error: result.error || (result.status === 'running' ? '正在去背景，稍后可查看结果' : result.status === 'unknown' ? '结果暂未返回，请稍后查看' : '') };
    hooks.checkpoint();
  } catch (error) {
    const row = current(); if (!row) return;
    row.cutout = { ...task, status: 'unknown', error: '暂时无法取得结果，请稍后重试' }; hooks.checkpoint();
    throw error;
  }
}
