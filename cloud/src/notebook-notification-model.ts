/** Server-only notification records. Never return device records or keys to clients. */
export type NotebookReminderChannel = 'wechat' | 'android' | 'both' | 'none';
export interface NotebookPushDevice {
  _id: string; cid: string; installationKeyHash: string; userId: string; familyId: string;
  status: 'active' | 'unregistered'; notificationsEnabled: boolean;
  authSessionId: string; expiresAt: number;
  bindingGeneration: number; version: number; createdAt: number; updatedAt: number;
}
export interface NotebookReminderPreference {
  _id: string; familyId: string; userId: string; channel: NotebookReminderChannel;
  wechatEnabled?: boolean; androidEnabled?: boolean;
  version: number; createdAt: number; updatedAt: number;
}
export interface NotebookAndroidDelivery {
  _id: string; familyId: string; entryId: string; entryVersion: number; userId: string;
  deviceId: string; bindingGeneration: number; scheduleFingerprint: string;
  status: 'claimed' | 'sending' | 'accepted' | 'rejected' | 'unknown' | 'cancelled';
  claimToken: string; leaseUntil: number; errorCode: string; createdAt: number; updatedAt: number;
}
export interface NotebookReminderStatus {
  channel: NotebookReminderChannel; androidAvailable: boolean; registeredDevices: number;
  wechatEnabled: boolean; androidEnabled: boolean;
  notificationPermission?: boolean;
  androidOfflineAvailable?: boolean;
}

/** Read legacy choices without automatically opting users into a different channel. */
export function notebookReminderSettings(preference?: Partial<NotebookReminderPreference> | null): {
  channel: NotebookReminderChannel; wechatEnabled: boolean; androidEnabled: boolean;
} {
  const legacy = preference?.channel || 'wechat';
  const wechatEnabled = typeof preference?.wechatEnabled === 'boolean' ? preference.wechatEnabled : legacy === 'wechat' || legacy === 'both';
  const androidEnabled = typeof preference?.androidEnabled === 'boolean' ? preference.androidEnabled : legacy === 'android' || legacy === 'both';
  return { wechatEnabled, androidEnabled, channel: wechatEnabled ? androidEnabled ? 'both' : 'wechat' : androidEnabled ? 'android' : 'none' };
}
export interface NotebookAndroidMessage {
  cid: string; entryId: string; requestId: string; title: string;
  date: string; startTime: string; place: string; expiresAt: number;
}
export type NotebookAndroidSender = (message: NotebookAndroidMessage) => Promise<{ code?: number }>;
/** Only the provider adapter may report a failure that precedes push submission. */
export class NotebookAndroidNotSubmittedError extends Error {
  constructor() { super('ANDROID_PUSH_AUTH_FAILED'); this.name = 'NotebookAndroidNotSubmittedError'; }
}
export interface NotebookReminderSession { id: string; expiresAt: number }
