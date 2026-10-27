import { createHash, randomBytes } from 'node:crypto';
import { Category, Garment, Identity, ImageStorage, Input, Invite, Member, Membership, Repository, Unit, User, WearStatus } from './model';
import { checkLocation, createWardrobeService } from './wardrobe-service';

export class BusinessError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = () => randomBytes(16).toString('hex');
const membershipId = (familyId: string, userId: string) => hash(`${familyId}/${userId}`);
const text = (value: unknown, max = 60, required = true): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return fail('INVALID_INPUT', '请填写有效信息');
  return value.trim();
};
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) return fail('INVALID_INPUT', '选项无效');
  return value as T;
}
const categoryValues: readonly Category[] = ['onepiece', 'top', 'bottom', 'hat'];
const versionCheck = (actual: number, expected: unknown) => {
  if (actual !== expected) fail('CONFLICT', '衣物或档案已被家人更新，请刷新后重试');
};
function fields(input: Input, partial = false) {
  const patch: Partial<Garment> = {};
  if (!partial || input.name !== undefined) patch.name = text(input.name);
  if (!partial || input.category !== undefined) patch.category = choice<Category>(input.category, categoryValues);
  if (input.memberId !== undefined) patch.memberId = text(input.memberId, 80);
  if (input.locationId !== undefined) patch.locationId = text(input.locationId, 80, false);
  if (input.status !== undefined) patch.wearStatus = choice<WearStatus>(input.status, ['wearable', 'laundry', 'storage', 'retired']);
  for (const key of ['color', 'season', 'material', 'location', 'notes'] as const) {
    if (input[key] !== undefined) patch[key] = text(input[key], key === 'notes' ? 500 : 100, false);
  }
  return patch;
}
const memberView = (member: Member) => ({ id: member._id, name: member.name, version: member.version });
function garmentView(g: Garment, image = '') {
  return {
    id: g._id, memberId: g.memberId, name: g.name, category: g.category, status: g.wearStatus,
    color: g.color, season: g.season, material: g.material, location: g.location, locationId: g.locationId || '', notes: g.notes,
    image, version: g.version, createdAt: new Date(g.createdAt).toISOString().slice(0, 10),
  };
}

export function createService(repo: Repository, storage: ImageStorage, now = Date.now) {
  const wardrobe = createWardrobeService(repo, storage, now);
  async function current(unit: Unit, userId: string) {
    const user = await unit.get('users', userId);
    if (!user || user.status !== 'active') return fail('UNAUTHENTICATED', '请重新进入小程序');
    return user;
  }
  async function familyAuth(unit: Unit, userId: string, owner = false) {
    const user = await current(unit, userId);
    if (!user.activeFamilyId) return fail('NO_FAMILY', '请先创建或加入家庭');
    const [family, membership] = await Promise.all([
      unit.get('families', user.activeFamilyId),
      unit.get('family_memberships', membershipId(user.activeFamilyId, userId)),
    ]);
    if (!family || family.status !== 'active' || !membership || membership.status !== 'active') return fail('NO_FAMILY', '家庭权限已变化，请重新进入');
    if (owner && (membership.role !== 'owner' || family.ownerUserId !== userId)) return fail('FORBIDDEN', '仅家庭管理员可操作');
    // A write fence makes revocation conflict with in-flight mutations even under snapshot isolation.
    if (unit !== repo) await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
    return { user, family, membership };
  }
  async function validMember(unit: Unit, familyId: string, memberId: string) {
    const member = await unit.get('family_members', memberId);
    if (!member || member.familyId !== familyId || member.status !== 'active') return fail('NOT_FOUND', '成员档案不存在');
    return member;
  }
  async function sameFamily(userId: string, familyId: string) {
    const auth = await familyAuth(repo, userId);
    if (auth.family._id !== familyId) fail('NO_FAMILY', '家庭权限已变化，请重新加载');
  }
  async function validGarment(unit: Unit, userId: string, garmentId: string, uploading = false) {
    const auth = await familyAuth(unit, userId);
    const garment = await unit.get('garments', garmentId);
    if (!garment || garment.familyId !== auth.family._id || (garment.status !== 'active' && !(uploading && garment.status === 'uploading'))) return fail('NOT_FOUND', '衣物不存在或无权访问');
    return { ...auth, garment };
  }
  async function snapshot(userId: string) {
    const auth = await familyAuth(repo, userId);
    const [members, memberships] = await Promise.all([
      repo.list('family_members', { familyId: auth.family._id, status: 'active' }, { limit: 100 }),
      repo.list('family_memberships', { familyId: auth.family._id, status: 'active' }, { limit: 100 }),
    ]);
    await sameFamily(userId, auth.family._id);
    return {
      family: { id: auth.family._id, name: auth.family.name, role: auth.membership.role },
      members: members.sort((a, b) => a.sortOrder - b.sortOrder).map(memberView),
      accounts: memberships.map(m => ({ userId: m.userId, role: m.role, isSelf: m.userId === userId, label: m.role === 'owner' ? '家庭管理员' : `家人 ${m.userId.slice(-4)}` })),
    };
  }
  async function throttleInvites(userId: string) {
    // Persist attempts separately: invalid invitation attempts must not roll this back.
    await repo.transaction(async unit => {
      const user = await current(unit, userId);
      const sameWindow = user.inviteWindow !== undefined && now() - user.inviteWindow < 60000;
      const attempts = sameWindow ? user.inviteAttempts || 0 : 0;
      if (attempts >= 10) fail('RATE_LIMITED', '尝试过于频繁，请一分钟后重试');
      await unit.put('users', { ...user, inviteWindow: sameWindow ? user.inviteWindow : now(), inviteAttempts: attempts + 1 });
    });
  }
  async function readInvite(unit: Unit, token: unknown, userId: string, accept: boolean) {
    const tokenValue = text(token, 64);
    if (!/^[a-f0-9]{64}$/.test(tokenValue)) return fail('INVITE_INVALID', '邀请无效、已使用或已过期');
    const invite = await unit.get('family_invites', hash(tokenValue));
    if (!invite) return fail('INVITE_INVALID', '邀请无效、已使用或已过期');
    const family = await unit.get('families', invite.familyId);
    const creator = await unit.get('family_memberships', membershipId(invite.familyId, invite.createdBy));
    const retry = accept && invite.status === 'used' && invite.usedBy === userId;
    if (!family || family.status !== 'active' || !creator || creator.status !== 'active' || creator.role !== 'owner' || (!retry && (invite.status !== 'active' || invite.expiresAt <= now()))) return fail('INVITE_INVALID', '邀请无效、已使用或已过期');
    if (unit !== repo) await unit.put('family_memberships', { ...creator, version: creator.version + 1, updatedAt: now() });
    return { invite, family, retry };
  }

  return async (group: string, input: Input, identity: Identity): Promise<unknown> => {
    if (!identity.openid || identity.appid !== 'wx80f51573314b7bd2' || !['wx_client', 'wx_devtools'].includes(identity.source)) return fail('UNAUTHENTICATED', '仅支持本小程序的微信登录');
    const userId = hash(`wx/${identity.appid}/${identity.openid}`).slice(0, 40);
    const action = input.action;
    if (group === 'bootstrapUser') {
      let user = await repo.get('users', userId);
      if (user && user.status !== 'active') fail('FORBIDDEN', '账号不可用');
      // Returning accounts still get a fresh status read, without a write on
      // every screen opening. Creation and stale login refresh remain atomic.
      if (!user || !Number.isFinite(user.lastLoginAt) || now() - user.lastLoginAt >= 600000) user = await repo.transaction(async unit => {
        const existing = await unit.get('users', userId);
        if (existing && existing.status !== 'active') fail('FORBIDDEN', '账号不可用');
        if (existing && Number.isFinite(existing.lastLoginAt) && now() - existing.lastLoginAt < 600000) return existing;
        const user: User = existing || { _id: userId, _openid: identity.openid, activeFamilyId: '', status: 'active', createdAt: now(), updatedAt: now(), lastLoginAt: now() };
        const updated = { ...user, updatedAt: now(), lastLoginAt: now() };
        await unit.put('users', updated);
        return updated;
      });
      if (action === 'home') return wardrobe(input, identity, user);
      return { userId, ...(user.activeFamilyId ? await snapshot(userId) : { family: null, members: [], accounts: [] }) };
    }
    if (group === 'wardrobe' && action === 'home') return wardrobe(input, identity);
    await current(repo, userId);
    if (group === 'wardrobe' || (group === 'garments' && action === 'list')) return wardrobe(input, identity);
    if (group === 'families') {
      if (action === 'get') return snapshot(userId);
      if (action === 'create') {
        const name = text(input.name, 30), memberName = text(input.memberName, 20);
        const familyId = id(), memberId = id(), timestamp = now();
        await repo.transaction(async unit => {
          const user = await current(unit, userId);
          if (user.activeFamilyId) fail('HAS_FAMILY', '当前已有家庭，请先处理现有家庭关系');
          await unit.put('families', { _id: familyId, name, ownerUserId: userId, status: 'active', createdAt: timestamp, updatedAt: timestamp });
          await unit.put('family_memberships', { _id: membershipId(familyId, userId), familyId, userId, role: 'owner', status: 'active', joinedAt: timestamp, leftAt: null, version: 1, createdAt: timestamp, updatedAt: timestamp });
          await unit.put('family_members', { _id: memberId, familyId, name: memberName, linkedUserId: userId, sortOrder: timestamp, status: 'active', createdBy: userId, updatedBy: userId, version: 1, createdAt: timestamp, updatedAt: timestamp });
          await unit.put('users', { ...user, activeFamilyId: familyId, updatedAt: timestamp });
        });
        return snapshot(userId);
      }
      if (['rename', 'remove', 'transfer', 'leave'].includes(String(action))) {
        await repo.transaction(async unit => {
          const auth = await familyAuth(unit, userId, action !== 'leave');
          if (action === 'rename') {
            await unit.put('families', { ...auth.family, name: text(input.name, 30), updatedAt: now() }); return;
          }
          const targetId = action === 'leave' ? userId : text(input.userId, 80);
          const target = await unit.get('family_memberships', membershipId(auth.family._id, targetId));
          if (!target || target.status !== 'active') return fail('NOT_FOUND', '家庭账号不存在');
          if (action === 'transfer') {
            if (targetId === userId) return;
            await unit.put('family_memberships', { ...auth.membership, role: 'member', version: auth.membership.version + 1, updatedAt: now() });
            await unit.put('family_memberships', { ...target, role: 'owner', version: target.version + 1, updatedAt: now() });
            await unit.put('families', { ...auth.family, ownerUserId: targetId, updatedAt: now() }); return;
          }
          if (target.role === 'owner') return fail('OWNER_MUST_TRANSFER', '管理员需先移交管理权才能退出');
          const targetUser = await current(unit, targetId);
          await unit.put('family_memberships', { ...target, status: action === 'leave' ? 'left' : 'removed', leftAt: now(), version: target.version + 1, updatedAt: now() });
          await unit.put('users', { ...targetUser, activeFamilyId: '', updatedAt: now() });
        });
        return { success: true };
      }
    }
    if (group === 'familyInvites') {
      if (action === 'create') {
        const token = randomBytes(32).toString('hex'), tokenHash = hash(token);
        const invite = await repo.transaction(async unit => {
          const auth = await familyAuth(unit, userId, true);
          const item: Invite = { _id: tokenHash, familyId: auth.family._id, tokenHash, createdBy: userId, expiresAt: now() + 86400000, status: 'active', usedBy: null, usedAt: null, createdAt: now(), updatedAt: now() };
          await unit.put('family_invites', item); return item;
        });
        return { id: invite._id, token, expiresAt: invite.expiresAt };
      }
      if (action === 'revoke') {
        await repo.transaction(async unit => {
          const auth = await familyAuth(unit, userId, true);
          const invite = await unit.get('family_invites', text(input.inviteId, 80));
          if (!invite || invite.familyId !== auth.family._id) return fail('NOT_FOUND', '邀请不存在');
          if (invite.status === 'active') await unit.put('family_invites', { ...invite, status: 'revoked', updatedAt: now() });
        }); return { success: true };
      }
      if (action === 'preview' || action === 'accept') {
        await throttleInvites(userId);
        if (action === 'preview') {
          const info = await readInvite(repo, input.token, userId, false);
          return { familyName: info.family.name, expiresAt: info.invite.expiresAt };
        }
        if (input.confirmed !== true) return fail('CONFIRM_REQUIRED', '请先确认加入家庭并共享衣物编辑权限');
        await repo.transaction(async unit => {
          const user = await current(unit, userId);
          const { invite, family, retry } = await readInvite(unit, input.token, userId, true);
          if (retry) {
            const membership = await unit.get('family_memberships', membershipId(family._id, userId));
            if (user.activeFamilyId === family._id && membership?.status === 'active') return;
            return fail('INVITE_INVALID', '邀请已使用，请向管理员索取新邀请');
          }
          if (user.activeFamilyId) return fail('HAS_FAMILY', '当前已有家庭，请先处理现有家庭关系');
          const old = await unit.get('family_memberships', membershipId(family._id, userId));
          const membership: Membership = { _id: membershipId(family._id, userId), familyId: family._id, userId, role: 'member', status: 'active', joinedAt: now(), leftAt: null, version: (old?.version || 0) + 1, createdAt: old?.createdAt || now(), updatedAt: now() };
          await unit.put('family_memberships', membership);
          await unit.put('users', { ...user, activeFamilyId: family._id, updatedAt: now() });
          await unit.put('family_invites', { ...invite, status: 'used', usedBy: userId, usedAt: now(), updatedAt: now() });
        }); return snapshot(userId);
      }
    }
    if (group === 'members') {
      if (action === 'list') return (await snapshot(userId)).members;
      if (action === 'create' || action === 'rename') return repo.transaction(async unit => {
        const auth = await familyAuth(unit, userId);
        const name = text(input.name, 20);
        if (action === 'rename') {
          const old = await validMember(unit, auth.family._id, text(input.memberId, 80));
          versionCheck(old.version, input.version);
          const member: Member = { ...old, name, updatedBy: userId, updatedAt: now(), version: old.version + 1 };
          await unit.put('family_members', member); return memberView(member);
        }
        const member: Member = { _id: id(), familyId: auth.family._id, name, linkedUserId: null, sortOrder: now(), status: 'active', createdBy: userId, updatedBy: userId, createdAt: now(), updatedAt: now(), version: 1 };
        await unit.put('family_members', member); return memberView(member);
      });
    }
    if (group === 'garments') {
      if (action === 'beginUpload') return repo.transaction(async unit => {
        const auth = await familyAuth(unit, userId), memberId = text(input.memberId, 80);
        await validMember(unit, auth.family._id, memberId);
        const inputFields = {
          memberId, name: '', category: 'top' as Category, wearStatus: 'wearable' as WearStatus,
          color: '', season: '', material: '', location: '', locationId: '', notes: '', ...fields(input),
        };
        const requestId = input.requestId === undefined ? '' : text(input.requestId, 80);
        if (requestId && !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) return fail('INVALID_INPUT', '请求编号无效');
        const garmentId = requestId ? hash(`upload/${auth.family._id}/${userId}/${requestId}`).slice(0, 40) : id(), timestamp = now();
        const uploadFingerprint = hash(JSON.stringify(inputFields));
        const existing = requestId ? await unit.get('garments', garmentId) : null;
        if (existing) {
          if (existing.uploadFingerprint !== uploadFingerprint) return fail('REQUEST_CONFLICT', '请求编号已用于其他衣物信息');
          if (!['uploading', 'active'].includes(existing.status) || (existing.status === 'uploading' && existing.uploadExpiresAt <= now())) return fail('UPLOAD_INVALID', '原上传已过期或已删除，请重新添加');
          return { id: existing._id };
        }
        if (inputFields.locationId) await checkLocation(unit, auth.family._id, inputFields.locationId);
        const garment: Garment = {
          _id: garmentId, familyId: auth.family._id, ...inputFields, uploadFingerprint,
          imageFileId: '', cloudPath: `families/${auth.family._id}/garments/${garmentId}/${id()}.jpg`,
          createdBy: userId, updatedBy: userId, deletedBy: null, status: 'uploading', version: 1,
          createdAt: timestamp, updatedAt: timestamp, deletedAt: null, uploadExpiresAt: timestamp + 3600000, uploadAttempt: '',
        };
        await unit.put('garments', garment); return { id: garmentId };
      });
      if (action === 'upload') {
        const garmentId = text(input.garmentId, 80), attempt = id();
        const base64 = text(input.base64, 1024 * 1024, true);
        const draft = await repo.transaction(async unit => {
          const { garment } = await validGarment(unit, userId, garmentId, true);
          if (garment.createdBy !== userId) return fail('UPLOAD_INVALID', '只有上传者可完成此图片');
          if (garment.status === 'active') return garment;
          if (garment.uploadExpiresAt <= now()) return fail('UPLOAD_INVALID', '上传已过期，请重新添加');
          if (garment.uploadAttempt) return fail('UPLOAD_IN_PROGRESS', '图片仍在云端处理中，请稍后重试');
          const locked = { ...garment, uploadAttempt: attempt, updatedAt: now() };
          await unit.put('garments', locked); return locked;
        });
        if (draft.status === 'active') return garmentView(draft);
        let fileId = '';
        try {
          fileId = await storage.upload(draft.cloudPath, base64);
          const saved = await repo.transaction(async unit => {
            const { garment } = await validGarment(unit, userId, garmentId, true);
            if (garment.createdBy !== userId || garment.status !== 'uploading' || garment.uploadAttempt !== attempt || garment.uploadExpiresAt <= now()) return fail('UPLOAD_INVALID', '上传状态已变化，请重新添加');
            await validMember(unit, garment.familyId, garment.memberId);
            const active: Garment = { ...garment, imageFileId: fileId, status: 'active', updatedAt: now(), version: garment.version + 1 };
            await unit.put('garments', active); return active;
          });
          return garmentView(saved);
        } catch (error) {
          // Commit can succeed while its response is lost. Never delete an active image.
          // If the state cannot be confirmed, leave the file for the cleanup worker.
          const failedDraft = await repo.transaction(async unit => {
            const item = await unit.get('garments', garmentId);
            if (!item || !['uploading', 'expired', 'discarded'].includes(item.status) || item.uploadAttempt !== attempt) return false;
            // The timer may have discarded an expired draft before storage I/O
            // returned. Track that late file again so compensation cannot lose it.
            await unit.put('garments', { ...item, status: 'expired', cleanupGeneration: (item.cleanupGeneration || 0) + 1,
              imageFileId: fileId, cloudPath: draft.cloudPath, uploadExpiresAt: now(), updatedAt: now() });
            return true;
          }).catch(() => false);
          if (failedDraft && fileId) await storage.remove(fileId).catch(() => {});
          throw error;
        }
      }
      if (action === 'image' || action === 'get') {
        const { garment } = await validGarment(repo, userId, text(input.garmentId, 80));
        const urls = await storage.urls([garment.imageFileId]);
        await sameFamily(userId, garment.familyId);
        if (action === 'get') return garmentView(garment, urls[garment.imageFileId] || '');
        return { url: urls[garment.imageFileId] || '', expiresAt: now() + 300000 };
      }
      if (action === 'update' || action === 'delete') return repo.transaction(async unit => {
        const { garment } = await validGarment(unit, userId, text(input.garmentId, 80));
        versionCheck(garment.version, input.version);
        const patch = action === 'update' ? fields((input.patch || {}) as Input, true) : {};
        if (patch.memberId) await validMember(unit, garment.familyId, patch.memberId);
        if (patch.locationId) await checkLocation(unit, garment.familyId, patch.locationId);
        const updated: Garment = { ...garment, ...patch, updatedBy: userId, updatedAt: now(), version: garment.version + 1,
          ...(action === 'delete' ? { status: 'deleted' as const, deletedBy: userId, deletedAt: now() } : {}) };
        await unit.put('garments', updated); return garmentView(updated);
      });
    }
    return fail('INVALID_ACTION', '暂不支持此操作');
  };
}
