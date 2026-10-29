import {localPath,writeBase64} from '../platform/files';
import { call } from './cloud';

export type CutoutMode = 'goods' | 'common';
export interface CutoutResult {
  status: 'none' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'expired';
  requestId?: string; base64?: string; error?: string; errorCode?: string; cached?: boolean;
}
function displayResult(result: CutoutResult): CutoutResult {
  if (result.status === 'expired') return { ...result, error: '预览已过期，可重新生成' };
  if (result.errorCode === 'CUTOUT_OPAQUE') return { ...result, error: '这张照片未分离出背景，可更换照片后重试' };
  if (result.errorCode === 'CUTOUT_REJECTED' || result.errorCode === 'CUTOUT_NOT_CONFIGURED' || result.errorCode?.startsWith('CUTOUT_PROVIDER_')) {
    return { ...result, error: '去背景暂不可用，请稍后再试' };
  }
  return result;
}
export const getCutout = async (garmentId: string, mode: CutoutMode) => displayResult(await call<CutoutResult>('cutout', 'get', { garmentId, mode }));
export const processCutout = async (garmentId: string, mode: CutoutMode, requestId: string, restart = false) => displayResult(await call<CutoutResult>('cutout', 'process', { garmentId, mode, requestId, restart }));
export const applyCutout = (garmentId: string, requestId: string, version: number) => call<{ version: number }>('cutout', 'apply', { garmentId, requestId, version, mode: 'common' });
export const getPhotoCutout = async (requestId: string) => displayResult(await call<CutoutResult>('cutout', 'getPhoto', { requestId }));
export const processPhotoCutout = async (requestId: string, base64: string) => displayResult(await call<CutoutResult>('cutout', 'processPhoto', { requestId, base64 }));
export async function saveCutoutPreview(base64: string): Promise<string> {
  if (!base64.startsWith('iVBORw0KGgo') || base64.length > Math.ceil(2 * 1024 * 1024 / 3) * 4) throw new Error('抠图结果无法读取，请重查');
  const path = localPath(`cutout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  await writeBase64(path,base64);
  return path;
}
