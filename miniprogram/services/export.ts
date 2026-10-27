import { createZip, csvCell, utf8 } from './archive';
import { call, CloudGarment, FamilySnapshot } from './cloud';

export interface ExportOptions {
  memberId?: string;
  onProgress?: (count: number) => void;
  isCancelled?: () => boolean;
}
interface ExportPage {
  items: Array<CloudGarment & { memberName?: string }>; cursor: string; exportedAt: string | number;
  manifest?: { locations?: unknown[] };
}
function readBytes(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath,
    success: response => resolve(response.data as ArrayBuffer), fail: reject,
  }));
}
export async function exportWardrobe(options: ExportOptions = {}): Promise<{ path: string; count: number; bytes: number }> {
  const scope = await call<FamilySnapshot>('families', 'get');
  if (!scope.family) throw new Error('请先加入家庭');
  const familyId = scope.family.id;
  const fs = wx.getFileSystemManager();
  const path = `${wx.env.USER_DATA_PATH}/wardrobe-${Date.now()}.zip`;
  const records: Array<Record<string, unknown>> = [], seen = new Set<string>();
  const outfits: Array<Record<string, unknown>> = [];
  let locations: unknown[] = [];
  let bytes = 0;
  const active = () => { if (options.isCancelled?.()) throw new Error('已取消导出'); };
  const sameFamily = async () => {
    active();
    if ((await call<FamilySnapshot>('families', 'get')).family?.id !== familyId) throw new Error('家庭已变化，导出已停止');
    active();
  };
  fs.writeFileSync(path, new ArrayBuffer(0));
  const zip = createZip(chunk => {
    active(); bytes += chunk.length;
    if (bytes > 80 * 1024 * 1024) throw new Error('导出超过80MB，请按成员分别导出');
    fs.appendFileSync(path, chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
  });
  try {
    let cursor = '';
    do {
      active();
      const page = await call<ExportPage>('wardrobe', 'exportPage', { memberId: options.memberId || undefined, limit: 20, cursor });
      if (page.manifest?.locations) locations = page.manifest.locations;
      await sameFamily();
      for (const row of page.items) {
        active();
        if (seen.has(row.id)) throw new Error('导出分页出现重复，请重新导出');
        const current = await call<CloudGarment>('garments', 'get', { garmentId: row.id });
        if (current.version !== row.version) throw new Error('衣物在导出时被修改，请重新导出');
        if (!current.image) throw new Error('部分衣物照片无法读取，请稍后重新导出');
        const downloaded = await new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>((resolve, reject) => {
          wx.downloadFile({ url: current.image, success: resolve, fail: reject });
        });
        if (downloaded.statusCode !== 200) throw new Error('照片下载失败，请稍后重新导出');
        let image: ArrayBuffer;
        try { image = await readBytes(downloaded.tempFilePath); }
        finally { try { fs.unlinkSync(downloaded.tempFilePath); } catch { /* System temporary files can already be gone. */ } }
        active();
        const photo = `photos/${row.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
        zip.add(photo, new Uint8Array(image));
        const { image: _image, ...metadata } = row;
        records.push({ ...metadata, memberName: scope.members.find(member => member.id === row.memberId)?.name || '', photo }); seen.add(row.id);
        options.onProgress?.(records.length);
      }
      cursor = page.cursor;
    } while (cursor);
    cursor = '';
    do {
      active();
      const page = await call<{items: Array<Record<string, unknown>>; cursor: string}>('wardrobe', 'outfits.list', {memberId: options.memberId || undefined, limit: 20, cursor});
      for (const outfit of page.items) {
        const garments = Array.isArray(outfit.garments) ? outfit.garments.map(raw => {
          const {image: _image, ...snapshot} = raw as Record<string, unknown>; return snapshot;
        }) : [];
        outfits.push({...outfit, garments});
      }
      cursor = page.cursor;
    } while (cursor);
    await sameFamily();
    zip.add('manifest.json', utf8(JSON.stringify({ version: '0.2.0', exportedAt: new Date().toISOString(), familyName: scope.family.name, members: scope.members, locations, garments: records }, null, 2)));
    zip.add('outfits.json', utf8(JSON.stringify(outfits, null, 2)));
    const fields = ['id', 'memberName', 'name', 'category', 'color', 'season', 'location', 'status', 'notes', 'photo'];
    const csv = '\ufeff' + [fields.map(csvCell).join(','), ...records.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\r\n');
    zip.add('衣物清单.csv', utf8(csv)); zip.finish();
    return { path, count: records.length, bytes };
  } catch (error) {
    try { fs.unlinkSync(path); } catch { /* A failed write may never create a file. */ }
    throw error;
  }
}
