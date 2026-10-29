import cloud from 'wx-server-sdk';
import { Collection, Entities, ImageStorage, ListOptions, Repository, Unit } from './model';
import { RequestTimings } from './performance';

// The wx SDK declarations predate transaction typings. Keep the native boundary here.
interface NativeDocument {
  get(): Promise<{ data: Record<string, unknown> | null }>;
  set(input: { data: Record<string, unknown> }): Promise<unknown>;
}
interface NativeQuery {
  orderBy(field: string, direction: string): NativeQuery;
  limit(limit: number): NativeQuery;
  get(): Promise<{ data: unknown[] }>;
}
interface NativeUnit { collection(name: string): { doc(id: string): NativeDocument; where(filter: unknown): NativeQuery } }
function unit(native: NativeUnit, serialize = false): Unit {
  let pending: Promise<unknown> = Promise.resolve();
  function run<T>(work: () => Promise<T>): Promise<T> {
    if (!serialize) return work();
    const result = pending.then(work);
    pending = result.catch(() => {});
    return result;
  }
  return {
    async get<K extends Collection>(collection: K, id: string) {
      try {
        const { data } = await run(() => native.collection(collection).doc(id).get());
        return (data || null) as unknown as Entities[K] | null;
      } catch (error) {
        // A missing document is expected; collection/network/permission failures must surface.
        if (error instanceof Error && /document.*does not exist/i.test(error.message)) return null;
        throw error;
      }
    },
    async put<K extends Collection>(collection: K, document: Entities[K]) {
      const { _id, ...data } = document;
      await run(() => native.collection(collection).doc(_id).set({ data }));
    },
  };
}
export function createRepository(): Repository {
  const db = cloud.database();
  const native = db as unknown as NativeUnit;
  return {
    ...unit(native),
    transaction: <T>(work: (u: Unit) => Promise<T>): Promise<T> => db.runTransaction((tx: NativeUnit) => work(unit(tx, true))),
    async list<K extends Collection>(collection: K, filter: Partial<Entities[K]>, options: ListOptions = {}) {
      const and: unknown[] = [filter];
      if (options.before) and.push(db.command.or([
        { createdAt: db.command.lt(options.before.createdAt) },
        { createdAt: options.before.createdAt, _id: db.command.lt(options.before.id) },
      ]));
      if (options.expiresBefore !== undefined) and.push({ uploadExpiresAt: db.command.lte(options.expiresBefore) });
      if (options.deletedBefore !== undefined) and.push({ deletedAt: db.command.lte(options.deletedBefore) });
      if (options.excludeRetired) and.push({ wearStatus: db.command.neq('retired') });
      if (options.search) {
        const regexp = db.RegExp({ regexp: options.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
        and.push(db.command.or([{ name: regexp }, { notes: regexp }]));
      }
      const where = and.length > 1 ? db.command.and(and) : filter;
      const { data } = await native.collection(collection).where(where).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(options.limit || 100).get();
      return data as Entities[K][];
    },
  };
}

export function createStorage(timings?: RequestTimings): ImageStorage {
  const time = <T>(name: string, work: () => Promise<T>) => timings ? timings.time(name, work) : work();
  return {
    async download(fileID) {
      const result = await time('storage.download', () => cloud.downloadFile({ fileID }));
      return result.fileContent;
    },
    async upload(path, base64) {
      const fileContent = await time('image.normalize', async () => (await import('./image')).normalizeImage(base64));
      const result = await time('storage.upload', () => cloud.uploadFile({ cloudPath: path, fileContent }));
      return result.fileID;
    },
    async uploadPng(path, bytes) {
      if (bytes.length < 24 || bytes.length > 512 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('INVALID_CUTOUT_IMAGE');
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width * height > 4000000) throw new Error('INVALID_CUTOUT_SIZE');
      const fileContent = await time('image.png', async () => {
        const { PNG } = await import('pngjs');
        return PNG.sync.write(PNG.sync.read(bytes, { checkCRC: true }));
      });
      const result = await time('storage.upload', () => cloud.uploadFile({ cloudPath: path, fileContent }));
      return result.fileID;
    },
    async remove(fileId) {
      const result = await time('storage.remove', async () => cloud.deleteFile({ fileList: [fileId] }));
      const row = result?.fileList[0];
      if (row && row.status !== 0 && !/not.?exist/i.test(row.errMsg)) throw new Error('STORAGE_DELETE_FAILED');
    },
    async urls(fileIds) {
      if (!fileIds.length) return {};
      const result = await time('storage.urls', async () => cloud.getTempFileURL({ fileList: fileIds.map(fileID => ({ fileID, maxAge: 300 })) }));
      if (!result) throw new Error('STORAGE_URL_FAILED');
      return Object.fromEntries(result.fileList.filter(row => row.status === 0).map(row => [row.fileID, row.tempFileURL]));
    },
  };
}
