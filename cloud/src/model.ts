export interface Base { _id: string; createdAt: number; updatedAt: number }
export interface User extends Base {
  _openid: string; activeFamilyId: string; status: 'active' | 'blocked'; lastLoginAt: number;
  username?: string;
  inviteWindow?: number; inviteAttempts?: number;
  aiDay?: string; aiCalls?: number;
  cutoutDay?: string; cutoutCalls?: number;
  photoCutouts?: PhotoCutoutTask[];
}
// Server-only credentials/session records. Never expose these collections to clients.
export interface AuthAccount extends Base {
  username: string; userId: string; algorithm: 'scrypt-v1'; salt: string; passwordHash: string;
  status: 'active' | 'disabled';
}
export interface AuthSession extends Base {
  tokenHash: string; userId: string; accountId: string; expiresAt: number; revokedAt: number | null;
}
export interface AuthThrottle extends Base { windowStart: number; attempts: number; expiresAt: number }
export interface Family extends Base { name: string; ownerUserId: string; status: 'active' }
export interface Membership extends Base {
  familyId: string; userId: string; role: 'owner' | 'member'; status: 'active' | 'left' | 'removed';
  joinedAt: number; leftAt: number | null; version: number;
}
export interface Member extends Base {
  familyId: string; name: string; linkedUserId: string | null; sortOrder: number; status: 'active';
  createdBy: string; updatedBy: string; version: number;
}
export type Category = 'onepiece' | 'top' | 'bottom' | 'hat';
export type WearStatus = 'wearable' | 'laundry' | 'storage' | 'retired';
export interface Garment extends Base {
  familyId: string; memberId: string; name: string; category: Category; wearStatus: WearStatus;
  color: string; season: string; material: string; location: string; locationId?: string; notes: string;
  imageFileId: string; cloudPath: string; createdBy: string; updatedBy: string;
  deletedBy: string | null; status: 'uploading' | 'active' | 'deleted' | 'purging' | 'expired' | 'discarded'; version: number;
  deletedAt: number | null; uploadExpiresAt: number; uploadAttempt: string;
  aiFence?: number;
  uploadFingerprint?: string;
  cleanupGeneration?: number;
  cutouts?: Partial<Record<'goods' | 'common', CutoutTask>>;
  retainedImagePaths?: string[];
  appliedCutout?: { requestId: string; mode: 'goods' | 'common'; imageFileId: string };
}
export interface CutoutTask {
  sourceId: string; requestId: string; attempt: string; key: string;
  status: 'running' | 'succeeded' | 'failed' | 'unknown'; errorCode: string; error: string;
  startedAt: number; expiresAt: number;
}
export interface PhotoCutoutTask extends CutoutTask { familyId: string; sourceKey: string; fingerprint: string }
export interface Location extends Base {
  familyId: string; name: string; parentId: string; status: 'active' | 'deleted'; version: number;
  createdBy: string; updatedBy: string; childCount: number; structureFence: number;
}
export interface GarmentSnapshot {
  id: string; memberId: string; name: string; category: Category; status: WearStatus;
  color: string; season: string; material: string; location: string; locationId: string; notes: string; version: number;
}
export interface Outfit extends Base {
  familyId: string; memberId: string; name: string; occasion: string; reason: string; partial: boolean;
  garments: GarmentSnapshot[]; status: 'active' | 'deleted'; version: number;
  createdBy: string; updatedBy: string; requestFingerprint: string;
}
export interface Invite extends Base {
  familyId: string; tokenHash: string; createdBy: string; expiresAt: number;
  status: 'active' | 'used' | 'revoked'; usedBy: string | null; usedAt: number | null;
}
export interface AiTask extends Base {
  familyId: string; memberId: string; createdBy: string;
  type: 'recognize' | 'recommend'; fingerprint: string;
  status: 'running' | 'succeeded' | 'failed' | 'unknown';
  inputVersions: Array<{ id: string; version: number }>;
  result: unknown; errorCode: string; providerRequestId: string;
  billingState: 'not_submitted' | 'rejected' | 'reported' | 'unknown';
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null;
}
export interface Entities {
  users: User; families: Family; family_memberships: Membership;
  family_members: Member; garments: Garment; family_invites: Invite; ai_tasks: AiTask;
  locations: Location; outfits: Outfit;
  auth_accounts: AuthAccount; auth_sessions: AuthSession; auth_throttles: AuthThrottle;
}
export type Collection = keyof Entities;
export interface ListOptions {
  before?: { createdAt: number; id: string }; limit?: number; expiresBefore?: number;
  search?: string; excludeRetired?: boolean; deletedBefore?: number;
}
export interface Unit {
  get<K extends Collection>(collection: K, id: string): Promise<Entities[K] | null>;
  put<K extends Collection>(collection: K, document: Entities[K]): Promise<void>;
}
export interface Repository extends Unit {
  transaction<T>(work: (unit: Unit) => Promise<T>): Promise<T>;
  list<K extends Collection>(collection: K, filter: Partial<Entities[K]>, options?: ListOptions): Promise<Entities[K][]>;
}
export interface ImageStorage {
  download?(fileId: string): Promise<Buffer>;
  upload(path: string, base64: string): Promise<string>;
  uploadPng(path: string, bytes: Buffer): Promise<string>;
  remove(fileId: string): Promise<void>;
  urls(fileIds: string[]): Promise<Record<string, string>>;
}
export interface Identity { openid: string; appid: string; source: string }
export type Input = Record<string, unknown>;
