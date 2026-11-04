import { createHash, randomUUID } from 'node:crypto';
import { Input, Repository, Unit } from './model';
import { NotebookRecord } from './notebook-model';
import {
  NotebookAndroidDelivery, NotebookAndroidSender, NotebookPushDevice, notebookReminderSettings,
  NotebookReminderPreference, NotebookReminderSession, NotebookReminderStatus,
  NotebookAndroidNotSubmittedError,
} from './notebook-notification-model';
import { notebookParticipantUserIds } from './notebook-participants';
import { BusinessError } from './service';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
const WINDOW = 5 * 60_000, LEASE = 60_000, MAX_SCAN = 300, MAX_SEND = 50;
const cidPattern = /^[A-Za-z0-9_-]{16,128}$/;
const keyPattern = /^[A-Za-z0-9_-]{32,128}$/;
export const notebookReminderPreferenceId = (familyId: string, userId: string) => hash(`notebook/preference/${familyId}/${userId}`);
const deviceId = (cid: string) => hash(`notebook/device/${cid}`);
const dateAt = (time: number) => new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
const fingerprint = (row: NotebookRecord) => hash(JSON.stringify([
  row.familyId, row._id, row.date, row.startTime, row.reminderMinutes,
  row.participantMemberIds === undefined ? [...new Set(row.participantUserIds)].sort() : { members: [...new Set(row.participantMemberIds)].sort() },
]));
function reminderAt(row: NotebookRecord): number | null {
  if (row.kind !== 'event' || row.status !== 'active' || row.eventState !== 'planned'
    || row.reminderMinutes === null || !Number.isInteger(row.reminderMinutes) || row.reminderMinutes < 0 || row.reminderMinutes > 1440
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)) return null;
  const start = Date.parse(`${row.date}T${row.startTime}:00+08:00`);
  if (!Number.isFinite(start) || dateAt(start) !== row.date) return null;
  return start - row.reminderMinutes * 60_000;
}
function due(row: NotebookRecord, time: number) {
  const at = reminderAt(row);
  return at !== null && at <= time && at + WINDOW > time;
}

export function createNotebookAndroidReminders(repo: Repository, options: { now?: () => number; configured: boolean; offlineAvailable?: boolean; send?: NotebookAndroidSender }) {
  const now = options.now || Date.now;
  async function account(unit: Unit, userId: string, familyId: string, fence = false) {
    const user = await unit.get('users', userId), family = await unit.get('families', familyId);
    const membership = await unit.get('family_memberships', hash(`${familyId}/${userId}`));
    if (!user || user.status !== 'active' || user.activeFamilyId !== familyId || !family || family.status !== 'active'
      || !membership || membership.familyId !== familyId || membership.userId !== userId || membership.status !== 'active') return false;
    if (fence) {
      await unit.put('users', { ...user, notebookFence: (user.notebookFence || 0) + 1 });
      await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
    }
    return true;
  }
  async function preference(unit: Unit, userId: string, familyId: string) {
    return unit.get('notebook_reminder_preferences', notebookReminderPreferenceId(familyId, userId));
  }
  async function validSession(unit: Unit, userId: string, session: NotebookReminderSession, fence = false) {
    if (!session.id || !Number.isFinite(session.expiresAt) || session.expiresAt <= now()) return false;
    const row = await unit.get('auth_sessions', session.id);
    if (!row || row.userId !== userId || row.revokedAt !== null || row.expiresAt <= now() || row.expiresAt !== session.expiresAt) return false;
    const authAccount = await unit.get('auth_accounts', row.accountId);
    if (!authAccount || authAccount.status !== 'active' || authAccount.userId !== userId) return false;
    if (fence) {
      await unit.put('auth_sessions', { ...row });
      await unit.put('auth_accounts', { ...authAccount });
    }
    return true;
  }
  async function devices(userId: string, familyId: string) {
    const rows = await repo.list('notebook_push_devices', { userId, familyId, status: 'active' }, { limit: 100 });
    const valid: NotebookPushDevice[] = [];
    for (const row of rows) if (await validSession(repo, userId, { id: row.authSessionId, expiresAt: row.expiresAt })) valid.push(row);
    return valid;
  }
  async function status(userId: string, familyId: string): Promise<NotebookReminderStatus> {
    const [pref, rows] = await Promise.all([preference(repo, userId, familyId), devices(userId, familyId)]);
    // Device registration alone never changes either reminder preference.
    return { ...notebookReminderSettings(pref), androidAvailable: options.configured, androidOfflineAvailable: Boolean(options.offlineAvailable),
      registeredDevices: rows.filter(row => row.notificationsEnabled).length,
      ...(rows.length ? { notificationPermission: rows.some(row => row.notificationsEnabled) } : {}) };
  }
  async function handle(input: Input, userId: string, familyId: string, session?: NotebookReminderSession): Promise<NotebookReminderStatus> {
    if (!userId) return fail('UNAUTHENTICATED', '请重新登录');
    const action = input.action;
    const fields: Record<string, string[]> = {
      'reminders.device.register': ['cid', 'installationKey', 'notificationsEnabled'],
      'reminders.device.unregister': ['cid', 'installationKey'],
      'reminders.preference': ['channel', 'enabled'], 'reminders.status': [],
    };
    if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(fields, action)) return fail('INVALID_ACTION', '不支持此提醒操作');
    if (Object.keys(input).some(key => key !== 'action' && !fields[action].includes(key))) return fail('INVALID_INPUT', '提醒参数无效');
    if (!familyId || !await account(repo, userId, familyId)) return fail('NO_FAMILY', '家庭权限已变化，请刷新');
    if (action.startsWith('reminders.device.')) {
      const cid = input.cid, installationKey = input.installationKey;
      if (typeof cid !== 'string' || !cidPattern.test(cid) || typeof installationKey !== 'string' || !keyPattern.test(installationKey)
        || action === 'reminders.device.register' && typeof input.notificationsEnabled !== 'boolean') return fail('INVALID_INPUT', '设备登记参数无效');
      if (!session) return fail('UNAUTHENTICATED', '请重新登录后登记设备');
      await repo.transaction(async unit => {
        if (!await account(unit, userId, familyId, true)) return fail('NO_FAMILY', '家庭权限已变化，请刷新');
        if (!await validSession(unit, userId, session, true)) return fail('UNAUTHENTICATED', '登录已失效，请重新登录');
        const id = deviceId(cid), old = await unit.get('notebook_push_devices', id), keyHash = hash(installationKey);
        if (old && old.installationKeyHash !== keyHash) return fail('FORBIDDEN', '设备登记信息不一致，请重新安装后重试');
        if (action === 'reminders.device.unregister') {
          if (!old) return;
          if (old.userId !== userId || old.familyId !== familyId || old.authSessionId !== session.id) return fail('FORBIDDEN', '设备已绑定其他账号');
          await unit.put('notebook_push_devices', { ...old, status: 'unregistered', notificationsEnabled: false,
            bindingGeneration: old.bindingGeneration + 1, version: old.version + 1, updatedAt: now() });
          return;
        }
        const changedBinding = !old || old.userId !== userId || old.familyId !== familyId || old.status !== 'active' || old.authSessionId !== session.id;
        const row: NotebookPushDevice = { _id: id, cid, installationKeyHash: keyHash, userId, familyId, status: 'active',
          authSessionId: session.id, expiresAt: session.expiresAt,
          notificationsEnabled: input.notificationsEnabled as boolean, bindingGeneration: (old?.bindingGeneration || 0) + (changedBinding ? 1 : 0),
          version: (old?.version || 0) + 1, createdAt: old?.createdAt || now(), updatedAt: now() };
        await unit.put('notebook_push_devices', row);
      });
    } else if (action === 'reminders.preference') {
      if (!['wechat', 'android', 'none'].includes(String(input.channel))) return fail('INVALID_INPUT', '请选择有效提醒渠道');
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return fail('INVALID_INPUT', '提醒开关参数无效');
      // The shipped 312 client used 'none' to turn off its Android channel.
      const channel = input.channel === 'none' ? 'android' : input.channel as 'wechat' | 'android';
      const enabled = input.channel === 'none' ? false : input.enabled !== false;
      if (channel === 'android' && enabled && !options.configured) return fail('ANDROID_REMINDER_UNAVAILABLE', '安卓提醒服务尚未开通');
      const candidates = channel === 'android' && enabled ? await devices(userId, familyId) : [];
      await repo.transaction(async unit => {
        if (!await account(unit, userId, familyId, true)) return fail('NO_FAMILY', '家庭权限已变化，请刷新');
        if (channel === 'android' && enabled) {
          let available = false;
          for (const snapshot of candidates) {
            const row = await unit.get('notebook_push_devices', snapshot._id);
            if (row?.userId === userId && row.familyId === familyId && row.status === 'active' && row.notificationsEnabled
              && await validSession(unit, userId, { id: row.authSessionId, expiresAt: row.expiresAt }, true)) {
              await unit.put('notebook_push_devices', { ...row, version: row.version + 1 }); available = true;
            }
          }
          if (!available) return fail('ANDROID_DEVICE_REQUIRED', '请先在安卓应用中允许通知并登记设备');
        }
        const id = notebookReminderPreferenceId(familyId, userId), old = await unit.get('notebook_reminder_preferences', id);
        const settings = notebookReminderSettings({ ...notebookReminderSettings(old),
          ...(channel === 'android' ? { androidEnabled: enabled } : { wechatEnabled: enabled }) });
        const row: NotebookReminderPreference = { _id: id, familyId, userId, ...settings, version: (old?.version || 0) + 1,
          createdAt: old?.createdAt || now(), updatedAt: now() };
        await unit.put('notebook_reminder_preferences', row);
      });
    }
    if (!await account(repo, userId, familyId)) return fail('NO_FAMILY', '家庭权限已变化，请刷新');
    return status(userId, familyId);
  }
  async function eligible(unit: Unit, snapshot: NotebookRecord, userId: string, deviceSnapshot: NotebookPushDevice) {
    const row = await unit.get('notebook_entries', snapshot._id);
    if (!row || row.familyId !== snapshot.familyId || fingerprint(row) !== fingerprint(snapshot) || !due(row, now())
      || !(await notebookParticipantUserIds(unit, row, true)).includes(userId) || !await account(unit, userId, row.familyId, true)) return null;
    const pref = await preference(unit, userId, row.familyId);
    const device = await unit.get('notebook_push_devices', deviceSnapshot._id);
    if (!pref || pref.familyId !== row.familyId || pref.userId !== userId || !notebookReminderSettings(pref).androidEnabled
      || !device || device.userId !== userId || device.familyId !== row.familyId || device.status !== 'active' || !device.notificationsEnabled
      || device.bindingGeneration !== deviceSnapshot.bindingGeneration || device.installationKeyHash !== deviceSnapshot.installationKeyHash || device.cid !== deviceSnapshot.cid
      || device.authSessionId !== deviceSnapshot.authSessionId || !await validSession(unit, userId, { id: device.authSessionId, expiresAt: device.expiresAt }, true)) return null;
    // Cancellation, channel changes, logout/rebinding and membership edits conflict with these writes.
    await unit.put('notebook_entries', { ...row, referenceFence: row.referenceFence + 1 });
    await unit.put('notebook_reminder_preferences', { ...pref, version: pref.version + 1 });
    await unit.put('notebook_push_devices', { ...device, version: device.version + 1 });
    return { row, device };
  }
  async function deliver(snapshot: NotebookRecord, userId: string, device: NotebookPushDevice) {
    const scheduleFingerprint = fingerprint(snapshot), claimToken = randomUUID();
    const id = hash(`notebook/android/${snapshot._id}/${scheduleFingerprint}/${userId}/${device._id}/${device.bindingGeneration}`);
    const claimed = await repo.transaction(async unit => {
      const old = await unit.get('notebook_android_deliveries', id);
      if (old && (old.status !== 'claimed' || old.leaseUntil > now())) return false;
      if (!await eligible(unit, snapshot, userId, device)) return false;
      const row: NotebookAndroidDelivery = { _id: id, familyId: snapshot.familyId, entryId: snapshot._id, entryVersion: snapshot.version,
        userId, deviceId: device._id, bindingGeneration: device.bindingGeneration, scheduleFingerprint,
        status: 'claimed', claimToken, leaseUntil: now() + LEASE, errorCode: '', createdAt: old?.createdAt || now(), updatedAt: now() };
      await unit.put('notebook_android_deliveries', row);
      return true;
    });
    if (!claimed) return false;
    const fresh = await repo.transaction(async unit => {
      const ledger = await unit.get('notebook_android_deliveries', id);
      if (!ledger || ledger.claimToken !== claimToken || ledger.status !== 'claimed' || ledger.leaseUntil <= now()) return null;
      const recipient = await eligible(unit, snapshot, userId, device);
      await unit.put('notebook_android_deliveries', { ...ledger, status: recipient ? 'sending' : 'cancelled', updatedAt: now() });
      return recipient;
    });
    if (!fresh) return false;
    // Persisting 'sending' precedes the external API; ambiguous submissions are never retried.
    let state: NotebookAndroidDelivery['status'] = 'unknown', errorCode = '';
    try {
      const result = await options.send!({ cid: fresh.device.cid, entryId: fresh.row._id,
        requestId: hash(`${id}/${claimToken}`).slice(0, 32), title: fresh.row.title, date: fresh.row.date,
        startTime: fresh.row.startTime, place: fresh.row.place, expiresAt: reminderAt(fresh.row)! + WINDOW });
      const code = result?.code;
      state = code === 0 ? 'accepted' : typeof code === 'number' && Number.isSafeInteger(code) ? 'rejected' : 'unknown';
      errorCode = typeof code === 'number' && Number.isSafeInteger(code) ? String(code) : 'UNKNOWN_RESULT';
    } catch (error) {
      if (error instanceof NotebookAndroidNotSubmittedError) { state = 'claimed'; errorCode = 'AUTH_RETRYABLE'; }
      else errorCode = 'SEND_RESULT_UNKNOWN';
    }
    await repo.transaction(async unit => {
      const ledger = await unit.get('notebook_android_deliveries', id);
      if (ledger?.claimToken === claimToken && ledger.status === 'sending') await unit.put('notebook_android_deliveries', { ...ledger, status: state,
        ...(state === 'claimed' ? { leaseUntil: 0 } : {}), errorCode, updatedAt: now() });
    });
    return true;
  }
  async function run() {
    const stats = { enabled: options.configured && Boolean(options.send), scanned: 0, attempted: 0 };
    if (!stats.enabled) return stats;
    const timestamp = now();
    const dates = [...new Set([dateAt(timestamp - WINDOW), dateAt(timestamp), dateAt(timestamp + 86400_000)])];
    for (const date of dates) {
      if (stats.scanned >= MAX_SCAN || stats.attempted >= MAX_SEND) break;
      const scanId = `android-${date}`, scan = await repo.get('notebook_reminder_scans', scanId);
      let before = scan?.before || undefined, finished = false;
      while (stats.scanned < MAX_SCAN && stats.attempted < MAX_SEND && !finished) {
        const rows = await repo.list('notebook_entries', { kind: 'event', status: 'active', date }, { before, limit: 50 });
        if (!rows.length) { before = undefined; break; }
        let processed = 0, capped = false;
        for (const row of rows) {
          if (stats.scanned >= MAX_SCAN || stats.attempted >= MAX_SEND) break;
          stats.scanned++; processed++;
          if (due(row, now())) {
            for (const userId of [...new Set(await notebookParticipantUserIds(repo, row))]) {
              const pref = await preference(repo, userId, row.familyId);
              if (!notebookReminderSettings(pref).androidEnabled) continue;
              for (const device of await devices(userId, row.familyId)) {
                if (stats.attempted >= MAX_SEND) { capped = true; break; }
                if (device.notificationsEnabled && await deliver(row, userId, device)) stats.attempted++;
              }
              if (stats.attempted >= MAX_SEND) { capped = true; break; }
            }
          }
          if (capped) break;
          before = { createdAt: row.createdAt, id: row._id };
        }
        finished = !capped && rows.length < 50 && processed === rows.length;
        if (finished) before = undefined;
      }
      await repo.put('notebook_reminder_scans', { _id: scanId, date, before: before || null,
        createdAt: scan?.createdAt || now(), updatedAt: now() });
    }
    return stats;
  }
  return { handle, run };
}
