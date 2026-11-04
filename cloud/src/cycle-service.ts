import { createHash } from 'node:crypto';
import { Input, Repository, Unit } from './model';
import { BusinessError } from './service';
import { CycleDaily, CycleDailyInput, CycleHome, CyclePeriod, CycleProfile, CycleProfileRecord, CycleSettings } from './cycle-model';
import { cyclePrediction, cycleStatistics, cycleToday } from './cycle-core';

const RETENTION = 30 * 86400000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
const profileId = (familyId: string) => hash(`cycle/${familyId}`);

function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_INPUT', '信息格式无效');
  return value as Input;
}
function fields(input: Input, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) return fail('INVALID_INPUT', '信息包含不支持的字段');
}
function text(value: unknown, max = 120): string {
  if (typeof value !== 'string' || !value || value.length > max || value.trim() !== value) return fail('INVALID_INPUT', '请填写有效信息');
  return value;
}
function requestId(value: unknown): string {
  const id = text(value, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return fail('INVALID_INPUT', '请求编号无效');
  return id;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Input)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function fingerprint(input: Input, userId: string): string {
  const { requestId: _request, version: _version, ...payload } = input;
  return hash(canonical({ userId, ...payload }));
}
function date(value: unknown, today: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail('INVALID_INPUT', '日期格式应为YYYY-MM-DD');
  const stamp = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== value || value > today) return fail('INVALID_INPUT', '请填写有效且不晚于今天的实际日期');
  return value;
}
function settings(value: unknown): CycleSettings {
  const input = object(value); fields(input, ['cycleLength', 'periodLength', 'predictionPaused']);
  const length = (v: unknown, min: number, max: number): number | null => {
    if (v === null) return null;
    if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) return fail('INVALID_INPUT', '参考天数超出可填写范围');
    return v as number;
  };
  if (typeof input.predictionPaused !== 'boolean') return fail('INVALID_INPUT', '暂停预测设置无效');
  return { cycleLength: length(input.cycleLength, 15, 60), periodLength: length(input.periodLength, 1, 20), predictionPaused: input.predictionPaused };
}
function periodDates(value: unknown, today: string, editing: boolean): { id?: string; start: string; end: string } {
  const input = object(value); fields(input, editing ? ['id', 'start', 'end'] : ['start', 'end']);
  const start = date(input.start, today), end = input.end === '' ? '' : date(input.end, today);
  if (end && end < start) return fail('INVALID_INPUT', '经期结束日期不能早于开始日期');
  return { ...(input.id === undefined ? {} : { id: text(input.id) }), start, end };
}
function validatePeriods(periods: CyclePeriod[]) {
  const active = periods.filter(row => row.deletedAt === null).sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 0; index < active.length - 1; index++) {
    if (!active[index].end) return fail('INVALID_INPUT', '请先结束上一次经期，再记录下一次');
    if (active[index].end >= active[index + 1].start) return fail('INVALID_INPUT', '实际经期日期不能重叠');
  }
}
function dailyInput(value: unknown, today: string): CycleDailyInput {
  const input = object(value); fields(input, ['date', 'flow', 'symptoms', 'mood', 'intimacy', 'ovulationTest']);
  const choice = <T extends string>(value: unknown, choices: readonly T[]): T => {
    if (typeof value !== 'string' || !choices.includes(value as T)) return fail('INVALID_INPUT', '每日记录选项无效');
    return value as T;
  };
  if (!Array.isArray(input.symptoms) || input.symptoms.length > 30) return fail('INVALID_INPUT', '身体感受选项无效');
  const symptoms = [...new Set(input.symptoms.map(value => choice(value, ['none', 'mild_cramps', 'strong_cramps', 'backache', 'breast_tenderness', 'fatigue', 'headache'] as const)))];
  if (symptoms.includes('none') && symptoms.length > 1) return fail('INVALID_INPUT', '无不适不能与其他身体感受同时选择');
  if (input.intimacy !== null && typeof input.intimacy !== 'boolean') return fail('INVALID_INPUT', '亲密记录选项无效');
  return { date: date(input.date, today), flow: choice(input.flow, ['', 'light', 'medium', 'heavy'] as const), symptoms,
    mood: choice(input.mood, ['', 'happy', 'calm', 'low', 'irritable', 'anxious'] as const), intimacy: input.intimacy,
    ovulationTest: choice(input.ovulationTest, ['', 'negative', 'weak_positive', 'positive'] as const) };
}

interface Options { now?: () => number; aiAvailable?: boolean }
export function createCycleService(repo: Repository, options: Options = {}) {
  const now = options.now ?? Date.now;
  async function auth(unit: Unit, userId: string, expectedFamilyId: string) {
    const user = await unit.get('users', userId);
    if (!user || user.status !== 'active') return fail('UNAUTHENTICATED', '请重新登录');
    if (!expectedFamilyId || user.activeFamilyId !== expectedFamilyId) return fail('NO_FAMILY', '家庭权限已变化，请刷新');
    const family = await unit.get('families', expectedFamilyId), membership = await unit.get('family_memberships', hash(`${expectedFamilyId}/${userId}`));
    if (!family || family.status !== 'active' || !membership || membership.familyId !== expectedFamilyId || membership.userId !== userId || membership.status !== 'active') return fail('NO_FAMILY', '家庭权限已变化，请刷新');
    // Membership writes conflict with concurrent removal. The user write also
    // fences a concurrent active-family change before sensitive data is returned.
    await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
    await unit.put('users', { ...user, updatedAt: user.updatedAt });
    return expectedFamilyId;
  }
  function authorize(row: CycleProfileRecord, userId: string, familyId: string) {
    if (row.familyId !== familyId) return fail('NOT_FOUND', '经期档案不存在');
    if (!row.accessUserIds.includes(userId)) return fail('FORBIDDEN', '此经期档案未向你开放');
  }
  async function load(unit: Unit, userId: string, expectedFamilyId: string): Promise<CycleProfileRecord> {
    if (unit === repo) return repo.transaction(transaction => load(transaction, userId, expectedFamilyId));
    const familyId = await auth(unit, userId, expectedFamilyId), row = await unit.get('cycle_profiles', profileId(familyId));
    if (!row) return fail('NOT_FOUND', '请先创建经期档案');
    authorize(row, userId, familyId);
    // AI callers need sharing revocation and profile edits to conflict with the
    // same transaction which claims an analysis request.
    await unit.put('cycle_profiles', { ...row });
    return row;
  }
  async function access(unit: Unit, value: unknown, userId: string, familyId: string): Promise<string[]> {
    if (!Array.isArray(value) || !value.length || value.length > 2 || new Set(value).size !== value.length || !value.includes(userId)) return fail('INVALID_INPUT', '可见账号须包含本人，且最多选择两个有效家庭账号');
    const ids = value.map(id => text(id));
    for (const id of ids) {
      const user = await unit.get('users', id), membership = await unit.get('family_memberships', hash(`${familyId}/${id}`));
      if (!user || user.status !== 'active' || user.activeFamilyId !== familyId || !membership || membership.familyId !== familyId || membership.userId !== id || membership.status !== 'active') return fail('INVALID_INPUT', '请选择当前家庭的有效账号');
      await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
      await unit.put('users', { ...user, updatedAt: user.updatedAt });
    }
    return ids;
  }
  function home(row: CycleProfileRecord | null, timestamp: number): CycleHome {
    let profile: CycleProfile | null = null;
    if (row) {
      const { _id, familyId: _family, setupRequestId: _setup, setupFingerprint: _fingerprint, lastMutation: _mutation, ...visible } = row;
      // Expired payload is no longer available to clients even before cleanup.
      profile = { ...visible, id: _id, periods: row.periods.filter(item => item.deletedAt === null || timestamp - item.deletedAt < RETENTION),
        daily: row.daily.filter(item => item.deletedAt === null || timestamp - item.deletedAt < RETENTION) };
    }
    const today = cycleToday(timestamp);
    return { profile, today, statistics: cycleStatistics(profile), ...cyclePrediction(profile, today), aiAvailable: options.aiAvailable ?? false };
  }
  function retain(row: CycleProfileRecord, timestamp: number) {
    row.periods = row.periods.filter(item => item.deletedAt === null || timestamp - item.deletedAt < RETENTION);
    row.daily = row.daily.filter(item => item.deletedAt === null || timestamp - item.deletedAt < RETENTION);
  }
  function deletion<T extends CyclePeriod | CycleDaily>(item: T | undefined, restoring: boolean, userId: string, timestamp: number) {
    if (!item) return fail('NOT_FOUND', '记录不存在或已超过保留期限');
    if (restoring && item.deletedAt !== null && timestamp - item.deletedAt >= RETENTION) return fail('RESTORE_EXPIRED', '记录已超过30天，无法恢复');
    if (restoring ? item.deletedAt === null : item.deletedAt !== null) return fail('INVALID_INPUT', restoring ? '记录尚未删除' : '记录已删除');
    item.deletedAt = restoring ? null : timestamp; item.updatedAt = timestamp; item.updatedBy = userId;
  }
  async function handle(input: Input, userId: string, expectedFamilyId: string): Promise<CycleHome> {
    const action = text(input.action), actionFields: Record<string, string[]> = {
      'cycle.home': [], 'cycle.setup': ['requestId', 'memberId', 'accessUserIds', 'settings', 'period'],
      'cycle.settings.update': ['requestId', 'version', 'settings', 'accessUserIds'],
      'cycle.period.save': ['requestId', 'version', 'period'], 'cycle.daily.save': ['requestId', 'version', 'daily'],
      'cycle.period.delete': ['requestId', 'version', 'periodId'], 'cycle.period.restore': ['requestId', 'version', 'periodId'],
      'cycle.daily.delete': ['requestId', 'version', 'date'], 'cycle.daily.restore': ['requestId', 'version', 'date'] };
    if (!actionFields[action]) return fail('INVALID_INPUT', '不支持的经期操作');
    fields(input, ['action', ...actionFields[action]]);
    return repo.transaction(async unit => {
      const timestamp = now(), today = cycleToday(timestamp), familyId = await auth(unit, userId, expectedFamilyId);
      let row = await unit.get('cycle_profiles', profileId(familyId));
      if (row) { authorize(row, userId, familyId); await unit.put('cycle_profiles', { ...row }); }
      if (action === 'cycle.home') return home(row, timestamp);
      const id = requestId(input.requestId), fp = fingerprint(input, userId);
      const receiptId = hash(canonical(['cycle-mutation', familyId, userId, id]));
      const receipt = await unit.get('cycle_mutations', receiptId);
      const saveReceipt = () => unit.put('cycle_mutations', { _id: receiptId, familyId, createdBy: userId,
        createdAt: timestamp, updatedAt: timestamp, fingerprint: fp });
      // Durable receipts are scoped to a family and account. A retry returns the
      // current authorized profile even after other writes, regardless of its
      // original version. Only hashes are retained; health payload is never copied.
      if (receipt) {
        if (receipt.familyId !== familyId || receipt.createdBy !== userId || receipt.fingerprint !== fp) return fail('REQUEST_CONFLICT', '同一请求编号的内容不一致');
        if (!row) return fail('NOT_FOUND', '经期档案不存在');
        return home(row, timestamp);
      }
      if (action === 'cycle.setup') {
        if (row) {
          if (row.createdBy === userId && row.setupRequestId === id) {
            if (row.setupFingerprint !== fp) return fail('REQUEST_CONFLICT', '同一请求编号的内容不一致');
            await saveReceipt();
            return home(row, timestamp);
          }
          return fail('CONFLICT', '家庭已存在经期档案，请刷新');
        }
        const memberId = text(input.memberId), member = await unit.get('family_members', memberId);
        if (!member || member.familyId !== familyId || member.status !== 'active') return fail('INVALID_INPUT', '请选择当前家庭的有效成员');
        await unit.put('family_members', { ...member, updatedAt: member.updatedAt });
        const accessUserIds = await access(unit, input.accessUserIds, userId, familyId);
        const initial = input.period === undefined ? null : periodDates(input.period, today, false);
        row = { _id: profileId(familyId), familyId, memberId, accessUserIds, version: 1, settings: settings(input.settings),
          periods: initial ? [{ ...initial, id: hash(`${familyId}/${id}/period`), updatedBy: userId, updatedAt: timestamp, deletedAt: null }] : [], daily: [],
          createdBy: userId, updatedBy: userId, createdAt: timestamp, updatedAt: timestamp, setupRequestId: id, setupFingerprint: fp };
      } else {
        if (!row) return fail('NOT_FOUND', '请先创建经期档案');
        if (!Number.isSafeInteger(input.version) || input.version !== row.version) return fail('CONFLICT', '内容已被家人修改，请刷新后重试');
        if (action === 'cycle.settings.update') {
          row.settings = settings(input.settings); row.accessUserIds = await access(unit, input.accessUserIds, userId, familyId);
        } else if (action === 'cycle.period.save') {
          const value = periodDates(input.period, today, true), existing = value.id ? row.periods.find(item => item.id === value.id) : undefined;
          if (value.id && (!existing || existing.deletedAt !== null)) return fail('NOT_FOUND', '经期记录不存在或已删除');
          const item = { ...value, id: existing?.id ?? hash(`${familyId}/${id}/period/${row.version}`), updatedBy: userId, updatedAt: timestamp, deletedAt: null };
          row.periods = [...row.periods.filter(entry => entry.id !== item.id), item]; validatePeriods(row.periods);
        } else if (action === 'cycle.daily.save') {
          const value = dailyInput(input.daily, today), existing = row.daily.find(item => item.date === value.date);
          if (existing && existing.deletedAt !== null && timestamp - existing.deletedAt < RETENTION) return fail('INVALID_INPUT', '该日记录已删除，请先恢复或等待保留期结束');
          row.daily = [...row.daily.filter(entry => entry.date !== value.date), { ...value, updatedBy: userId, updatedAt: timestamp, deletedAt: null }];
        } else if (action.startsWith('cycle.period.')) {
          deletion(row.periods.find(item => item.id === text(input.periodId)), action.endsWith('.restore'), userId, timestamp); validatePeriods(row.periods);
        } else {
          const day = date(input.date, today); deletion(row.daily.find(item => item.date === day), action.endsWith('.restore'), userId, timestamp);
        }
        retain(row, timestamp);
        if (row.periods.length > 120 || row.daily.length > 1500) return fail('CAPACITY_EXCEEDED', '记录数量已达上限，请整理后重试');
        row.version++; row.updatedAt = timestamp; row.updatedBy = userId; delete row.lastMutation;
      }
      await unit.put('cycle_profiles', row);
      await saveReceipt();
      return home(row, timestamp);
    });
  }
  return { handle, load };
}
