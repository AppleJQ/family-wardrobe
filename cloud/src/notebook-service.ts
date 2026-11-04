import { createHash } from 'node:crypto';
import { identitySession, identityUserId } from './identity';
import { createNotebookAndroidReminders } from './notebook-android-reminders';
import { NotebookAndroidSender } from './notebook-notification-model';
import { BusinessError } from './service';
import { Collection, Entities, Identity, ImageStorage, Input, ListOptions, Repository, Unit } from './model';
import { AiProvider } from './deepseek';
import { NotebookAsset, NotebookEntry, NotebookHome, NotebookItem, NotebookRecord } from './notebook-model';
import { createNotebookAi } from './notebook-ai';
import { createNotebookReminders, NotebookWechatConfig, readNotebookWechatConfig } from './notebook-reminders';
import { notebookParticipantUserIds } from './notebook-participants';
import { createCycleService } from './cycle-service';
import { createCycleAi } from './cycle-ai';

const RETENTION = 30 * 86400000;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Input)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
function text(value: unknown, max = 120, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) return fail('INVALID_INPUT', '请填写有效信息');
  return value.trim();
}
function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_INPUT', '信息格式无效');
  return value as Input;
}
function requestId(value: unknown) {
  const result = text(value, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(result)) return fail('INVALID_INPUT', '请求编号无效');
  return result;
}
function strings(value: unknown, max = 20): string[] {
  if (!Array.isArray(value) || value.length > max) return fail('INVALID_INPUT', '选择数量无效');
  const result = value.map(v => text(v));
  if (new Set(result).size !== result.length) return fail('INVALID_INPUT', '不能重复选择');
  return result;
}
function checkVersion(entry: { version: number }, version: unknown) {
  if (!Number.isSafeInteger(version) || entry.version !== version) return fail('CONFLICT', '内容已被家人修改，请刷新后重试');
}
function decodeCursor(value: unknown, familyId: string): ListOptions['before'] {
  if (value === undefined || value === '') return undefined;
  let row: { createdAt: number; id: string; familyId: string };
  try {
    row = JSON.parse(Buffer.from(text(value, 600), 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(row.createdAt) || typeof row.id !== 'string' || !row.id || row.id.length > 120
      || typeof row.familyId !== 'string' || !row.familyId || row.familyId.length > 120) throw Error();
  } catch { return fail('INVALID_INPUT', '分页信息无效'); }
  if (row.familyId !== familyId) return fail('NO_FAMILY', '分页所属家庭已变化，请重新进入家庭记事');
  return { createdAt: row.createdAt, id: row.id };
}
const encodeCursor = (row: { createdAt: number; _id: string; familyId: string }) => Buffer.from(JSON.stringify({ createdAt: row.createdAt, id: row._id, familyId: row.familyId })).toString('base64url');
async function all<K extends Collection>(repo: Repository, name: K, filter: Partial<Entities[K]>) {
  const result: Entities[K][] = []; let before: ListOptions['before'];
  for (;;) {
    const rows = await repo.list(name, filter, { before, limit: 100 }); result.push(...rows);
    if (rows.length < 100) return result;
    const last = rows[rows.length - 1]; before = { createdAt: last.createdAt, id: last._id };
  }
}
function blank(id: string, familyId: string, userId: string, timestamp: number): NotebookRecord {
  return { _id: id, familyId, kind: 'note', category: '', title: '', body: '', noteMemberId: '', date: '', startTime: '', endTime: '',
    participantUserIds: [], place: '', listId: '', noteId: '', reminderMinutes: null, eventState: 'planned', pinned: false,
    items: [], imageIds: [], status: 'active', version: 1, createdAt: timestamp, updatedAt: timestamp,
    createdBy: userId, updatedBy: userId, deletedAt: null, requestFingerprint: '', referenceFence: 0, cleanupAssetIds: [] };
}
const allowedFields = ['kind', 'category', 'title', 'body', 'noteMemberId', 'date', 'startTime', 'endTime', 'participantMemberIds', 'participantUserIds', 'place', 'listId', 'noteId', 'reminderMinutes', 'eventState', 'pinned', 'items', 'imageIds'];
export function validateNotebookDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function applyPatch(entry: NotebookRecord, input: Input, userId: string, timestamp: number, creating = false): NotebookRecord {
  if (!Object.keys(input).length || Object.keys(input).some(key => !allowedFields.includes(key))) return fail('INVALID_INPUT', '内容包含不支持的字段');
  const row = { ...entry };
  if (input.kind !== undefined) {
    if (!['event', 'list', 'note'].includes(String(input.kind)) || (!creating && input.kind !== entry.kind)) return fail('INVALID_INPUT', '内容类型无效');
    row.kind = input.kind as NotebookRecord['kind'];
  }
  if (input.category !== undefined) {
    const category = text(input.category, 20, true);
    if (row.kind === 'list' ? !['购物', '出行', '办事', '其他'].includes(category) : category !== '') return fail('INVALID_INPUT', '清单分类无效');
    row.category = category;
  } else if (creating && row.kind === 'list') row.category = '其他';
  for (const key of ['title', 'body', 'noteMemberId', 'date', 'startTime', 'endTime', 'place', 'listId', 'noteId'] as const) {
    if (input[key] !== undefined) row[key] = text(input[key], key === 'body' ? 20000 : key === 'title' ? 120 : key === 'place' ? 300 : 120, key !== 'title');
  }
  if (!row.title) return fail('INVALID_INPUT', '请填写标题');
  if (row.date && !validateNotebookDate(row.date)) return fail('INVALID_INPUT', '日期无效');
  for (const v of [row.startTime, row.endTime]) if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return fail('INVALID_INPUT', '时间无效');
  if (row.startTime && !row.date) return fail('INVALID_INPUT', '请先选择日期');
  if (row.endTime && (!row.startTime || row.endTime <= row.startTime)) return fail('INVALID_INPUT', '结束时间必须晚于开始时间');
  if (input.participantMemberIds !== undefined) row.participantMemberIds = strings(input.participantMemberIds, 20);
  else if (input.participantUserIds !== undefined) {
    row.participantUserIds = strings(input.participantUserIds, 10);
    delete row.participantMemberIds;
  }
  if (input.imageIds !== undefined) row.imageIds = strings(input.imageIds, 10);
  if (input.reminderMinutes !== undefined) {
    if (input.reminderMinutes !== null && (!Number.isInteger(input.reminderMinutes) || Number(input.reminderMinutes) < 0 || Number(input.reminderMinutes) > 43200)) return fail('INVALID_INPUT', '提醒时间无效');
    row.reminderMinutes = input.reminderMinutes as number | null;
  }
  if (input.eventState !== undefined) {
    if (!['planned', 'completed', 'cancelled'].includes(String(input.eventState))) return fail('INVALID_INPUT', '安排状态无效');
    row.eventState = input.eventState as NotebookRecord['eventState'];
  }
  if (input.pinned !== undefined) {
    if (typeof input.pinned !== 'boolean') return fail('INVALID_INPUT', '置顶值无效');
    row.pinned = input.pinned;
  }
  if (input.items !== undefined) {
    if (!Array.isArray(input.items) || input.items.length > 200) return fail('INVALID_INPUT', '清单最多200项');
    const ids = new Set<string>();
    row.items = input.items.map(raw => {
      const item = object(raw), id = text(item.id, 100), content = text(item.text, 500);
      if (ids.has(id)) return fail('INVALID_INPUT', '清单项目不能重复'); ids.add(id);
      if (item.done !== undefined && typeof item.done !== 'boolean') return fail('INVALID_INPUT', '完成状态无效');
      const old = entry.items.find(v => v.id === id), done = item.done === undefined ? old?.done || false : item.done;
      // Completion attribution always comes from the authenticated actor.
      return { id, text: content, done, completedBy: done ? old?.done ? old.completedBy : userId : '', completedAt: done ? old?.done ? old.completedAt : timestamp : null };
    });
  }
  if (row.kind !== 'list' && row.items.length) return fail('INVALID_INPUT', '只有清单可以包含勾选项目');
  if (row.kind !== 'event' && (row.listId || row.noteId || row.participantMemberIds?.length || row.participantUserIds.length || row.date || row.startTime || row.endTime || row.reminderMinutes !== null)) return fail('INVALID_INPUT', '日期、参与人和关联只用于日程');
  if (row.kind === 'event' && (!row.date || !(row.participantMemberIds ?? row.participantUserIds).length)) return fail('INVALID_INPUT', '请选择日期和参与人');
  if (row.kind === 'note' && !row.noteMemberId && (creating || input.noteMemberId !== undefined)) return fail('INVALID_INPUT', '请选择笔记所属家庭成员');
  if (row.kind !== 'note' && row.noteMemberId) return fail('INVALID_INPUT', '只有笔记需要成员归属');
  return row;
}

export interface NotebookOptions {
  now?: () => number; provider?: AiProvider; dailyLimit?: number; wechatTemplateId?: string;
  wechatReminderEnabled?: boolean;
  wechatReminders?: NotebookWechatConfig;
  androidReminders?: { configured: boolean; offlineAvailable?: boolean; send?: NotebookAndroidSender };
}
export function createNotebookService(repo: Repository, storage: ImageStorage, options: NotebookOptions = {}) {
  const now = options.now || Date.now;
  const reminderConfig = options.wechatReminders || readNotebookWechatConfig({});
  const reminders = createNotebookReminders(repo, { config: reminderConfig, now });
  const androidReminders = createNotebookAndroidReminders(repo, { ...options.androidReminders, configured: Boolean(options.androidReminders?.configured), now });
  const cycle = createCycleService(repo, { now, aiAvailable: Boolean(options.provider?.configured) });
  const cycleAi = createCycleAi({ repo, now, provider: options.provider, dailyLimit: options.dailyLimit, load: cycle.load });
  async function auth(unit: Unit, userId: string, expectedFamily = '') {
    const user = await unit.get('users', userId);
    if (!user || user.status !== 'active') return fail('UNAUTHENTICATED', '请重新登录');
    if (!user.activeFamilyId || expectedFamily && user.activeFamilyId !== expectedFamily) return fail('NO_FAMILY', '家庭权限已变化，请刷新');
    const family = await unit.get('families', user.activeFamilyId);
    const membership = await unit.get('family_memberships', hash(`${user.activeFamilyId}/${userId}`));
    if (!family || family.status !== 'active' || !membership || membership.status !== 'active') return fail('NO_FAMILY', '家庭权限已变化，请刷新');
    if (unit !== repo) await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
    return { user, familyId: family._id, family };
  }
  async function load(unit: Unit, familyId: string, id: string): Promise<NotebookRecord> {
    const row = await unit.get('notebook_entries', id);
    if (!row || row.familyId !== familyId) return fail('NOT_FOUND', '内容不存在或无权访问');
    return row;
  }
  async function asset(unit: Unit, familyId: string, id: string, active = true) {
    const row = await unit.get('notebook_assets', id);
    if (!row || row.familyId !== familyId || active && row.status !== 'active') return fail('NOT_FOUND', '图片不存在或无权访问');
    return row;
  }
  async function validateReferences(unit: Unit, row: NotebookRecord, previous?: NotebookRecord) {
    if (row.participantMemberIds !== undefined) {
      for (const id of row.participantMemberIds) {
        const member = await unit.get('family_members', id);
        if (!member || member.familyId !== row.familyId || member.status !== 'active') return fail('INVALID_PARTICIPANT', '请选择当前家庭的有效成员');
      }
      row.participantUserIds = await notebookParticipantUserIds(unit, row, true);
    }
    if (row.noteMemberId) {
      const member = await unit.get('family_members', row.noteMemberId);
      if (!member || member.familyId !== row.familyId || member.status !== 'active') return fail('NOT_FOUND', '家庭成员不存在');
      await unit.put('family_members', { ...member, updatedAt: member.updatedAt });
    }
    for (const userId of row.participantUserIds) {
      const membership = await unit.get('family_memberships', hash(`${row.familyId}/${userId}`));
      const user = await unit.get('users', userId);
      if (!membership || membership.status !== 'active' || !user || user.status !== 'active' || user.activeFamilyId !== row.familyId) return fail('INVALID_PARTICIPANT', '参与人必须是当前家庭的有效账号');
      await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
    }
    for (const [key, kind] of [['listId', 'list'], ['noteId', 'note']] as const) if (row[key]) {
      const linked = await load(unit, row.familyId, row[key]);
      // Existing soft-deleted links remain visible as unavailable; new assignment requires active.
      if (linked.kind !== kind || linked.status !== 'active' && (!previous || previous[key] !== row[key] || linked.status === 'purged')) return fail('INVALID_REFERENCE', '关联内容已删除，请重新选择');
      await unit.put('notebook_entries', { ...linked, referenceFence: linked.referenceFence + 1 });
    }
  }
  async function changeImages(unit: Unit, familyId: string, before: string[], after: string[]) {
    for (const id of [...new Set([...before, ...after])]) {
      const image = await asset(unit, familyId, id, after.includes(id));
      const delta = Number(after.includes(id)) - Number(before.includes(id));
      if (delta) await unit.put('notebook_assets', { ...image, refCount: Math.max(0, image.refCount + delta), updatedAt: now() });
    }
  }
  async function signImages(userId: string, familyId: string, ids: string[]) {
    const images = await Promise.all(ids.map(id => asset(repo, familyId, id)));
    const urls: Record<string, string> = {};
    for (let offset = 0; offset < images.length; offset += 50) Object.assign(urls, await storage.urls(images.slice(offset, offset + 50).map(v => v.fileId)));
    for (const image of images) {
      const fresh = await asset(repo, familyId, image._id);
      if (fresh.fileId !== image.fileId) return fail('NOT_FOUND', '图片已变化，请刷新后重试');
    }
    await auth(repo, userId, familyId);
    return images.map(row => ({ id: row._id, url: urls[row.fileId] || '' }));
  }
  async function views(userId: string, familyId: string, rows: NotebookRecord[]): Promise<NotebookEntry[]> {
    const imageIds = [...new Set(rows.filter(v => v.status === 'active').flatMap(v => v.imageIds))];
    const images = await signImages(userId, familyId, imageIds);
    // Re-read records after URL signing. A concurrent purge/delete must not issue a fresh image.
    const current = await Promise.all(rows.map(row => load(repo, familyId, row._id)));
    await auth(repo, userId, familyId);
    const result = await Promise.all(current.map(async row => {
      const { _id, familyId: _familyId, imageIds: ids, requestFingerprint: _fingerprint, referenceFence: _fence, cleanupAssetIds: _cleanup, ...entry } = row;
      return { ...entry, participantUserIds: await notebookParticipantUserIds(repo, row), id: _id, images: row.status === 'active' ? ids.map(id => images.find(v => v.id === id)).filter((v): v is { id: string; url: string } => Boolean(v)) : [] };
    }));
    await auth(repo, userId, familyId);
    return result;
  }
  async function page(userId: string, familyId: string, input: Input) {
    const status = input.status === undefined ? 'active' : input.status;
    if (!['active', 'deleted'].includes(String(status))) return fail('INVALID_INPUT', '列表状态无效');
    const limit = input.limit === undefined ? 50 : input.limit;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) return fail('INVALID_INPUT', '每页最多100条');
    const filter: Partial<NotebookRecord> = { familyId, status: status as 'active' | 'deleted' };
    if (input.kind !== undefined) {
      if (!['event', 'list', 'note'].includes(String(input.kind))) return fail('INVALID_INPUT', '类型无效');
      filter.kind = input.kind as NotebookRecord['kind'];
    }
    const rows = await repo.list('notebook_entries', filter, { before: decodeCursor(input.cursor, familyId), limit: Number(limit) });
    // A full page always advertises a continuation; an exact multiple may require one empty final page.
    return { items: await views(userId, familyId, rows), cursor: rows.length === limit ? encodeCursor(rows[rows.length - 1]) : '' };
  }
  async function context(userId: string) {
    const scope = await auth(repo, userId);
    const [members, memberships] = await Promise.all([
      all(repo, 'family_members', { familyId: scope.familyId, status: 'active' }),
      all(repo, 'family_memberships', { familyId: scope.familyId, status: 'active' }),
    ]);
    const users = await Promise.all(memberships.map(v => repo.get('users', v.userId)));
    const accounts = memberships.filter(v => users.some(u => u?._id === v.userId && u.status === 'active' && u.activeFamilyId === scope.familyId)).map(v => {
      const profile = members.find(m => m.linkedUserId === v.userId), user = users.find(u => u?._id === v.userId);
      return { userId: v.userId, name: profile?.name || user?.username || `家人 ${v.userId.slice(-4)}`, memberId: profile?._id || '', isSelf: v.userId === userId };
    });
    await auth(repo, userId, scope.familyId);
    return { ...scope, members: members.sort((a, b) => a.sortOrder - b.sortOrder).map(m => ({ id: m._id, name: m.name, linkedUserId: m.linkedUserId, version: m.version })), accounts };
  }
  async function upload(userId: string, input: Input, expectedFamilyId: string) {
    const key = requestId(input.requestId), base64 = text(input.photoBase64, 700000), fingerprint = hash(base64);
    const claimed = await repo.transaction(async unit => {
      const scope = await auth(unit, userId, expectedFamilyId), id = hash(`notebook/image/${scope.familyId}/${userId}/${key}`).slice(0, 40);
      const old = await unit.get('notebook_assets', id);
      if (old) {
        if (old.fingerprint !== fingerprint) return fail('REQUEST_CONFLICT', '请求编号已用于其他图片');
        return { row: old, owner: false };
      }
      const row: NotebookAsset = { _id: id, familyId: scope.familyId, createdBy: userId, createdAt: now(), updatedAt: now(), status: 'uploading', fileId: '', cloudPath: `notebook/${scope.familyId}/${id}.jpg`, fingerprint, refCount: 0 };
      await unit.put('notebook_assets', row); return { row, owner: true };
    });
    const row = claimed.row;
    if (!claimed.owner) {
      if (row.status !== 'active') return fail(row.status === 'uploading' ? 'UPLOAD_RUNNING' : 'UPLOAD_FAILED', '图片尚未可用，请检查原请求');
      return (await signImages(userId, row.familyId, [row._id]))[0];
    }
    let fileId = '';
    try {
      fileId = await storage.upload(row.cloudPath, base64);
      await repo.transaction(async unit => {
        await auth(unit, userId, row.familyId);
        const current = await asset(unit, row.familyId, row._id, false);
        if (current.status !== 'uploading') return fail('UPLOAD_FAILED', '上传状态已变化');
        await unit.put('notebook_assets', { ...current, fileId, status: 'active', updatedAt: now() });
      });
    } catch (error) {
      if (fileId) {
        // A rejected commit acknowledgement does not prove that activation failed.
        // Verify durable state before touching the uploaded object.
        let persisted: NotebookAsset | null;
        try { persisted = await repo.get('notebook_assets', row._id); }
        catch { return fail('UPLOAD_UNKNOWN', '上传结果暂不确定，图片已保留，请重查原请求'); }
        const published = (current: NotebookAsset | null) => current?.status === 'active' && current.fileId === fileId
          && current.cloudPath === row.cloudPath && current.fingerprint === fingerprint;
        if (published(persisted)) return (await signImages(userId, row.familyId, [row._id]))[0];
        // Claim compensation with a write fence. A late activation transaction must
        // conflict with this state change, rather than publishing an object we delete.
        try {
          await repo.transaction(async unit => {
            const current = await unit.get('notebook_assets', row._id);
            if (current?.status === 'uploading' && current.fingerprint === fingerprint && current.cloudPath === row.cloudPath)
              await unit.put('notebook_assets', { ...current, fileId, status: 'failed', updatedAt: now() });
            else if (current?.status === 'deleted' && current.refCount === 0 && current.fingerprint === fingerprint && current.cloudPath === row.cloudPath)
              // A timer may claim an expired in-flight upload. Preserve the late
              // object handle in the claimed row so maintenance can remove it.
              await unit.put('notebook_assets', { ...current, cleanupFileIds: [...new Set([...(current.cleanupFileIds || []), fileId])], updatedAt: now() });
          });
          persisted = await repo.get('notebook_assets', row._id);
        } catch { return fail('UPLOAD_UNKNOWN', '上传结果暂不确定，图片已保留，请重查原请求'); }
        if (published(persisted)) return (await signImages(userId, row.familyId, [row._id]))[0];
        if (!persisted || persisted.status !== 'failed' || persisted.fileId !== fileId || persisted.refCount
          || persisted.cloudPath !== row.cloudPath || persisted.fingerprint !== fingerprint)
          return fail('UPLOAD_UNKNOWN', '上传结果暂不确定，图片已保留，请重查原请求');
        try { await storage.remove(fileId); }
        catch { return fail('CLEANUP_PENDING', '图片清理未完成，请稍后重试原请求'); }
        throw error;
      }
      await repo.transaction(async unit => {
        const current = await unit.get('notebook_assets', row._id);
        if (current?.status === 'uploading' && current.fingerprint === fingerprint)
          await unit.put('notebook_assets', { ...current, status: 'failed', updatedAt: now() });
      });
      throw error;
    }
    return (await signImages(userId, row.familyId, [row._id]))[0];
  }
  async function cleanup(userId: string, row: NotebookRecord) {
    let pending = false;
    for (const id of row.cleanupAssetIds) {
      const image = await asset(repo, row.familyId, id, false);
      // Asset claim is transactional: a concurrent assignment cannot race physical deletion.
      const removing = await repo.transaction(async unit => {
        await auth(unit, userId, row.familyId);
        const fresh = await asset(unit, row.familyId, id, false);
        if (fresh.refCount) return false;
        await unit.put('notebook_assets', { ...fresh, status: 'deleted', updatedAt: now() }); return true;
      });
      if (!removing) continue;
      try { if (image.fileId) await storage.remove(image.fileId); }
      catch { pending = true; continue; }
      await repo.transaction(async unit => {
        const image = await asset(unit, row.familyId, id, false);
        if (image.status === 'deleted') await unit.put('notebook_assets', { ...image, fileId: '', cloudPath: '', fingerprint: '' });
      });
    }
    if (pending) return fail('CLEANUP_PENDING', '内容已移除，图片清理未完成，请重试原删除操作');
    await repo.transaction(async unit => {
      await auth(unit, userId, row.familyId); const current = await load(unit, row.familyId, row._id);
      await unit.put('notebook_entries', { ...current, cleanupAssetIds: [] });
    });
  }
  const ai = createNotebookAi({ repo, now, provider: options.provider, dailyLimit: options.dailyLimit, auth, context,
    events: familyId => all(repo, 'notebook_entries', { familyId, kind: 'event', status: 'active' }) });

  async function handle(input: Input, identity: Identity): Promise<unknown> {
    const userId = identityUserId(identity);
    if (!userId) return fail('UNAUTHENTICATED', '请重新登录');
    const expectedFamilyId = text(input.expectedFamilyId, 120, true), familyId = text(input.familyId, 120, true);
    if (expectedFamilyId && familyId && expectedFamilyId !== familyId) return fail('NO_FAMILY', '家庭信息不一致，请刷新后重试');
    const action = text(input.action, 40), scope = await auth(repo, userId, expectedFamilyId || familyId);
    if (action.startsWith('cycle.')) {
      const { expectedFamilyId: _expected, familyId: _family, ...data } = input;
      return action.startsWith('cycle.ai.') ? cycleAi.handle(data, userId, scope.familyId) : cycle.handle(data, userId, scope.familyId);
    }
    if (action.startsWith('ai.')) return ai.handle(input, userId, scope.familyId);
    if (action === 'reminders.subscribe') {
      const { expectedFamilyId: _expected, familyId: _family, ...data } = input;
      return reminders.subscribe(data, identity);
    }
    if (['reminders.device.register', 'reminders.device.unregister', 'reminders.preference', 'reminders.status'].includes(action)) {
      const { expectedFamilyId: _expected, familyId: _family, ...data } = input;
      return androidReminders.handle(data, userId, scope.familyId, identitySession(identity));
    }
    if (action === 'images.upload') return upload(userId, input, scope.familyId);
    if (action === 'images.get') return signImages(userId, scope.familyId, strings(input.imageIds, 100));
    if (action === 'list') return page(userId, scope.familyId, input);
    if (action === 'home') {
      const [ctx, result] = await Promise.all([context(userId), page(userId, scope.familyId, { ...input, status: 'active' })]);
      if (ctx.familyId !== scope.familyId) return fail('NO_FAMILY', '家庭权限已变化');
      await auth(repo, userId, scope.familyId);
      const home: NotebookHome = { userId, familyId: ctx.familyId, familyName: ctx.family.name, members: ctx.members, accounts: ctx.accounts,
        entries: result.items, cursor: result.cursor, capabilities: { ai: Boolean(options.provider?.configured),
          wechatReminder: reminderConfig.enabled, wechatTemplateId: reminderConfig.enabled ? reminderConfig.templateId : '' } };
      return home;
    }
    if (action === 'get') return (await views(userId, scope.familyId, [await load(repo, scope.familyId, text(input.entryId))]))[0];
    if (action === 'profile.link') {
      const profiles = await all(repo, 'family_members', { familyId: scope.familyId, status: 'active' });
      return repo.transaction(async unit => {
        const currentScope = await auth(unit, userId, scope.familyId), id = text(input.memberId);
        const member = await unit.get('family_members', id);
        if (!member || member.familyId !== scope.familyId || member.status !== 'active') return fail('NOT_FOUND', '家庭成员不存在');
        checkVersion(member, input.version);
        if (member.linkedUserId && member.linkedUserId !== userId) return fail('PROFILE_OWNED', '该档案已绑定其他账号');
        for (const p of profiles) if (p._id !== id) {
          const fresh = await unit.get('family_members', p._id);
          if (fresh?.linkedUserId === userId) return fail('PROFILE_ALREADY_LINKED', '本人已绑定其他成员档案，请先处理原绑定');
        }
        // Per-account fence serializes concurrent claims of two unbound profiles.
        await unit.put('users', { ...currentScope.user, notebookFence: (currentScope.user.notebookFence || 0) + 1 });
        if (!member.linkedUserId) await unit.put('family_members', { ...member, linkedUserId: userId, version: member.version + 1, updatedBy: userId, updatedAt: now() });
        return { memberId: id };
      });
    }
    if (action === 'create' || action === 'copy') {
      const key = requestId(input.requestId);
      const raw = action === 'create' ? object(input.entry) : { entryId: text(input.entryId), version: input.version };
      const fingerprint = hash(canonical({ action, raw }));
      const row = await repo.transaction(async unit => {
        await auth(unit, userId, scope.familyId);
        const id = hash(`notebook/entry/${scope.familyId}/${userId}/${key}`).slice(0, 40);
        const old = await unit.get('notebook_entries', id);
        if (old) { if (old.requestFingerprint !== fingerprint) return fail('REQUEST_CONFLICT', '请求编号已用于其他内容'); return old; }
        let row = blank(id, scope.familyId, userId, now());
        if (action === 'copy') {
          const source = await load(unit, scope.familyId, text(input.entryId)); checkVersion(source, input.version);
          if (source.status !== 'active' || source.kind !== 'list') return fail('INVALID_INPUT', '仅支持复制有效清单');
          row = { ...row, kind: 'list', category: source.category || '其他', title: source.title, body: source.body, imageIds: [...source.imageIds], items: source.items.map(item => ({ ...item, done: false, completedBy: '', completedAt: null })) };
        } else row = applyPatch(row, raw, userId, now(), true);
        row.requestFingerprint = fingerprint;
        await validateReferences(unit, row); await changeImages(unit, scope.familyId, [], row.imageIds);
        await unit.put('notebook_entries', row); return row;
      });
      return (await views(userId, scope.familyId, [row]))[0];
    }
    if (!['update', 'delete', 'restore', 'purge', 'toggle'].includes(action)) return fail('INVALID_ACTION', '暂不支持此操作');
    const entryId = text(input.entryId);
    let row = await repo.transaction(async unit => {
      await auth(unit, userId, scope.familyId); const before = await load(unit, scope.familyId, entryId);
      if (action === 'purge' && before.status === 'purged') {
        if (input.version !== before.version && Number(input.version) + 1 !== before.version) checkVersion(before, input.version);
        return before;
      }
      checkVersion(before, input.version);
      if (action === 'purge' || action === 'restore') {
        if (before.status !== 'deleted') return fail('INVALID_STATE', '内容不在回收站');
      } else if (before.status !== 'active') return fail('INVALID_STATE', '内容已删除');
      let changed: NotebookRecord = { ...before, version: before.version + 1, updatedBy: userId, updatedAt: now() };
      if (action === 'update') {
        changed = applyPatch(changed, object(input.patch), userId, now());
        changed.cleanupAssetIds = [...new Set([...before.cleanupAssetIds, ...before.imageIds.filter(id => !changed.imageIds.includes(id))])];
        await validateReferences(unit, changed, before); await changeImages(unit, scope.familyId, before.imageIds, changed.imageIds);
      }
      if (action === 'toggle') {
        if (before.kind !== 'list' || typeof input.done !== 'boolean') return fail('INVALID_INPUT', '清单操作无效');
        const id = text(input.itemId); if (!before.items.some(item => item.id === id)) return fail('NOT_FOUND', '清单项目不存在');
        changed.items = before.items.map((item): NotebookItem => item.id === id ? { ...item, done: input.done as boolean, completedBy: input.done ? userId : '', completedAt: input.done ? now() : null } : item);
      }
      if (action === 'delete') { changed.status = 'deleted'; changed.deletedAt = now(); }
      if (action === 'restore') {
        if (before.deletedAt === null || now() >= before.deletedAt + RETENTION) return fail('RESTORE_EXPIRED', '已超过30天恢复期限');
        changed.status = 'active'; changed.deletedAt = null;
      }
      if (action === 'purge') {
        await changeImages(unit, scope.familyId, before.imageIds, []);
        changed = { ...blank(before._id, before.familyId, before.createdBy, before.createdAt), kind: before.kind, status: 'purged',
          version: changed.version, updatedBy: userId, updatedAt: now(), deletedAt: before.deletedAt,
          requestFingerprint: before.requestFingerprint, cleanupAssetIds: [...new Set([...before.imageIds, ...before.cleanupAssetIds])] };
      }
      await unit.put('notebook_entries', changed); return changed;
    });
    if (action === 'purge') {
      await cleanup(userId, row); row = await load(repo, scope.familyId, row._id);
      // Catch links created before the purge committed but not included in the initial scan.
      for (const event of (await all(repo, 'notebook_entries', { familyId: scope.familyId, kind: 'event' })).filter(e => e.listId === entryId || e.noteId === entryId)) {
        await repo.transaction(async unit => {
          await auth(unit, userId, scope.familyId); const fresh = await load(unit, scope.familyId, event._id);
          if (fresh.listId === entryId || fresh.noteId === entryId) await unit.put('notebook_entries', { ...fresh,
            listId: fresh.listId === entryId ? '' : fresh.listId, noteId: fresh.noteId === entryId ? '' : fresh.noteId,
            version: fresh.version + 1, updatedBy: userId, updatedAt: now() });
        });
      }
    }
    return (await views(userId, scope.familyId, [row]))[0];
  }
  return { handle };
}
