import { createHash, randomUUID } from 'node:crypto';
import { BusinessError } from './service';
import { CutoutTask, Garment, Identity, ImageStorage, Input, Repository, Unit } from './model';
import { CutoutError, CutoutMode, CutoutProvider } from './ci-cutout';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
export function createCutoutService(repo: Repository, provider: CutoutProvider, sourceUrl: (fileId: string) => Promise<string>, options: { now?: () => number; storage?: Pick<ImageStorage, 'uploadPng'> } = {}) {
  const now = options.now || Date.now;
  async function authorize(unit: Unit, userId: string, familyId = '') {
    const user = await unit.get('users', userId);
    if (!user || user.status !== 'active') return fail('UNAUTHENTICATED', '请重新进入小程序');
    if (!user.activeFamilyId || (familyId && user.activeFamilyId !== familyId)) return fail('NO_FAMILY', '家庭权限已变化，请重新进入');
    const [family, membership] = await Promise.all([unit.get('families', user.activeFamilyId), unit.get('family_memberships', hash(`${user.activeFamilyId}/${userId}`))]);
    if (!family || family.status !== 'active' || !membership || membership.status !== 'active') return fail('NO_FAMILY', '家庭权限已变化，请重新进入');
    if (unit !== repo) await unit.put('family_memberships', { ...membership, version: membership.version + 1, updatedAt: now() });
    return user;
  }
  async function garment(unit: Unit, familyId: string, id: string, sourceId?: string): Promise<Garment> {
    const row = await unit.get('garments', id);
    if (!row || row.familyId !== familyId || row.status !== 'active') return fail('NOT_FOUND', '衣物不存在或无权访问');
    if (!row.imageFileId || (sourceId && row.imageFileId !== sourceId)) return fail('CUTOUT_SOURCE_CHANGED', '衣物照片已变化，请重新打开');
    return row;
  }
  const view = (task: CutoutTask, cached = false) => ({ status: task.status === 'running' && now() - task.startedAt > 45000 ? 'unknown' : task.status, requestId: task.requestId, error: task.error, errorCode: task.errorCode, cached });
  return async (input: Input, identity: Identity) => {
    if (!identity.openid || identity.appid !== 'wx80f51573314b7bd2' || !['wx_client', 'wx_devtools'].includes(identity.source)) return fail('UNAUTHENTICATED', '仅支持本小程序的微信登录');
    const userId = hash(`wx/${identity.appid}/${identity.openid}`).slice(0, 40), user = await authorize(repo, userId), familyId = user.activeFamilyId;
    const mode: CutoutMode = input.mode === 'common' ? 'common' : 'goods';
    if (input.mode !== undefined && !['goods', 'common'].includes(String(input.mode))) return fail('INVALID_INPUT', '抠图方式无效');
    if (!['get', 'process', 'apply'].includes(String(input.action))) return fail('INVALID_ACTION', '暂不支持此操作');
    const id = typeof input.garmentId === 'string' ? input.garmentId : '';
    if (!id || id.length > 80) return fail('INVALID_INPUT', '请选择有效衣物');
    const original = await garment(repo, familyId, id), sourceId = original.imageFileId;
    const previous = original.cutouts?.[mode];
    if (input.action === 'apply') {
      const requestId = typeof input.requestId === 'string' ? input.requestId : '';
      if (!requestId || requestId.length > 80 || !Number.isInteger(input.version) || Number(input.version) < 1) return fail('INVALID_INPUT', '请选择有效的抠图结果');
      const applied = (row: Garment) => row.appliedCutout?.requestId === requestId && row.appliedCutout.mode === mode && row.appliedCutout.imageFileId === row.imageFileId;
      if (applied(original)) return { version: original.version };
      const task = previous;
      const check = (row: Garment) => {
        if (row.version !== input.version) return fail('CONFLICT', '衣物已被家人修改，请重新打开后再替换');
        if (!task || row.imageFileId !== task.sourceId || row.cutouts?.[mode]?.attempt !== task.attempt || task.requestId !== requestId || task.status !== 'succeeded') return fail('CUTOUT_SOURCE_CHANGED', '衣物照片或抠图结果已变化，请重新预览');
        if (task.expiresAt <= now()) return fail('CUTOUT_EXPIRED', '预览已过期，请重新生成');
      };
      check(original);
      if (!task || !options.storage) return fail('CUTOUT_UNAVAILABLE', '暂时无法替换照片，请稍后再试');
      const bytes = await provider.get(task.key);
      const path = `families/${familyId}/garments/${id}/cutout-${task.attempt}.png`;
      // Register the destination before storage I/O so an ambiguous upload is
      // included in permanent deletion, together with the original photograph.
      const claimed = await repo.transaction(async unit => {
        await authorize(unit, userId, familyId); const current = await garment(unit, familyId, id);
        if (applied(current)) return current;
        check(current);
        await unit.put('garments', { ...current, retainedImagePaths: [...new Set([...(current.retainedImagePaths || []), current.cloudPath, path].filter(Boolean))] });
        return null;
      });
      if (claimed) return { version: claimed.version };
      try {
        const fileId = await options.storage.uploadPng(path, bytes);
        const saved = await repo.transaction(async unit => {
          await authorize(unit, userId, familyId); const current = await garment(unit, familyId, id);
          if (applied(current)) return current;
          check(current);
          const updated: Garment = { ...current, imageFileId: fileId, cloudPath: path,
            appliedCutout: { requestId, mode, imageFileId: fileId }, updatedBy: userId, updatedAt: now(), version: current.version + 1 };
          await unit.put('garments', updated); return updated;
        });
        await authorize(repo, userId, familyId); await garment(repo, familyId, id);
        return { version: saved.version };
      } catch (error) {
        // An upload can complete after deletion/cleanup, or commit can succeed
        // while its response is lost. Keep active references and requeue only
        // terminal garments; never delete the newly active photograph here.
        await repo.transaction(async unit => {
          const current = await unit.get('garments', id);
          if (!current || !['purging', 'expired', 'discarded'].includes(current.status)) return;
          await unit.put('garments', { ...current, status: current.status === 'discarded' ? 'expired' : current.status,
            retainedImagePaths: [...new Set([...(current.retainedImagePaths || []), path])],
            cleanupGeneration: (current.cleanupGeneration || 0) + 1, updatedAt: now() });
        }).catch(() => {});
        throw error;
      }
    }
    async function cached(task: CutoutTask) {
      if (task.status === 'unknown' || (task.status === 'running' && now() - task.startedAt > 45000)) {
        let recovered: Buffer | undefined;
        try { recovered = await provider.get(task.key); } catch { /* Query only; never repeat the paid operation. */ }
        if (recovered) {
          const recoveredTask: CutoutTask = { ...task, status: 'succeeded', error: '', errorCode: '', expiresAt: now() + 6 * 3600000 };
          await repo.transaction(async unit => {
            await authorize(unit, userId, familyId); const current = await garment(unit, familyId, id, sourceId);
            if (current.cutouts?.[mode]?.attempt !== task.attempt) return fail('CUTOUT_SOURCE_CHANGED', '抠图任务已变化，请重查');
            await unit.put('garments', { ...current, cutouts: { ...current.cutouts, [mode]: recoveredTask } });
          });
          await authorize(repo, userId, familyId); await garment(repo, familyId, id, sourceId);
          return { ...view(recoveredTask, true), base64: recovered.toString('base64') };
        }
      }
      if (task.status !== 'succeeded') return view(task, true);
      if (task.expiresAt <= now()) return { ...view(task, true), status: 'expired', error: '预览已过期，再次生成将产生新费用' };
      let bytes: Buffer;
      try { bytes = await provider.get(task.key); } catch (error) {
        if (!(error instanceof CutoutError) || error.code !== 'CUTOUT_CACHE_MISSING') return fail('CUTOUT_CACHE_UNAVAILABLE', '预览暂不可读取，请稍后重查，不会重新计费');
        await repo.transaction(async unit => {
          await authorize(unit, userId, familyId); const current = await garment(unit, familyId, id, sourceId);
          if (current.cutouts?.[mode]?.attempt === task.attempt) await unit.put('garments', { ...current, cutouts: { ...current.cutouts, [mode]: { ...task, expiresAt: 0 } } });
        });
        return { ...view(task, true), status: 'expired', error: '预览已过期，再次生成将产生新费用' };
      }
      await authorize(repo, userId, familyId); await garment(repo, familyId, id, sourceId);
      return { ...view(task, true), base64: bytes.toString('base64') };
    }
    if (input.action === 'get') return previous?.sourceId === sourceId ? cached(previous) : { status: 'none' };
    const requestId = typeof input.requestId === 'string' ? input.requestId : '';
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) return fail('INVALID_INPUT', '请求编号无效');
    if (!provider.configured) return fail('CUTOUT_NOT_CONFIGURED', '智能去背景尚未配置');
    const claimed = await repo.transaction(async unit => {
      const currentUser = await authorize(unit, userId, familyId), current = await garment(unit, familyId, id, sourceId), old = current.cutouts?.[mode];
      if (old?.sourceId === sourceId) {
        if (old.status === 'succeeded' && old.expiresAt > now()) return { task: old, start: false };
        if ((old.status === 'running' && now() - old.startedAt < 45000) || old.requestId === requestId || input.restart !== true) return { task: old, start: false };
      }
      const day = new Date(now() + 8 * 3600000).toISOString().slice(0, 10), used = currentUser.cutoutDay === day ? currentUser.cutoutCalls || 0 : 0;
      if (used >= 30) return fail('CUTOUT_DAILY_LIMIT', '今日去背景次数已用完，请明天再试');
      const attempt = hash(randomUUID()), key = `wardrobe-cutouts/v1/${hash(familyId)}/${hash(id)}/${attempt}.png`;
      const task: CutoutTask = { sourceId, requestId, attempt, key, status: 'running', errorCode: '', error: '', startedAt: now(), expiresAt: now() + 6 * 3600000 };
      await unit.put('users', { ...currentUser, cutoutDay: day, cutoutCalls: used + 1, updatedAt: now() });
      await unit.put('garments', { ...current, cutouts: { ...current.cutouts, [mode]: task } });
      return { task, start: true };
    });
    const task = claimed.task;
    if (!claimed.start) return cached(task);
    let submitted = false, stored = false, committed = false, stage = 'source';
    try {
      const url = await sourceUrl(sourceId);
      await authorize(repo, userId, familyId); await garment(repo, familyId, id, sourceId);
      submitted = true;
      stage = 'process';
      const bytes = await provider.process(url, mode);
      await authorize(repo, userId, familyId); await garment(repo, familyId, id, sourceId);
      stage = 'cache';
      await provider.put(task.key, bytes); stored = true;
      stage = 'commit';
      await repo.transaction(async unit => {
        await authorize(unit, userId, familyId); const current = await garment(unit, familyId, id, sourceId);
        if (current.cutouts?.[mode]?.attempt !== task.attempt) return fail('CUTOUT_SOURCE_CHANGED', '抠图任务已变化，请重查');
        await unit.put('garments', { ...current, cutouts: { ...current.cutouts, [mode]: { ...task, status: 'succeeded' } } });
      });
      committed = true;
      await authorize(repo, userId, familyId); await garment(repo, familyId, id, sourceId);
      return { status: 'succeeded', requestId, cached: false, base64: bytes.toString('base64') };
    } catch (error) {
      // A completed paid result must survive transient delivery failures. Every
      // later read reauthorizes access; its private object expires by lifecycle.
      if (committed) throw error;
      if (stored) { try { await provider.remove(task.key); } catch { /* Private lifecycle expires this object. */ } }
      const uncertain = error instanceof CutoutError ? error.uncertain : submitted;
      const nativeCode = String((error as {code?: string})?.code || (error instanceof Error ? error.name : 'UNKNOWN')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
      const code = error instanceof CutoutError || error instanceof BusinessError ? error.code : `CUTOUT_${stage.toUpperCase()}_${nativeCode}`;
      const message = error instanceof CutoutError ? error.message : '去背景暂未完成，原图已保留';
      const failed: CutoutTask = { ...task, status: uncertain ? 'unknown' : 'failed', errorCode: code, error: message };
      await repo.transaction(async unit => { const current = await unit.get('garments', id); if (current?.cutouts?.[mode]?.attempt === task.attempt) await unit.put('garments', { ...current, cutouts: { ...current.cutouts, [mode]: failed } }); });
      if (error instanceof BusinessError) throw error;
      return view(failed);
    }
  };
}
