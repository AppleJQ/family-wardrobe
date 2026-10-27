import { Garment } from './store';
import { CLOUD_ENV } from '../config/cloud';

export interface CloudMember { id: string; name: string; version: number }
export interface CloudFamily { id: string; name: string; role: 'owner' | 'member' }
export interface FamilyAccount { userId: string; role: 'owner' | 'member'; isSelf: boolean; label: string }
export interface FamilySnapshot { family: CloudFamily | null; members: CloudMember[]; accounts: FamilyAccount[] }
export type CloudGarment = Omit<Garment, 'memberId'> & { memberId: string };
export interface GarmentPage { items: CloudGarment[]; cursor: string }
export class CloudError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const serviceErrorMessages: Record<string, string> = {
  AI_BALANCE_LOW: '智能功能暂不可用，请稍后再试',
  AI_NOT_CONFIGURED: '智能功能暂不可用，请稍后再试',
  CUTOUT_NOT_CONFIGURED: '去背景暂不可用，请稍后再试',
  CUTOUT_CACHE_UNAVAILABLE: '预览暂不可读取，请稍后再试',
};

export async function call<T>(name: string, action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!wx.cloud) throw new CloudError('UNAVAILABLE', '当前微信版本不支持云开发，请更新微信');
  let response;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = wx.cloud.callFunction({ name, data: { ...data, action }, config: { env: CLOUD_ENV } });
    response = (action === 'home' || (name === 'bootstrapUser' && action === 'bootstrap')) ? await Promise.race([request, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CloudError('READ_TIMEOUT', '连接较慢，请点击重新加载再试')), 15000);
    })]) : await request;
  } catch (error) {
    if (error instanceof CloudError) throw error;
    throw new CloudError('NETWORK', '暂时无法连接云端，请检查网络后重试');
  } finally { if (timer !== undefined) clearTimeout(timer); }
  const result = response.result as { ok: boolean; data: T; error?: { code: string; message: string } } | undefined;
  if (!result?.ok) {
    const code = result?.error?.code || 'INTERNAL_ERROR';
    throw new CloudError(code, serviceErrorMessages[code] || result?.error?.message || '云端暂时不可用，请稍后重试');
  }
  return result.data;
}

async function readBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath, encoding: 'base64',
    success: result => resolve(result.data as string), fail: reject,
  }));
}
export async function prepareImage(path: string): Promise<{ path: string; base64: string }> {
  const original = await readBase64(path);
  const info = await wx.getImageInfo({ src: path });
  // Preserve small PNG transparency; server normalization flattens it onto white.
  if (['jpeg', 'jpg', 'png'].includes(info.type) && info.width * info.height <= 4000000 && original.length <= Math.ceil(512 * 1024 / 3) * 4) return { path, base64: original };
  let filePath = path;
  // Resize first; fixed image limit keeps the Event Function payload small on mobile networks.
  for (const quality of [75, 50, 30]) {
    filePath = await new Promise<string>((resolve, reject) => wx.compressImage({ src: path, quality, compressedWidth: 1600, compressedHeight: 1600,
      success: result => resolve(result.tempFilePath), fail: reject,
    }));
    const base64 = await readBase64(filePath);
    if (base64.length <= Math.ceil(512 * 1024 / 3) * 4) return { path: filePath, base64 };
  }
  throw new CloudError('IMAGE_TOO_LARGE', '图片压缩后仍超过 512 KB，请换一张较小的衣物照片');
}
