export interface AndroidRelease {
  platform: 'android'; packageName: string; versionCode: number; versionName: string;
  url: string; sha256: string; size: number; notes: string;
}
export function parseAndroidRelease(input: unknown): AndroidRelease {
  if (!input || typeof input !== 'object') throw new Error('更新信息无效，请稍后重试');
  const value = input as AndroidRelease;
  // Native JS engines may not expose the browser URL constructor.
  const match = typeof value.url === 'string'
    ? /^https:\/\/([a-z0-9.-]+)(?::443)?(\/[^\s#?]*\.apk)(?:\?[^\s#]*)?$/i.exec(value.url) : null;
  if (value.platform !== 'android' || value.packageName !== 'com.applejq.familyhome'
    || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 || value.versionCode > 2100000000
    || typeof value.versionName !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(value.versionName)
    || !match || !/\.[a-z]{2,}$/i.test(match[1]) || value.url.length > 2048
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 256 * 1024 * 1024
    || typeof value.notes !== 'string' || value.notes.length > 1200) throw new Error('更新信息无效，请稍后重试');
  return { platform: 'android', packageName: value.packageName, versionCode: value.versionCode,
    versionName: value.versionName, url: value.url, sha256: value.sha256, size: value.size, notes: value.notes };
}
