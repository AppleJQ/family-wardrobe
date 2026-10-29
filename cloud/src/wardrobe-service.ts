import { identityUserId } from './identity';
import { createHash, randomBytes } from 'node:crypto';
import { Category, Collection, Entities, Garment, GarmentSnapshot, Identity, ImageStorage, Input, ListOptions, Location, Outfit, Repository, Unit, User, WearStatus } from './model';
import { BusinessError } from './service';

const DAY = 86400000;
const RETENTION = 30 * DAY;
const CATEGORIES: Category[] = ['onepiece', 'top', 'bottom', 'hat'];
const WEAR_STATUSES: WearStatus[] = ['wearable', 'laundry', 'storage', 'retired'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
function text(value: unknown, max = 80, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) return fail('INVALID_INPUT', '请填写有效信息');
  return value.trim();
}
function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_INPUT', '操作信息无效');
  return value as Input;
}
function checkVersion(actual: number, expected: unknown) {
  if (actual !== expected) fail('CONFLICT', '信息已被家人更新，请刷新后重试');
}
function references(value: unknown, max = 20): Array<{ id: string; version: number }> {
  if (!Array.isArray(value) || !value.length || value.length > max) return fail('INVALID_INPUT', `每次请选择1至${max}件衣物`);
  const result = value.map(raw => {
    const row = object(raw), id = text(row.id);
    if (!Number.isInteger(row.version) || Number(row.version) < 1) return fail('INVALID_INPUT', '衣物版本无效');
    return { id, version: row.version as number };
  });
  if (new Set(result.map(row => row.id)).size !== result.length) return fail('INVALID_INPUT', '不能重复选择衣物');
  return result;
}
function cursor(value: unknown): ListOptions['before'] {
  if (value === undefined || value === '') return undefined;
  let result;
  try { result = JSON.parse(Buffer.from(text(value, 300), 'base64url').toString()); } catch { return fail('INVALID_INPUT', '分页信息无效'); }
  if (!result || !Number.isFinite(result.createdAt) || typeof result.id !== 'string' || !result.id || result.id.length > 80) return fail('INVALID_INPUT', '分页信息无效');
  return { createdAt: result.createdAt, id: result.id };
}
const encode = (item: { _id: string; createdAt: number }) => Buffer.from(JSON.stringify({ createdAt: item.createdAt, id: item._id })).toString('base64url');
function pageSize(value: unknown) {
  const size = value === undefined ? 20 : Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 50) return fail('INVALID_INPUT', '分页大小无效');
  return size;
}
export function garmentSnapshot(garment: Garment): GarmentSnapshot {
  return { id: garment._id, memberId: garment.memberId, name: garment.name, category: garment.category, status: garment.wearStatus,
    color: garment.color, season: garment.season, material: garment.material, location: garment.location,
    locationId: garment.locationId || '', notes: garment.notes, version: garment.version };
}
function garmentView(garment: Garment, image = '') {
  return { ...garmentSnapshot(garment), image, createdAt: new Date(garment.createdAt).toISOString().slice(0, 10),
    updatedAt: garment.updatedAt, deletedAt: garment.deletedAt, restoreUntil: garment.deletedAt === null ? null : garment.deletedAt + RETENTION };
}
function patch(value: unknown): Partial<Garment> {
  const input = object(value), result: Partial<Garment> = {};
  const allowed = ['name', 'memberId', 'category', 'color', 'season', 'material', 'location', 'locationId', 'notes', 'status'];
  if (!Object.keys(input).length || Object.keys(input).some(key => !allowed.includes(key))) return fail('INVALID_INPUT', '请选择可修改的衣物属性');
  for (const key of ['name', 'memberId', 'color', 'season', 'material', 'location', 'locationId', 'notes'] as const) {
    if (input[key] !== undefined) result[key] = text(input[key], key === 'notes' ? 500 : key === 'name' ? 60 : key === 'memberId' || key === 'locationId' ? 80 : 100, key !== 'name' && key !== 'memberId');
  }
  if (input.category !== undefined) {
    if (!CATEGORIES.includes(input.category as Category)) return fail('INVALID_INPUT', '分类无效');
    result.category = input.category as Category;
  }
  if (input.status !== undefined) {
    if (!WEAR_STATUSES.includes(input.status as WearStatus)) return fail('INVALID_INPUT', '状态无效');
    result.wearStatus = input.status as WearStatus;
  }
  return result;
}

// A reference assignment writes the location as well: snapshot reads alone do not
// stop a concurrent delete from committing a dangling newly assigned reference.
export async function checkLocation(unit: Unit, familyId: string, locationId: string, fence = true) {
  if (!locationId) return;
  const location = await unit.get('locations', locationId);
  if (!location || location.familyId !== familyId || location.status !== 'active') return fail('NOT_FOUND', '收纳位置不存在');
  if (fence) await unit.put('locations', { ...location, structureFence: (location.structureFence || 0) + 1 });
}

async function all<K extends Collection>(repo: Repository, collection: K, filter: Partial<Entities[K]>) {
  const result: Entities[K][] = [];
  let before: ListOptions['before'];
  for (;;) {
    const rows = await repo.list(collection, filter, { before, limit: 100 });
    result.push(...rows);
    if (rows.length < 100) return result;
    before = { createdAt: rows[rows.length - 1].createdAt, id: rows[rows.length - 1]._id };
  }
}

export function createWardrobeService(repo: Repository, storage: ImageStorage, now = Date.now) {
  async function auth(unit: Unit, userId: string, expectedFamily = '', knownUser?: User) {
    const user = knownUser || await unit.get('users', userId);
    if (!user || user.status !== 'active') return fail('UNAUTHENTICATED', '请重新进入小程序');
    if (!user.activeFamilyId || (expectedFamily && expectedFamily !== user.activeFamilyId)) return fail('NO_FAMILY', '家庭权限已变化，请重新进入');
    const [family, membership] = await Promise.all([
      unit.get('families', user.activeFamilyId),
      unit.get('family_memberships', hash(`${user.activeFamilyId}/${userId}`)),
    ]);
    if (!family || family.status !== 'active' || !membership || membership.status !== 'active') return fail('NO_FAMILY', '家庭权限已变化，请重新进入');
    if (unit !== repo) await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
    return { user, familyId: family._id, family, membership };
  }
  async function member(unit: Unit, familyId: string, memberId: string) {
    const result = await unit.get('family_members', memberId);
    if (!result || result.familyId !== familyId || result.status !== 'active') return fail('NOT_FOUND', '成员档案不存在');
    return result;
  }
  async function garment(unit: Unit, familyId: string, id: string, status: Garment['status'] = 'active') {
    const result = await unit.get('garments', id);
    if (!result || result.familyId !== familyId || result.status !== status) return fail('NOT_FOUND', '衣物不存在或无权访问');
    return result;
  }
  async function location(unit: Unit, familyId: string, id: string) {
    const result = await unit.get('locations', id);
    if (!result || result.familyId !== familyId || result.status !== 'active') return fail('NOT_FOUND', '收纳位置不存在');
    return result;
  }
  async function sign(userId: string, familyId: string, items: Garment[]) {
    const urls = await storage.urls(items.filter(item => item.imageFileId).map(item => item.imageFileId));
    await auth(repo, userId, familyId);
    return items.map(item => garmentView(item, urls[item.imageFileId] || ''));
  }
  async function readGarmentPage(familyId: string, input: Input, deleted = false) {
    const filter: Partial<Garment> = { familyId, status: deleted ? 'deleted' : 'active' };
    if (input.memberId) { filter.memberId = text(input.memberId); await member(repo, familyId, filter.memberId); }
    if (input.category && input.category !== 'all') {
      if (!CATEGORIES.includes(input.category as Category)) return fail('INVALID_INPUT', '分类无效');
      filter.category = input.category as Category;
    }
    if (input.status && input.status !== 'all') {
      if (!WEAR_STATUSES.includes(input.status as WearStatus)) return fail('INVALID_INPUT', '状态无效');
      filter.wearStatus = input.status as WearStatus;
    }
    for (const key of ['color', 'season', 'location', 'locationId'] as const) if (input[key]) filter[key] = text(input[key], 100);
    const search = text(input.search, 100, true).toLocaleLowerCase();
    const limit = pageSize(input.limit), matches: Garment[] = [];
    const batchSize = limit + 1;
    let before = cursor(input.cursor);
    // The adapter applies search before cursor/limit. The extra predicate
    // also supports older repository implementations without dropping matches.
    while (matches.length <= limit) {
      const rows = await repo.list('garments', filter, { before, limit: batchSize, search });
      matches.push(...rows.filter(row => !search || `${row.name}\n${row.notes}`.toLocaleLowerCase().includes(search)));
      if (rows.length < batchSize) break;
      const last = rows[rows.length - 1]; before = { createdAt: last.createdAt, id: last._id };
    }
    const page = matches.slice(0, limit), last = page[page.length - 1];
    return { page, cursor: matches.length > limit && last ? encode(last) : '' };
  }
  async function garmentPage(userId: string, input: Input, deleted = false, exporting = false) {
    const scope = await auth(repo, userId);
    const { page, cursor } = await readGarmentPage(scope.familyId, input, deleted);
    const items = await sign(userId, scope.familyId, page);
    const result = { items, cursor };
    if (!exporting) return result;
    const [members, locations] = await Promise.all([all(repo, 'family_members', { familyId: scope.familyId, status: 'active' }), all(repo, 'locations', { familyId: scope.familyId, status: 'active' })]);
    await auth(repo, userId, scope.familyId);
    return { ...result, exportedAt: now(), imageExpiresAt: now() + 300000,
      items: items.map((item, index) => ({ ...item, familyId: scope.familyId, createdAt: page[index].createdAt, lifecycle: 'active' })),
      manifest: { schemaVersion: '0.2', family: { id: scope.familyId, name: scope.family.name },
        members: members.map(item => ({ id: item._id, name: item.name, version: item.version })), locations: locations.map(locationView) } };
  }
  async function home(userId: string, input: Input, knownUser?: User) {
    const user = knownUser || await repo.get('users', userId);
    if (!user || user.status !== 'active') return fail('UNAUTHENTICATED', '请重新进入小程序');
    if (!user.activeFamilyId) return { userId, family: null, members: [], accounts: [], garments: { items: [], cursor: '' }, locations: [] };
    const scope = await auth(repo, userId, '', user);
    const [members, memberships, locations, garments] = await Promise.all([
      all(repo, 'family_members', { familyId: scope.familyId, status: 'active' }),
      all(repo, 'family_memberships', { familyId: scope.familyId, status: 'active' }),
      all(repo, 'locations', { familyId: scope.familyId, status: 'active' }),
      readGarmentPage(scope.familyId, input),
    ]);
    const imageIds = garments.page.filter(item => item.imageFileId).map(item => item.imageFileId);
    const urls = imageIds.length ? await storage.urls(imageIds) : {};
    // One fresh authorization after every read and URL signing protects the
    // combined response against removal, blocking, and a concurrent family switch.
    const fresh = await auth(repo, userId, scope.familyId);
    return {
      userId, family: { id: fresh.familyId, name: fresh.family.name, role: fresh.membership.role },
      members: members.sort((a, b) => a.sortOrder - b.sortOrder).map(item => ({ id: item._id, name: item.name, version: item.version })),
      accounts: memberships.map(item => ({ userId: item.userId, role: item.role, isSelf: item.userId === userId, label: item.role === 'owner' ? '家庭管理员' : `家人 ${item.userId.slice(-4)}` })),
      garments: { items: garments.page.map(item => garmentView(item, urls[item.imageFileId] || '')), cursor: garments.cursor },
      locations: locations.map(locationView),
    };
  }
  async function bulk(userId: string, input: Input) {
    const refs = references(input.items), action = input.action;
    const changes = action === 'batchUpdate' ? patch(input.patch) : {};
    const items = await repo.transaction(async unit => {
      const scope = await auth(unit, userId);
      if (changes.memberId) await member(unit, scope.familyId, changes.memberId);
      if (changes.locationId) await checkLocation(unit, scope.familyId, changes.locationId);
      const loaded: Garment[] = [];
      for (const ref of refs) {
        const item = await garment(unit, scope.familyId, ref.id, action === 'restore' || action === 'purge' ? 'deleted' : 'active');
        checkVersion(item.version, ref.version);
        if (action === 'restore' && (item.deletedAt === null || now() >= item.deletedAt + RETENTION)) return fail('RESTORE_EXPIRED', '衣物已超过30天恢复期限');
        loaded.push(item);
      }
      const changed = loaded.map(item => ({ ...item, ...changes, version: item.version + 1, updatedBy: userId, updatedAt: now(),
        ...(action === 'batchDelete' ? { status: 'deleted' as const, deletedAt: now(), deletedBy: userId } : {}),
        ...(action === 'restore' ? { status: 'active' as const, deletedAt: null, deletedBy: null } : {}),
        ...(action === 'purge' ? { status: 'purging' as const, cleanupGeneration: (item.cleanupGeneration || 0) + 1 } : {}) }));
      for (const item of changed) await unit.put('garments', item);
      return changed;
    });
    if (action !== 'purge') return { items: items.map(item => garmentView(item)) };
    let purged = 0;
    for (const item of items) if (await finishPurge(repo, storage, item, now)) purged++;
    return { success: true, purged, pending: items.length - purged };
  }
  function locationView(item: Location) { return { id: item._id, name: item.name, parentId: item.parentId, version: item.version }; }
  async function locations(userId: string, input: Input) {
    const scope = await auth(repo, userId);
    if (input.action === 'locations.list') {
      const rows = await all(repo, 'locations', { familyId: scope.familyId, status: 'active' });
      await auth(repo, userId, scope.familyId); return { items: rows.map(locationView) };
    }
    return repo.transaction(async unit => {
      await auth(unit, userId, scope.familyId);
      const old = input.action === 'locations.create' ? null : await location(unit, scope.familyId, text(input.id));
      if (old) checkVersion(old.version, input.version);
      if (input.action === 'locations.delete' && old) {
        if (old.childCount) return fail('LOCATION_HAS_CHILDREN', '请先移除下级位置');
        if (old.parentId) {
          const parent = await location(unit, scope.familyId, old.parentId);
          await unit.put('locations', { ...parent, childCount: Math.max(0, parent.childCount - 1), structureFence: parent.structureFence + 1 });
        }
        await unit.put('locations', { ...old, status: 'deleted', version: old.version + 1, updatedAt: now(), updatedBy: userId });
        return { success: true };
      }
      if (!['locations.create', 'locations.update'].includes(String(input.action))) return fail('INVALID_ACTION', '暂不支持此操作');
      const parentId = input.parentId === undefined && old ? old.parentId : text(input.parentId, 80, true);
      if (parentId === old?._id || (parentId && old?.childCount)) return fail('INVALID_INPUT', '收纳位置最多支持两级');
      if (parentId) {
        const parent = await location(unit, scope.familyId, parentId);
        if (parent.parentId) return fail('INVALID_INPUT', '收纳位置最多支持两级');
        if (!old || parentId !== old.parentId) await unit.put('locations', { ...parent, childCount: parent.childCount + 1, structureFence: parent.structureFence + 1 });
      }
      if (old?.parentId && parentId !== old.parentId) {
        const previous = await location(unit, scope.familyId, old.parentId);
        await unit.put('locations', { ...previous, childCount: Math.max(0, previous.childCount - 1), structureFence: previous.structureFence + 1 });
      }
      const saved: Location = { _id: old?._id || randomBytes(16).toString('hex'), familyId: scope.familyId,
        name: input.name === undefined && old ? old.name : text(input.name, 40), parentId, status: 'active',
        createdAt: old?.createdAt || now(), updatedAt: now(), version: (old?.version || 0) + 1,
        createdBy: old?.createdBy || userId, updatedBy: userId, childCount: old?.childCount || 0, structureFence: old?.structureFence || 0 };
      await unit.put('locations', saved); return locationView(saved);
    });
  }
  async function outfitView(userId: string, item: Outfit) {
    await auth(repo, userId, item.familyId);
    const evaluated = await Promise.all(item.garments.map(async snapshot => {
        const current = await repo.get('garments', snapshot.id);
        const available = !!current && current.familyId === item.familyId && current.status === 'active';
        const code = !available ? 'GARMENT_MISSING' : current.memberId !== item.memberId ? 'MEMBER_CHANGED'
          : current.version !== snapshot.version ? 'GARMENT_CHANGED' : '';
        return { snapshot, current: available ? current : null, code };
    }));
    const urls = await storage.urls(evaluated.flatMap(row => row.current?.imageFileId ? [row.current.imageFileId] : []));
    await auth(repo, userId, item.familyId);
    return { id: item._id, memberId: item.memberId, name: item.name, occasion: item.occasion, reason: item.reason,
      partial: item.partial, version: item.version, createdAt: item.createdAt, updatedAt: item.updatedAt,
      garmentIds: item.garments.map(row => row.id), valid: evaluated.every(row => !row.code),
      issues: evaluated.filter(row => row.code).map(row => ({ id: row.snapshot.id, code: row.code })),
      garments: evaluated.map(row => ({ ...row.snapshot,
        available: !!row.current && row.current.memberId === item.memberId, currentVersion: row.current?.version || null,
        image: row.current ? urls[row.current.imageFileId] || '' : '' })) };
  }
  async function outfits(userId: string, input: Input) {
    const scope = await auth(repo, userId), action = input.action;
    if (action === 'outfits.list') {
      const filter: Partial<Outfit> = { familyId: scope.familyId, status: 'active' };
      if (input.memberId) { filter.memberId = text(input.memberId); await member(repo, scope.familyId, filter.memberId); }
      const limit = pageSize(input.limit), rows = await repo.list('outfits', filter, { before: cursor(input.cursor), limit: limit + 1 });
      const page = rows.slice(0, limit), last = page[page.length - 1];
      return { items: await Promise.all(page.map(item => outfitView(userId, item))), cursor: rows.length > limit && last ? encode(last) : '' };
    }
    if (action === 'outfits.get') {
      const item = await repo.get('outfits', text(input.id));
      if (!item || item.familyId !== scope.familyId || item.status !== 'active') return fail('NOT_FOUND', '搭配不存在');
      return outfitView(userId, item);
    }
    if (!['outfits.create', 'outfits.update', 'outfits.delete'].includes(String(action))) return fail('INVALID_ACTION', '暂不支持此操作');
    const saved = await repo.transaction(async unit => {
      await auth(unit, userId, scope.familyId);
      const creating = action === 'outfits.create';
      let requestId = '';
      if (creating) {
        requestId = text(input.requestId);
        if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) return fail('INVALID_INPUT', '请求编号无效');
      }
      const outfitId = creating ? hash(`${scope.familyId}/${userId}/${requestId}`) : text(input.id);
      const old = await unit.get('outfits', outfitId);
      if (!creating && (!old || old.status !== 'active' || old.familyId !== scope.familyId)) return fail('NOT_FOUND', '搭配不存在');
      if (!creating) checkVersion(old!.version, input.version);
      if (action === 'outfits.delete') {
        await unit.put('outfits', { ...old!, status: 'deleted', version: old!.version + 1, updatedAt: now(), updatedBy: userId }); return null;
      }
      const memberId = text(input.memberId), name = text(input.name, 60), occasion = text(input.occasion, 300, true), reason = text(input.reason, 300, true);
      if (input.partial !== undefined && typeof input.partial !== 'boolean') return fail('INVALID_INPUT', '组合类型无效');
      const partial = input.partial === true, refs = references(input.garments, 3);
      const fingerprint = hash(JSON.stringify({ memberId, name, occasion, reason, partial, refs: [...refs].sort((a, b) => a.id.localeCompare(b.id)) }));
      if (creating && old) {
        if (old.requestFingerprint !== fingerprint) return fail('REQUEST_CONFLICT', '请求编号已用于其他输入');
        if (old.status !== 'active') return fail('NOT_FOUND', '搭配已删除');
        return old;
      }
      await member(unit, scope.familyId, memberId);
      const garments: Garment[] = [];
      for (const ref of refs) {
        const item = await garment(unit, scope.familyId, ref.id);
        checkVersion(item.version, ref.version);
        if (item.memberId !== memberId) return fail('INVALID_INPUT', '请选择当前成员的衣物');
        await unit.put('garments', { ...item, aiFence: (item.aiFence || 0) + 1 });
        garments.push(item);
      }
      const slots = garments.map(item => item.category);
      if (new Set(slots).size !== slots.length || (slots.includes('onepiece') && (slots.includes('top') || slots.includes('bottom')))) return fail('INVALID_INPUT', '衣物类别不能重复，整装不能与上衣裤子组合');
      if (!partial && !slots.includes('onepiece') && !(slots.includes('top') && slots.includes('bottom'))) return fail('INCOMPLETE_OUTFIT', '完整搭配需要整装或上衣加裤子；也可标记为部分搭配');
      const item: Outfit = { _id: outfitId, familyId: scope.familyId, memberId, name, occasion, reason, partial,
        garments: garments.map(garmentSnapshot), status: 'active', version: (old?.version || 0) + 1,
        createdBy: old?.createdBy || userId, updatedBy: userId, createdAt: old?.createdAt || now(), updatedAt: now(), requestFingerprint: old?.requestFingerprint || fingerprint };
      await unit.put('outfits', item); return item;
    });
    return saved ? outfitView(userId, saved) : { success: true };
  }
  return async (input: Input, identity: Identity, knownUser?: User): Promise<unknown> => {
    const verifiedUserId = identityUserId(identity);
    if (!verifiedUserId) return fail('UNAUTHENTICATED', '请重新登录');
    const userId = verifiedUserId;
    if (input.action === 'home') return home(userId, input, knownUser);
    if (input.action === 'list') return garmentPage(userId, input);
    if (input.action === 'trash') return garmentPage(userId, input, true);
    if (input.action === 'exportPage') return garmentPage(userId, input, false, true);
    await auth(repo, userId);
    if (input.action === 'status') return { version: '0.2', batchLimit: 20, trashRetentionDays: 30, capabilities: ['search', 'bulk', 'trash', 'locations', 'outfits', 'export'] };
    if (['batchUpdate', 'batchDelete', 'restore', 'purge'].includes(String(input.action))) return bulk(userId, input);
    if (String(input.action).startsWith('locations.')) return locations(userId, input);
    if (String(input.action).startsWith('outfits.')) return outfits(userId, input);
    return fail('INVALID_ACTION', '暂不支持此操作');
  };
}

async function finishPurge(repo: Repository, storage: ImageStorage, garment: Garment, now: () => number) {
  try {
    const fileIdFor = (path: string) => `cloud://wardrobe-dev-cloude-d5bv128b6099.7761-wardrobe-dev-cloude-d5bv128b6099-1306311302/${path}`;
    const fileId = garment.imageFileId || (garment.cloudPath ? fileIdFor(garment.cloudPath) : '');
    const retainedPaths = (garment.retainedImagePaths || []).filter(path => path !== garment.cloudPath);
    for (const image of new Set([fileId, ...retainedPaths.map(fileIdFor)].filter(Boolean))) await storage.remove(image);
    return await repo.transaction(async unit => {
      const current = await unit.get('garments', garment._id);
      // Storage completion can arrive after a newer upload compensation or
      // cleanup claim. Only clear the exact generation whose file we removed.
      if (!current || current.status !== garment.status || (current.status !== 'purging' && current.status !== 'expired')
        || (current.cleanupGeneration || 0) !== (garment.cleanupGeneration || 0) || current.version !== garment.version
        || current.imageFileId !== garment.imageFileId || current.cloudPath !== garment.cloudPath || current.uploadAttempt !== garment.uploadAttempt
        || JSON.stringify(current.retainedImagePaths || []) !== JSON.stringify(garment.retainedImagePaths || [])) return false;
      await unit.put('garments', { ...current, status: 'discarded', imageFileId: '', cloudPath: '', retainedImagePaths: [], updatedAt: now() });
      return true;
    });
  } catch { return false; }
}

/** Timer-only compensation. A purging/expired record can never be restored. */
export async function cleanupGarments(repo: Repository, storage: ImageStorage, timestamp = Date.now()) {
  const groups = await Promise.all([
    repo.list('garments', { status: 'purging' }, { limit: 50 }),
    repo.list('garments', { status: 'deleted' }, { deletedBefore: timestamp - RETENTION, limit: 50 }),
    repo.list('garments', { status: 'expired' }, { limit: 50 }),
    repo.list('garments', { status: 'uploading' }, { expiresBefore: timestamp, limit: 50 }),
  ]);
  let cleaned = 0, pending = 0;
  for (const item of groups.flat()) {
    const claimed = await repo.transaction(async unit => {
      const current = await unit.get('garments', item._id);
      if (!current) return null;
      if (current.status === 'deleted') {
        if (current.deletedAt === null || current.deletedAt + RETENTION > timestamp) return null;
        const locked: Garment = { ...current, status: 'purging', version: current.version + 1, cleanupGeneration: (current.cleanupGeneration || 0) + 1, updatedAt: timestamp };
        await unit.put('garments', locked); return locked;
      }
      if (current.status === 'uploading') {
        if (current.uploadExpiresAt > timestamp) return null;
        const locked: Garment = { ...current, status: 'expired', cleanupGeneration: (current.cleanupGeneration || 0) + 1, updatedAt: timestamp };
        await unit.put('garments', locked); return locked;
      }
      if (current.status !== 'purging' && current.status !== 'expired') return null;
      const locked: Garment = { ...current, cleanupGeneration: (current.cleanupGeneration || 0) + 1 };
      await unit.put('garments', locked); return locked;
    });
    if (!claimed) continue;
    if (await finishPurge(repo, storage, claimed, () => timestamp)) cleaned++; else pending++;
  }
  return { cleaned, pending };
}
