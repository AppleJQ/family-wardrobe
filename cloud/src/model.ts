export interface Base { _id: string; createdAt: number; updatedAt: number }
export interface User extends Base {
  _openid: string; activeFamilyId: string; status: 'active' | 'blocked'; lastLoginAt: number;
  inviteWindow?: number; inviteAttempts?: number;
}
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
  color: string; season: string; material: string; location: string; notes: string;
  imageFileId: string; cloudPath: string; createdBy: string; updatedBy: string;
  deletedBy: string | null; status: 'uploading' | 'active' | 'deleted' | 'expired' | 'discarded'; version: number;
  deletedAt: number | null; uploadExpiresAt: number; uploadAttempt: string;
}
export interface Invite extends Base {
  familyId: string; tokenHash: string; createdBy: string; expiresAt: number;
  status: 'active' | 'used' | 'revoked'; usedBy: string | null; usedAt: number | null;
}
export interface Entities {
  users: User; families: Family; family_memberships: Membership;
  family_members: Member; garments: Garment; family_invites: Invite;
}
export type Collection = keyof Entities;
export interface ListOptions { before?: { createdAt: number; id: string }; limit?: number; expiresBefore?: number }
export interface Unit {
  get<K extends Collection>(collection: K, id: string): Promise<Entities[K] | null>;
  put<K extends Collection>(collection: K, document: Entities[K]): Promise<void>;
}
export interface Repository extends Unit {
  transaction<T>(work: (unit: Unit) => Promise<T>): Promise<T>;
  list<K extends Collection>(collection: K, filter: Partial<Entities[K]>, options?: ListOptions): Promise<Entities[K][]>;
}
export interface ImageStorage {
  upload(path: string, base64: string): Promise<string>;
  remove(fileId: string): Promise<void>;
  urls(fileIds: string[]): Promise<Record<string, string>>;
}
export interface Identity { openid: string; appid: string; source: string }
export type Input = Record<string, unknown>;
