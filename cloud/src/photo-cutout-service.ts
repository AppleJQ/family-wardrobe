import { createHash, randomUUID } from 'node:crypto';
import { BusinessError } from './service';
import { CutoutError, CutoutProvider } from './ci-cutout';
import { Identity, Input, PhotoCutoutTask, Repository, Unit } from './model';
import { normalizeImage } from './image';

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
const TTL = 6 * 3600000;

/** Private temporary photos only. No garment exists until the user saves a batch. */
export function createPhotoCutoutService(repo: Repository, provider: CutoutProvider, options: { now?: () => number } = {}) {
  const now = options.now || Date.now;
  async function authorize(unit: Unit, userId: string, expectedFamily = '') {
    const user = await unit.get('users', userId);
    if (!user || user.status !== 'active') return fail('UNAUTHENTICATED', '请重新进入小程序');
    if (!user.activeFamilyId || (expectedFamily && user.activeFamilyId !== expectedFamily)) return fail('NO_FAMILY', '家庭权限已变化，请重新进入');
    const [family, membership] = await Promise.all([unit.get('families', user.activeFamilyId), unit.get('family_memberships', hash(`${user.activeFamilyId}/${userId}`))]);
    if (!family || family.status !== 'active' || !membership || membership.status !== 'active') return fail('NO_FAMILY', '家庭权限已变化，请重新进入');
    if (unit !== repo) await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
    return user;
  }
  return async (input: Input, identity: Identity) => {
    if (!identity.openid || identity.appid !== 'wx80f51573314b7bd2' || !['wx_client', 'wx_devtools'].includes(identity.source)) return fail('UNAUTHENTICATED', '仅支持本小程序的微信登录');
    if (!['getPhoto', 'processPhoto'].includes(String(input.action))) return fail('INVALID_ACTION', '暂不支持此操作');
    const userId = hash(`wx/${identity.appid}/${identity.openid}`).slice(0, 40), user = await authorize(repo, userId), familyId = user.activeFamilyId;
    const requestId = typeof input.requestId === 'string' ? input.requestId : '';
    if (!/^w_[a-z0-9]+_[a-zA-Z0-9_-]{1,40}$/.test(requestId)) return fail('INVALID_INPUT', '请选择有效照片');
    const view = (task: PhotoCutoutTask) => ({ requestId, status: task.status === 'running' && now() - task.startedAt > 45000 ? 'unknown' : task.status, error: task.error, errorCode: task.errorCode, cached: true });
    async function update(task: PhotoCutoutTask) {
      await repo.transaction(async unit => {
        const current = await unit.get('users', userId);
        if (!current?.photoCutouts?.some(item => item.requestId === requestId && item.attempt === task.attempt)) return;
        await unit.put('users', { ...current, photoCutouts: current.photoCutouts.map(item => item.requestId === requestId ? task : item) });
      });
    }
    async function cached(task: PhotoCutoutTask) {
      if (task.expiresAt <= now()) return { ...view(task), status: 'expired', error: '预览已过期，可重新生成' };
      if (task.status === 'running' && now() - task.startedAt < 45000) return view(task);
      if (task.status === 'failed') return view(task);
      let bytes: Buffer;
      try { bytes = await provider.get(task.key); }
      catch (error) {
        if (task.status !== 'succeeded') return { ...view(task), status: 'unknown', error: '结果暂未返回，请稍后查看' };
        if (error instanceof CutoutError && error.code === 'CUTOUT_CACHE_MISSING') return { ...view(task), status: 'expired', error: '预览已过期，可重新生成' };
        return fail('CUTOUT_CACHE_UNAVAILABLE', '预览暂不可读取，请稍后再试');
      }
      await authorize(repo, userId, familyId);
      if (task.status !== 'succeeded') await update({ ...task, status: 'succeeded', error: '', errorCode: '' });
      return { ...view(task), status: 'succeeded', base64: bytes.toString('base64') };
    }
    const old = user.photoCutouts?.find(task => task.requestId === requestId && task.familyId === familyId);
    if (input.action === 'getPhoto') return old ? cached(old) : { status: 'none', requestId };
    const started = parseInt(requestId.split('_')[1], 36);
    if (!old && (!Number.isSafeInteger(started) || started < now() - TTL || started > now() + 300000)) return fail('CUTOUT_EXPIRED', '本次预览已过期，请重新生成');
    if (!provider.configured) return fail('CUTOUT_NOT_CONFIGURED', '去背景暂不可用，请稍后再试');
    if (typeof input.base64 !== 'string' || input.base64.length > 1024 * 1024) return fail('INVALID_IMAGE', '请选择有效的衣物照片');
    const bytes = await normalizeImage(input.base64), fingerprint = hash(bytes);
    if (old) {
      if (old.fingerprint !== fingerprint) return fail('REQUEST_CONFLICT', '照片已变化，请重新预览');
      return cached(old);
    }
    const claim = await repo.transaction(async unit => {
      const current = await authorize(unit, userId, familyId);
      const existing = current.photoCutouts?.find(task => task.requestId === requestId);
      if (existing) {
        if (existing.familyId !== familyId || existing.fingerprint !== fingerprint) return fail('REQUEST_CONFLICT', '照片已变化，请重新预览');
        return { task: existing, start: false };
      }
      const day = new Date(now() + 8 * 3600000).toISOString().slice(0, 10), used = current.cutoutDay === day ? current.cutoutCalls || 0 : 0;
      if (used >= 30) return fail('CUTOUT_DAILY_LIMIT', '今日去背景次数已用完，请明天再试');
      const tasks = (current.photoCutouts || []).filter(task => task.startedAt > now() - 24 * 3600000);
      if (tasks.length >= 60) return fail('CUTOUT_DAILY_LIMIT', '暂时无法处理更多照片，请稍后再试');
      const attempt = hash(randomUUID()), root = `wardrobe-cutouts/v1/${hash(familyId)}/${hash(userId)}/${attempt}`;
      const task: PhotoCutoutTask = { requestId, familyId, fingerprint, sourceId: fingerprint, sourceKey: `${root}.jpg`, key: `${root}.png`, attempt,
        status: 'running', error: '', errorCode: '', startedAt: now(), expiresAt: now() + TTL };
      await unit.put('users', { ...current, photoCutouts: [...tasks, task], cutoutDay: day, cutoutCalls: used + 1, updatedAt: now() });
      return { task, start: true };
    });
    if (!claim.start) return cached(claim.task);
    const task = claim.task; let submitted = false, stored = false;
    try {
      await provider.putSource(task.sourceKey, bytes);
      const url = await provider.sourceUrl(task.sourceKey);
      await authorize(repo, userId, familyId);
      submitted = true;
      const result = await provider.process(url, 'common');
      await provider.put(task.key, result); stored = true;
      await authorize(repo, userId, familyId);
      await update({ ...task, status: 'succeeded' });
      return { requestId, status: 'succeeded', base64: result.toString('base64'), cached: false };
    } catch (error) {
      const unknown = stored || (error instanceof CutoutError ? error.uncertain : submitted);
      const failed: PhotoCutoutTask = { ...task, status: unknown ? 'unknown' : 'failed', errorCode: error instanceof CutoutError ? error.code : 'CUTOUT_UNAVAILABLE',
        error: unknown ? '结果暂未返回，请稍后查看' : '去背景暂未完成，可稍后重试' };
      await update(failed);
      if (error instanceof BusinessError) throw error;
      return view(failed);
    } finally { try { await provider.remove(task.sourceKey); } catch { /* Private lifecycle expires the temporary source. */ } }
  };
}
