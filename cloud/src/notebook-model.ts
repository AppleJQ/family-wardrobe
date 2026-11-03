/** Shared wire contract. This module has no platform or Node.js dependencies. */
export type NotebookKind = 'event' | 'list' | 'note';
export type NotebookStatus = 'active' | 'deleted' | 'purged';
export interface NotebookItem { id: string; text: string; done: boolean; completedBy: string; completedAt: number | null }
export interface NotebookImage { id: string; url: string }
export interface NotebookEntry {
  category?: string;
  id: string; kind: NotebookKind; title: string; status: NotebookStatus; version: number;
  createdAt: number; updatedAt: number; createdBy: string; updatedBy: string; deletedAt: number | null;
  noteMemberId: string; body: string; date: string; startTime: string; endTime: string;
  participantMemberIds?: string[]; participantUserIds: string[]; place: string; listId: string; noteId: string;
  reminderMinutes: number | null; eventState: 'planned' | 'completed' | 'cancelled';
  pinned: boolean; items: NotebookItem[]; images: NotebookImage[];
}
export interface NotebookMember { id: string; name: string; linkedUserId: string | null; version: number }
export interface NotebookAccount { userId: string; name: string; memberId: string; isSelf: boolean }
export interface NotebookHome {
  userId: string; familyId: string; familyName: string; members: NotebookMember[];
  accounts: NotebookAccount[]; entries: NotebookEntry[]; cursor: string;
  capabilities: { ai: boolean; wechatReminder: boolean; wechatTemplateId: string };
}
export interface NotebookDraft {
  kind: 'event'; title: string; date: string; startTime: string; endTime: string;
  participantMemberIds?: string[]; participantUserIds: string[]; place: string; body: string; reminderMinutes: number | null;
}
export type NotebookAiStatus = 'succeeded' | 'needs_clarification' | 'running' | 'failed' | 'unknown';
export interface NotebookAiResult {
  requestId: string; status: NotebookAiStatus; drafts: NotebookDraft[]; questions: string[];
  answer: string; entryIds: string[]; error?: string;
}
export interface NotebookWrite {
  category?: string;
  kind?: NotebookKind; title?: string; body?: string; noteMemberId?: string;
  date?: string; startTime?: string; endTime?: string; participantMemberIds?: string[]; participantUserIds?: string[];
  place?: string; listId?: string; noteId?: string; reminderMinutes?: number | null;
  eventState?: NotebookEntry['eventState']; pinned?: boolean; items?: NotebookItem[]; imageIds?: string[];
}

/** Server-only persistence shapes; never return these records directly. */
export interface NotebookRecord extends Omit<NotebookEntry, 'id' | 'images'> {
  _id: string; familyId: string; imageIds: string[]; requestFingerprint: string;
  referenceFence: number; cleanupAssetIds: string[];
}
export interface NotebookAsset {
  _id: string; familyId: string; createdBy: string; createdAt: number; updatedAt: number;
  status: 'uploading' | 'active' | 'failed' | 'deleted'; fileId: string; cloudPath: string;
  fingerprint: string; refCount: number;
  cleanupRequestedAt?: number; cleanupFileIds?: string[];
}
export interface NotebookAiRequest {
  _id: string; familyId: string; createdBy: string; createdAt: number; updatedAt: number;
  requestId: string; fingerprint: string; action: 'ai.parse' | 'ai.query';
  status: NotebookAiStatus; result: NotebookAiResult | null; fence: string;
  error: string; providerRequestId: string;
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null;
}
export interface NotebookReminderSubscription {
  _id: string; familyId: string; entryId: string; entryVersion: number; userId: string;
  templateId: string; createdAt: number; updatedAt: number; scheduleFingerprint?: string;
}
export interface NotebookReminderDelivery {
  _id: string; familyId: string; entryId: string; entryVersion: number; userId: string;
  channel: 'wechat'; status: 'claimed' | 'sending' | 'accepted' | 'rejected' | 'unknown' | 'cancelled';
  claimToken: string; leaseUntil: number; createdAt: number; updatedAt: number; errorCode: string;
}
export interface NotebookReminderScan {
  _id: string; date: string; before: { createdAt: number; id: string } | null;
  createdAt: number; updatedAt: number;
}
export interface NotebookCleanupScan {
  _id: string; createdAt: number; updatedAt: number; leaseToken: string; leaseUntil: number;
  cursors: Record<'entries' | 'assets' | 'events', { createdAt: number; id: string } | null>;
}
