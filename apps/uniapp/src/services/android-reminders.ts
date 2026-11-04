import { reactive } from 'vue';
import { call } from './cloud';
import { getSession, onSessionChanged } from './session';
import type { NotebookEntry } from './notebook';
// #ifdef APP-PLUS
import { createInstallationKey, ensureNotificationChannel, notificationsEnabled, requestNotificationPermission } from '../uni_modules/family-notifications';
// #endif

type ReminderChannel = 'android' | 'wechat' | 'both' | 'none';
interface ReminderScope { userId: string; familyId: string }
interface ReminderStatus { channel: ReminderChannel; wechatEnabled?: boolean; androidEnabled?: boolean; androidAvailable: boolean; registeredDevices: number; androidOfflineAvailable?: boolean }
interface RegisteredDevice extends ReminderScope { cid: string; installationKey: string }
const installationStorageKey = 'family-home-push-installation-v1';
const deviceStorageKey = 'family-home-push-device-v1';
const preferenceKey = (userId: string) => `family-home-android-reminders-v1:${userId}`;
const entryIdPattern = /^[a-zA-Z0-9_-]{1,120}$/;
let generation = 0, initialized = false, refreshing = false;
export const androidReminderState = reactive({ userId: '', familyId: '', channel: 'none' as ReminderChannel,
  wechatEnabled: false, androidEnabled: false, notificationsEnabled: false, androidAvailable: false, registeredDevices: 0, message: '' });

function reminderChannels(status: ReminderStatus) {
  const androidEnabled = status.androidEnabled ?? (status.channel === 'android' || status.channel === 'both');
  const wechatEnabled = status.wechatEnabled ?? (status.channel === 'wechat' || status.channel === 'both');
  const channel: ReminderChannel = androidEnabled ? wechatEnabled ? 'both' : 'android' : wechatEnabled ? 'wechat' : 'none';
  return { androidEnabled, wechatEnabled, channel };
}

export function supportsAndroidReminders(): boolean {
  // #ifdef APP-PLUS
  return typeof plus !== 'undefined' && plus.os.name === 'Android' && typeof plus.push?.getClientInfoAsync === 'function';
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}
export function canEnableNotebookReminder(entry: NotebookEntry, userId: string): boolean {
  return entry.kind === 'event' && entry.status === 'active' && entry.eventState === 'planned'
    && !!entry.startTime && entry.reminderMinutes !== null && entry.participantUserIds.includes(userId);
}
/** A notification can select an entry, never supply a route or rendered content. */
export function parseAndroidReminderClick(message: unknown): string | null {
  try {
    const outer = typeof message === 'string' ? JSON.parse(message) as unknown : message;
    if (!outer || typeof outer !== 'object' || !('payload' in outer)) return null;
    const value = outer.payload;
    const payload = typeof value === 'string' ? JSON.parse(value) as unknown : value;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const record = payload as Record<string, unknown>;
    if ('url' in record || 'route' in record || 'path' in record) return null;
    return record.type === 'notebook-reminder' && typeof record.entryId === 'string' && entryIdPattern.test(record.entryId) ? record.entryId : null;
  } catch { return null; }
}
function capture(scope: ReminderScope) {
  const session = getSession(), revision = generation;
  if (!session || session.userId !== scope.userId || !scope.familyId) throw new Error('账号或家庭已变化，请重新打开家庭记事');
  return () => {
    const current = getSession();
    if (generation !== revision || current?.userId !== scope.userId || current.token !== session.token) throw new Error('账号已变化，请重新打开家庭记事');
  };
}
async function scoped<T>(scope: ReminderScope, active: () => void, action: string, data: Record<string, unknown> = {}): Promise<T> {
  active();
  const result = await call<T>('notebook', action, { expectedFamilyId: scope.familyId, ...data });
  active(); return result;
}
function secureInstallationKey(): string {
  const stored = uni.getStorageSync(installationStorageKey);
  if (typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored)) return stored;
  // #ifdef APP-PLUS
  const key = createInstallationKey();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('无法安全注册此设备，请重启应用后重试');
  uni.setStorageSync(installationStorageKey, key); return key;
  // #endif
  // #ifndef APP-PLUS
  throw new Error('当前平台不支持 Android 提醒');
  // #endif
}
async function clientId(): Promise<string> {
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('通知连接较慢，请稍后重试')), 12000);
    plus.push.getClientInfoAsync(info => {
      clearTimeout(timer);
      if (typeof info.clientid === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(info.clientid)) resolve(info.clientid);
      else reject(new Error('此安装包尚未接入通知服务，请更新应用后重试'));
    }, () => { clearTimeout(timer); reject(new Error('暂时无法连接通知服务，请稍后重试')); });
  });
  // #endif
  // #ifndef APP-PLUS
  throw new Error('当前平台不支持 Android 提醒');
  // #endif
}
function readPermission(): boolean {
  // #ifdef APP-PLUS
  ensureNotificationChannel(); return notificationsEnabled();
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}
async function requestPermission(): Promise<boolean> {
  // #ifdef APP-PLUS
  ensureNotificationChannel();
  return new Promise((resolve, reject) => requestNotificationPermission({ success: resolve, fail: () => reject(new Error('暂时无法申请通知权限，请返回应用后重试')) }));
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}
function publish(scope: ReminderScope, status: ReminderStatus, permitted: boolean) {
  const channels = reminderChannels(status);
  const message = !channels.androidEnabled ? channels.wechatEnabled ? 'Android 提醒已关闭，微信提醒可继续独立订阅。' : '尚未开启 Android 提醒；微信与 Android 可同时开启。'
    : !permitted ? 'Android 系统通知权限已关闭；允许通知后返回应用即可重新检查。'
    : status.androidOfflineAvailable ? '已开启 Android 提醒，实际送达仍受手机通知设置影响。' : '已开启 Android 提醒。厂商离线通道尚未开通，应用关闭或锁屏后可能无法收到。';
  Object.assign(androidReminderState, scope, status, channels, { notificationsEnabled: permitted, message });
}
async function register(scope: ReminderScope, active: () => void, permitted: boolean) {
  const cid = await clientId(); active();
  const device: RegisteredDevice = { ...scope, cid, installationKey: secureInstallationKey() };
  await scoped(scope, active, 'reminders.device.register', { cid, installationKey: device.installationKey, notificationsEnabled: permitted });
  uni.setStorageSync(deviceStorageKey, device);
}
export async function enableAndroidReminders(scope: ReminderScope): Promise<void> {
  if (!supportsAndroidReminders()) throw new Error('此安装包尚未接入 Android 通知，请更新应用后重试');
  const active = capture(scope);
  const status = await scoped<ReminderStatus>(scope, active, 'reminders.status');
  if (!status.androidAvailable) throw new Error('Android 提醒服务尚未开通，日程已保存');
  const permitted = await requestPermission(); active();
  if (!permitted) { publish(scope, status, false); throw new Error('未开启系统通知权限；可在手机设置中允许通知，再返回重试'); }
  await register(scope, active, true);
  const next = await scoped<ReminderStatus>(scope, active, 'reminders.preference', { channel: 'android', enabled: true });
  uni.setStorageSync(preferenceKey(scope.userId), scope.familyId);
  publish(scope, { ...status, ...next, androidEnabled: true }, true);
}
export async function disableAndroidReminders(scope: ReminderScope): Promise<void> {
  const active = capture(scope);
  const status = await scoped<ReminderStatus>(scope, active, 'reminders.preference', { channel: 'android', enabled: false });
  uni.removeStorageSync(preferenceKey(scope.userId));
  publish(scope, { ...status, androidEnabled: false }, readPermission());
  await unregisterAndroidReminders();
}
/** Only a prior explicit opt-in on this account and installation may refresh CID. */
export async function refreshAndroidReminders(): Promise<void> {
  const session = getSession();
  if (!supportsAndroidReminders() || !session || refreshing) return;
  const familyId = uni.getStorageSync(preferenceKey(session.userId));
  if (typeof familyId !== 'string' || !familyId) return;
  const scope: ReminderScope = { userId: session.userId, familyId }, active = capture(scope);
  refreshing = true;
  try {
    const home = await scoped<{userId: string; familyId: string}>(scope, active, 'home');
    if (home.userId !== scope.userId || home.familyId !== scope.familyId) {
      await unregisterAndroidReminders(); uni.removeStorageSync(preferenceKey(scope.userId)); return;
    }
    const status = await scoped<ReminderStatus>(scope, active, 'reminders.status');
    const permitted = readPermission();
    publish(scope, status, permitted);
    if (reminderChannels(status).androidEnabled && status.androidAvailable) await register(scope, active, permitted);
    else uni.removeStorageSync(preferenceKey(scope.userId));
  } finally { refreshing = false; }
}
/** Call while the old session is still current; auth.logout also revokes server registrations. */
export async function unregisterAndroidReminders(): Promise<void> {
  generation += 1;
  const device = uni.getStorageSync(deviceStorageKey) as RegisteredDevice | undefined;
  const session = getSession();
  // #ifdef APP-PLUS
  if (supportsAndroidReminders()) plus.push.clear();
  // #endif
  if (!device || !session || device.userId !== session.userId) return;
  const active = capture(device);
  await scoped(device, active, 'reminders.device.unregister', { cid: device.cid, installationKey: device.installationKey });
  uni.removeStorageSync(deviceStorageKey);
}
/** Account replacement must remain usable when the network is unavailable. */
export async function prepareAndroidAccountChange(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([unregisterAndroidReminders().catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 2500); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
export function startAndroidReminders(): void {
  if (initialized || !supportsAndroidReminders()) return;
  initialized = true;
  onSessionChanged(() => {
    generation += 1;
    Object.assign(androidReminderState, { userId: '', familyId: '', channel: 'none', androidEnabled: false, wechatEnabled: false, notificationsEnabled: false, androidAvailable: false, registeredDevices: 0, message: '' });
    // Notifications contain no entry text, and logout must also remove already delivered notices.
    plus.push.clear();
    void refreshAndroidReminders().catch(() => {});
  });
  // The provider renders notifications. A receive listener must not create a second notification.
  plus.push.addEventListener('click', message => {
    const entryId = parseAndroidReminderClick(message);
    if (!entryId) return;
    const target = `/pages/notebook/index?entryId=${encodeURIComponent(entryId)}`;
    uni.reLaunch({ url: getSession() ? target : `/pages/login/index?returnTo=${encodeURIComponent(target)}` });
  });
}
