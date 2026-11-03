import { createHash, randomUUID } from 'node:crypto';
import { identityUserId } from './identity';
import { BusinessError } from './service';
import { Identity, Input, Repository, Unit } from './model';
import { NotebookRecord, NotebookReminderDelivery } from './notebook-model';
import { notebookParticipantUserIds } from './notebook-participants';

type LogicalField = 'title' | 'dateTime' | 'place' | 'participants';
export interface NotebookWechatConfig {
  enabled: boolean; templateId: string; fields: Record<string, LogicalField>;
  state: 'developer' | 'trial' | 'formal';
}
export interface NotebookWechatMessage {
  touser: string; templateId: string; page: string;
  data: Record<string, { value: string }>; miniprogramState: NotebookWechatConfig['state'];
}
export interface NotebookReminderOptions {
  config: NotebookWechatConfig; now?: () => number;
  send?: (message: NotebookWechatMessage) => Promise<{ errCode?: number; errcode?: number }>;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
const LATE_WINDOW = 5 * 60_000;
const LEASE = 60_000;
const MAX_SCAN = 300;
const MAX_SEND = 50;

/** Missing/invalid template metadata never silently enables notifications. */
export function readNotebookWechatConfig(env: Record<string, string | undefined>): NotebookWechatConfig {
  const off: NotebookWechatConfig = { enabled: false, templateId: '', fields: {}, state: 'formal' };
  const templateId = env.NOTEBOOK_WECHAT_TEMPLATE_ID || '', state = env.NOTEBOOK_WECHAT_STATE || 'formal';
  if (env.NOTEBOOK_WECHAT_ENABLED !== '1' || !/^[A-Za-z0-9_-]{1,128}$/.test(templateId) || !['developer', 'trial', 'formal'].includes(state)) return off;
  try {
    const fields: unknown = JSON.parse(env.NOTEBOOK_WECHAT_TEMPLATE_FIELDS || '');
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return off;
    const pairs = Object.entries(fields);
    if (!pairs.length || pairs.length > 5 || pairs.some(([key, value]) => !/^(thing|time|date|character_string)\d{1,3}$/.test(key)
      || !['title', 'dateTime', 'place', 'participants'].includes(String(value))
      || (value === 'dateTime' ? !/^(time|date)\d/.test(key) : !/^(thing|character_string)\d/.test(key)))) return off;
    if (!pairs.some(([, value]) => value === 'title') || !pairs.some(([, value]) => value === 'dateTime')) return off;
    return { enabled: true, templateId, fields: fields as Record<string, LogicalField>, state: state as NotebookWechatConfig['state'] };
  } catch { return off; }
}

export function assertNotebookTimer(event: Input, context: { source: string; openid: string }): void {
  // Event.Type alone is caller-controlled. An unknown runtime source fails closed.
  if (context.source !== 'timer' || context.openid || event.Type !== 'Timer') fail('FORBIDDEN', '仅允许可信定时触发');
}

function reminderAt(row: NotebookRecord): number | null {
  if (row.kind !== 'event' || row.status !== 'active' || row.eventState !== 'planned' || row.reminderMinutes === null
    || !Number.isInteger(row.reminderMinutes) || row.reminderMinutes < 0 || row.reminderMinutes > 1440
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)) return null;
  const start = Date.parse(`${row.date}T${row.startTime}:00+08:00`);
  return Number.isFinite(start) ? start - row.reminderMinutes * 60_000 : null;
}
function due(row: NotebookRecord, now: number) {
  const time = reminderAt(row);
  return time !== null && time <= now && time >= now - LATE_WINDOW;
}
const subscriptionId = (entryId: string, userId: string) => hash(`notebook/subscription/${entryId}/${userId}`);
// Content edits and detached links do not create a different reminder plan.
const scheduleFingerprint = (row: NotebookRecord) => hash(JSON.stringify([
  row.familyId, row._id, row.date, row.startTime, row.reminderMinutes,
  row.participantMemberIds === undefined ? [...new Set(row.participantUserIds)].sort() : { members: [...new Set(row.participantMemberIds)].sort() },
]));
const deliveryId = (entryId: string, fingerprint: string, userId: string) => hash(`notebook/delivery/${entryId}/${fingerprint}/${userId}/wechat`);
function beijingDate(now: number) { return new Date(now + 8 * 3600_000).toISOString().slice(0, 10); }

export function createNotebookReminders(repo: Repository, options: NotebookReminderOptions) {
  const now = options.now || Date.now, config = options.config;
  async function account(unit: Unit, userId: string, familyId: string, fence = false) {
    const user = await unit.get('users', userId);
    const family = await unit.get('families', familyId);
    const membership = await unit.get('family_memberships', hash(`${familyId}/${userId}`));
    if (!user || user.status !== 'active' || user.activeFamilyId !== familyId || !family || family.status !== 'active'
      || !membership || membership.status !== 'active' || membership.familyId !== familyId || membership.userId !== userId) return null;
    if (fence) {
      await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
      await unit.put('users', { ...user, notebookFence: (user.notebookFence || 0) + 1 });
    }
    return user;
  }
  async function subscribe(input: Input, identity: Identity) {
    if (Object.keys(input).some(key => !['action', 'entryId', 'version', 'userInfo', 'tcbContext'].includes(key))) return fail('INVALID_INPUT', '提醒登记参数无效');
    const userId = identityUserId(identity);
    if (!userId) return fail('UNAUTHENTICATED', '请重新登录');
    if (typeof input.entryId !== 'string' || !input.entryId || input.entryId.length > 120 || !Number.isSafeInteger(input.version)) return fail('INVALID_INPUT', '日程信息无效');
    if (!config.enabled) return { enabled: false, message: '微信提醒尚未开通，日程已保存' };
    return repo.transaction(async unit => {
      const row = await unit.get('notebook_entries', input.entryId as string);
      if (!row || !await account(unit, userId, row.familyId, true)) return fail('NOT_FOUND', '日程不存在或无权访问');
      if (row.version !== input.version) return fail('CONFLICT', '日程已被家人修改，请刷新后重试');
      if (!(await notebookParticipantUserIds(unit, row, true)).includes(userId)) return fail('FORBIDDEN', '仅参与人可开启自己的提醒');
      if (reminderAt(row) === null) return { enabled: false, message: '请为有效日程设置具体时间及一天以内的提醒' };
      const user = await unit.get('users', userId);
      if (!user?._openid) return { enabled: false, message: '请先使用微信小程序账号绑定后开启微信提醒' };
      const id = subscriptionId(row._id, userId), previous = await unit.get('notebook_reminder_subscriptions', id);
      await unit.put('notebook_reminder_subscriptions', { _id: id, familyId: row.familyId, entryId: row._id,
        entryVersion: row.version, scheduleFingerprint: scheduleFingerprint(row), userId,
        templateId: config.templateId, createdAt: previous?.createdAt || now(), updatedAt: now() });
      await unit.put('notebook_entries', { ...row, referenceFence: row.referenceFence + 1 });
      // The registration records this account's request, not WeChat quota or receipt.
      return { enabled: true, message: '已登记本日程的微信提醒，实际发送以微信订阅权限为准' };
    });
  }
  async function eligible(unit: Unit, snapshot: NotebookRecord, userId: string) {
    const row = await unit.get('notebook_entries', snapshot._id);
    if (!row || row.familyId !== snapshot.familyId || scheduleFingerprint(row) !== scheduleFingerprint(snapshot)
      || !due(row, now()) || !(await notebookParticipantUserIds(unit, row, true)).includes(userId)) return null;
    const user = await account(unit, userId, row.familyId, true);
    const sub = await unit.get('notebook_reminder_subscriptions', subscriptionId(row._id, userId));
    if (!user?._openid || !sub || sub.entryId !== row._id || sub.familyId !== row.familyId || sub.userId !== userId
      || sub.scheduleFingerprint !== scheduleFingerprint(row) || sub.templateId !== config.templateId) return null;
    // Snapshot-isolation protection: cancellation/edit and membership removal write
    // these same documents and therefore conflict with a concurrent claim.
    await unit.put('notebook_entries', { ...row, referenceFence: row.referenceFence + 1 });
    return { row, openid: user._openid };
  }
  async function deliver(snapshot: NotebookRecord, userId: string) {
    const id = deliveryId(snapshot._id, scheduleFingerprint(snapshot), userId), claimToken = randomUUID();
    const claimed = await repo.transaction(async unit => {
      const old = await unit.get('notebook_reminder_deliveries', id);
      if (old && (old.status !== 'claimed' || old.leaseUntil > now())) return false;
      if (!await eligible(unit, snapshot, userId)) return false;
      await unit.put('notebook_reminder_deliveries', { _id: id, familyId: snapshot.familyId, entryId: snapshot._id,
        entryVersion: snapshot.version, userId, channel: 'wechat', status: 'claimed', claimToken,
        leaseUntil: now() + LEASE, createdAt: old?.createdAt || now(), updatedAt: now(), errorCode: '' });
      return true;
    });
    if (!claimed) return false;
    const fresh = await repo.transaction(async unit => {
      const ledger = await unit.get('notebook_reminder_deliveries', id);
      if (!ledger || ledger.claimToken !== claimToken || ledger.status !== 'claimed' || ledger.leaseUntil <= now()) return null;
      const recipient = await eligible(unit, snapshot, userId);
      await unit.put('notebook_reminder_deliveries', { ...ledger, status: recipient ? 'sending' : 'cancelled', updatedAt: now() });
      return recipient;
    });
    if (!fresh) return false;
    // Once sending is persisted, a crash/network timeout is ambiguous and MUST NOT
    // be retried automatically. Database commit and an external API are not atomic.
    let status: NotebookReminderDelivery['status'] = 'unknown', errorCode = '';
    try {
      const logical = { title: fresh.row.title, dateTime: `${fresh.row.date} ${fresh.row.startTime}`, place: fresh.row.place || '未填写地点', participants: '本日程参与家人' };
      const data = Object.fromEntries(Object.entries(config.fields).map(([key, value]) => [key, { value: value === 'dateTime'
        ? key.startsWith('date') ? fresh.row.date : logical.dateTime
        : Array.from(logical[value]).slice(0, 20).join('') }]));
      const result = await options.send!({ touser: fresh.openid, templateId: config.templateId,
        page: `pages/notebook/index?entryId=${encodeURIComponent(fresh.row._id)}`, data, miniprogramState: config.state });
      const code = result.errCode ?? result.errcode;
      status = code === 0 ? 'accepted' : code !== undefined ? 'rejected' : 'unknown';
      errorCode = typeof code === 'number' ? String(code) : 'UNKNOWN_RESULT';
    } catch (error) {
      const code = error && typeof error === 'object' ? (error as { errCode?: unknown; errcode?: unknown }).errCode ?? (error as { errcode?: unknown }).errcode : undefined;
      if (code === 43101) { status = 'rejected'; errorCode = '43101'; } else errorCode = 'SEND_RESULT_UNKNOWN';
    }
    await repo.transaction(async unit => {
      const ledger = await unit.get('notebook_reminder_deliveries', id);
      if (ledger?.claimToken === claimToken && ledger.status === 'sending') await unit.put('notebook_reminder_deliveries', { ...ledger, status, errorCode, updatedAt: now() });
    });
    return true;
  }
  async function run() {
    const stats = { enabled: config.enabled && Boolean(options.send), scanned: 0, attempted: 0 };
    if (!stats.enabled) return stats;
    const timestamp = now();
    const dates = [...new Set([beijingDate(timestamp - LATE_WINDOW), beijingDate(timestamp), beijingDate(timestamp + 86400_000)])];
    for (const date of dates) {
      const scanId = `wechat-${date}`, scan = await repo.get('notebook_reminder_scans', scanId);
      let before = scan?.before || undefined, finished = false;
      // A persistent per-date continuation prevents repeatedly scanning only page 1.
      while (stats.scanned < MAX_SCAN && stats.attempted < MAX_SEND && !finished) {
        const rows = await repo.list('notebook_entries', { kind: 'event', status: 'active', date }, { before, limit: 50 });
        if (!rows.length) { before = undefined; break; }
        for (const row of rows) {
          if (stats.scanned >= MAX_SCAN || stats.attempted >= MAX_SEND) break;
          stats.scanned++;
          if (due(row, now())) for (const userId of [...new Set(await notebookParticipantUserIds(repo, row))]) if (await deliver(row, userId)) stats.attempted++;
          before = { createdAt: row.createdAt, id: row._id };
        }
        finished = rows.length < 50;
        if (finished) before = undefined;
      }
      await repo.put('notebook_reminder_scans', { _id: scanId, date, before: before || null, createdAt: scan?.createdAt || now(), updatedAt: now() });
    }
    return stats;
  }
  return { subscribe, run };
}
