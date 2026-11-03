import { randomUUID } from 'node:crypto';
import { ImageStorage, Input, Repository } from './model';
import { NotebookAsset, NotebookCleanupScan, NotebookRecord } from './notebook-model';
import { assertNotebookTimer } from './notebook-reminders';
import { BusinessError } from './service';

const DAY = 86400000;
const SCAN_ID = 'maintenance-v1';
const LEASE = 55_000;
type Lane = keyof NotebookCleanupScan['cursors'];
export interface NotebookCleanupOptions { now?: () => number; scanLimit?: number; batchSize?: number }

/** Server maintenance only: no public notebook action or HTTP dispatch reaches it. */
export function createNotebookCleanup(repo: Repository, storage: ImageStorage, options: NotebookCleanupOptions = {}) {
  const now = options.now || Date.now;
  const scanLimit = Math.max(1, Math.min(100, options.scanLimit || 50));
  const batchSize = Math.max(1, Math.min(50, options.batchSize || 25));
  function expired(row: NotebookRecord) {
    return row.status === 'deleted' && row.deletedAt !== null && now() - row.deletedAt >= 30 * DAY;
  }
  function assetDue(row: NotebookAsset) {
    return row.refCount === 0 && (row.status === 'deleted' || row.status === 'failed' || row.cleanupRequestedAt !== undefined
      || row.status === 'active' && now() - row.createdAt >= DAY
      || row.status === 'uploading' && now() - row.createdAt >= 3600_000);
  }
  async function run(event: Input, context: { source: string; openid: string }) {
    assertNotebookTimer(event, context);
    const token = randomUUID();
    const stats = { busy: false, scanned: 0, expired: 0, assetsDeleted: 0, linksDetached: 0, failed: 0 };
    const acquired = await repo.transaction(async unit => {
      const old = await unit.get('notebook_cleanup_scans', SCAN_ID);
      if (old && old.leaseUntil > now()) return false;
      await unit.put('notebook_cleanup_scans', { _id: SCAN_ID, createdAt: old?.createdAt || now(), updatedAt: now(),
        leaseToken: token, leaseUntil: now() + LEASE, cursors: old?.cursors || { entries: null, assets: null, events: null } });
      return true;
    });
    if (!acquired) return { ...stats, busy: true };
    async function checkpoint(lane: Lane, before: { createdAt: number; id: string } | null) {
      await repo.transaction(async unit => {
        const scan = await unit.get('notebook_cleanup_scans', SCAN_ID);
        if (!scan || scan.leaseToken !== token || scan.leaseUntil <= now()) throw new BusinessError('CLEANUP_LEASE_LOST', '清理任务租约已变化');
        await unit.put('notebook_cleanup_scans', { ...scan, cursors: { ...scan.cursors, [lane]: before }, updatedAt: now() });
      });
    }
    async function entry(snapshot: NotebookRecord) {
      const result = await repo.transaction(async unit => {
        const row = await unit.get('notebook_entries', snapshot._id);
        if (!row) return null;
        if (expired(row)) {
          for (const id of row.imageIds) {
            const image = await unit.get('notebook_assets', id);
            if (!image || image.familyId !== row.familyId) continue;
            const refs = Math.max(0, image.refCount - 1);
            await unit.put('notebook_assets', { ...image, refCount: refs, ...(refs === 0 ? { cleanupRequestedAt: now() } : {}), updatedAt: now() });
          }
          const tombstone: NotebookRecord = { ...row, title: '', body: '', category: '', noteMemberId: '', date: '', startTime: '', endTime: '',
            participantMemberIds: [], participantUserIds: [], place: '', listId: '', noteId: '', reminderMinutes: null, eventState: 'planned', pinned: false,
            items: [], imageIds: [], status: 'purged', version: row.version + 1, updatedAt: now(),
            referenceFence: row.referenceFence + 1, cleanupAssetIds: [...new Set([...row.cleanupAssetIds, ...row.imageIds])] };
          await unit.put('notebook_entries', tombstone); return { row: tombstone, expired: true };
        }
        return row.status === 'purged' ? { row, expired: false } : null;
      });
      if (!result) return;
      if (result.expired) stats.expired++;
      // Bound work for a single record. Rotate unresolved IDs so one permanently
      // failing object cannot starve the rest of this entry's old attachments.
      const ids = result.row.cleanupAssetIds.slice(0, 10), retained: string[] = [];
      for (const id of ids) {
        try {
          const keep = await repo.transaction(async unit => {
            const image = await unit.get('notebook_assets', id);
            if (!image || image.familyId !== result.row.familyId || image.refCount !== 0) return false;
            if (!image.fileId && !image.cleanupFileIds?.length && !image.cloudPath) return false;
            await unit.put('notebook_assets', { ...image, cleanupRequestedAt: image.cleanupRequestedAt ?? now(), updatedAt: now() });
            return true;
          });
          if (keep) retained.push(id);
        } catch { retained.push(id); stats.failed++; }
      }
      if (ids.length) await repo.transaction(async unit => {
        const row = await unit.get('notebook_entries', result.row._id);
        if (row?.status === 'purged') await unit.put('notebook_entries', { ...row,
          cleanupAssetIds: [...row.cleanupAssetIds.filter(id => !ids.includes(id)), ...retained] });
      });
    }
    async function image(snapshot: NotebookAsset) {
      if (!assetDue(snapshot)) return;
      const claimed = await repo.transaction(async unit => {
        const row = await unit.get('notebook_assets', snapshot._id);
        if (!row || !assetDue(row)) return null;
        const changed: NotebookAsset = { ...row, status: 'deleted', cleanupRequestedAt: row.cleanupRequestedAt ?? now(), updatedAt: now() };
        await unit.put('notebook_assets', changed); return changed;
      });
      if (!claimed) return;
      const files = [...new Set([claimed.fileId, ...claimed.cleanupFileIds || []].filter(Boolean))];
      const removed: string[] = [];
      for (const fileId of files) {
        try { await storage.remove(fileId); removed.push(fileId); stats.assetsDeleted++; }
        catch { stats.failed++; }
      }
      if (!removed.length) return; // Keep upload path/fingerprint for any late file handle.
      await repo.transaction(async unit => {
        const current = await unit.get('notebook_assets', claimed._id);
        if (!current || current.status !== 'deleted' || current.refCount !== 0) return;
        const fileId = removed.includes(current.fileId) ? '' : current.fileId;
        const cleanupFileIds = current.cleanupFileIds?.filter(id => !removed.includes(id)) || [];
        const cleared = !fileId && !cleanupFileIds.length && current.cloudPath === claimed.cloudPath && current.fingerprint === claimed.fingerprint;
        await unit.put('notebook_assets', { ...current, fileId, cleanupFileIds,
          ...(cleared ? { cloudPath: '', fingerprint: '' } : {}), updatedAt: now() });
      });
    }
    async function detach(snapshot: NotebookRecord) {
      if (!snapshot.listId && !snapshot.noteId) return;
      const changed = await repo.transaction(async unit => {
        const row = await unit.get('notebook_entries', snapshot._id);
        if (!row || row.kind !== 'event') return false;
        let listId = row.listId, noteId = row.noteId;
        for (const key of ['listId', 'noteId'] as const) if (row[key]) {
          const linked = await unit.get('notebook_entries', row[key]);
          if (!linked || linked.familyId === row.familyId && linked.status === 'purged') {
            if (key === 'listId') listId = ''; else noteId = '';
          }
        }
        if (listId === row.listId && noteId === row.noteId) return false;
        await unit.put('notebook_entries', { ...row, listId, noteId, version: row.version + 1, updatedAt: now() }); return true;
      });
      if (changed) stats.linksDetached++;
    }
    try {
      for (const lane of ['entries', 'assets', 'events'] as const) {
        const scan = await repo.get('notebook_cleanup_scans', SCAN_ID);
        let before = scan?.cursors[lane] || undefined, count = 0;
        while (count < scanLimit) {
          const limit = Math.min(batchSize, scanLimit - count);
          const rows = lane === 'assets'
            ? await repo.list('notebook_assets', {}, { before, limit })
            : await repo.list('notebook_entries', lane === 'events' ? { kind: 'event' } : {}, { before, limit });
          if (!rows.length) { await checkpoint(lane, null); break; }
          for (const row of rows) {
            try {
              if (lane === 'assets') await image(row as NotebookAsset);
              else if (lane === 'events') await detach(row as NotebookRecord);
              else await entry(row as NotebookRecord);
            } catch { stats.failed++; }
            count++; stats.scanned++;
            before = { createdAt: row.createdAt, id: row._id };
            // Failed work stays in its document. Advancing prevents failures at
            // the newest row from starving old records; the next cycle retries it.
            await checkpoint(lane, before);
          }
          if (rows.length < limit) { await checkpoint(lane, null); break; }
        }
      }
      return stats;
    } finally {
      await repo.transaction(async unit => {
        const scan = await unit.get('notebook_cleanup_scans', SCAN_ID);
        if (scan?.leaseToken === token) await unit.put('notebook_cleanup_scans', { ...scan, leaseToken: '', leaseUntil: 0, updatedAt: now() });
      });
    }
  }
  return { run };
}
