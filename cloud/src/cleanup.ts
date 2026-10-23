import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
export async function cleanup() {
  // A separate admin/timer-only function, denied to all client callers by resource rule.
  const repo = createRepository(), storage = createStorage(), now = Date.now();
  const expired = [
    ...await repo.list('garments', { status: 'expired' }, { limit: 50 }),
    ...await repo.list('garments', { status: 'uploading' }, { expiresBefore: now, limit: 50 }),
  ];
  let cleaned = 0;
  for (const item of expired) {
    const locked = await repo.transaction(async unit => {
      const current = await unit.get('garments', item._id);
      if (!current || !['uploading', 'expired'].includes(current.status) || current.uploadExpiresAt > now) return null;
      await unit.put('garments', { ...current, status: 'expired', updatedAt: now }); return current;
    });
    if (!locked) continue;
    // File IDs for server uploads use the environment's verified bucket and path.
    const fileId = locked.imageFileId || `cloud://wardrobe-dev-cloude-d5bv128b6099.7761-wardrobe-dev-cloude-d5bv128b6099-1306311302/${locked.cloudPath}`;
    try {
      await storage.remove(fileId);
      await repo.transaction(async unit => {
        const current = await unit.get('garments', item._id);
        if (current?.status === 'expired') await unit.put('garments', { ...current, status: 'discarded', updatedAt: Date.now() });
      });
      cleaned++;
    }
    catch {
      // Return to retryable state; never lose orphan compensation on a storage outage.
      await repo.transaction(async unit => {
        const current = await unit.get('garments', item._id);
        if (current?.status === 'expired') await unit.put('garments', { ...current, status: 'uploading', updatedAt: Date.now() });
      });
    }
  }
  return { cleaned };
}
