import { Input } from './model';
import { BusinessError } from './service';

interface AndroidRelease {
  platform: 'android'; packageName: string; versionCode: number; versionName: string;
  url: string; sha256: string; size: number; notes: string;
}
export function checkAndroidUpdate(input: Input, configuration: string): { release: AndroidRelease | null } {
  if (Object.keys(input).some(key => !['platform', 'versionCode'].includes(key)) || input.platform !== 'android'
    || !Number.isSafeInteger(input.versionCode) || Number(input.versionCode) < 1) {
    throw new BusinessError('INVALID_INPUT', '版本检查参数无效');
  }
  if (!configuration.trim()) return { release: null };
  try {
    if (Buffer.byteLength(configuration) > 4096) throw new Error('too large');
    const value = JSON.parse(configuration) as AndroidRelease;
    const url = new URL(value.url);
    if (value.platform !== 'android' || value.packageName !== 'com.applejq.familyhome'
      || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 || value.versionCode > 2100000000
      || typeof value.versionName !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(value.versionName)
      || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
      || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 256 * 1024 * 1024
      || typeof value.notes !== 'string' || value.notes.length > 1200
      || url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')
      || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || !/\.apk$/i.test(url.pathname)
      || value.url.length > 2048) throw new Error('invalid');
    // Return only the public release contract. Never return environment objects.
    return { release: { platform: 'android', packageName: value.packageName, versionCode: value.versionCode,
      versionName: value.versionName, url: value.url, sha256: value.sha256, size: value.size, notes: value.notes } };
  } catch { throw new BusinessError('UPDATE_NOT_CONFIGURED', '更新信息暂不可用，请稍后重试'); }
}
