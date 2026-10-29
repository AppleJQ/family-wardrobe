import { reactive } from 'vue';
import { createUpdater, initialUpdateState } from './update-controller';
import type { AndroidRelease } from './app-update-policy';
// #ifdef APP-PLUS
import { verifyApk, canInstallPackages, openInstallSettings } from '../uni_modules/family-app-update';
// #endif

export const updateState = reactive(initialUpdateState());
export function supportsAppUpdates(): boolean {
  // #ifdef APP-PLUS
  return typeof plus !== 'undefined' && plus.os.name === 'Android';
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}
function remove(filePath: string): Promise<void> {
  // #ifdef APP-PLUS
  return new Promise(resolve => plus.io.resolveLocalFileSystemURL(filePath, entry => entry.remove(() => resolve(), () => resolve()), () => resolve()));
  // #endif
  // #ifndef APP-PLUS
  return Promise.resolve();
  // #endif
}
function download(release: AndroidRelease, progress: (value: number) => void) {
  // #ifdef APP-PLUS
  let rejectDownload: (error: Error) => void = () => {};
  const filename = `_doc/app-updates/update-${release.versionCode}-${Date.now()}.apk`;
  const task = plus.downloader.createDownload(release.url, { filename, timeout: 120, retry: 0 }, (result, status) => {
    if (status === 200 && result.downloadedSize === release.size) resolveDownload(result.filename || filename);
    else { void remove(result.filename || filename); rejectDownload(new Error('下载未完成，请检查网络后重试')); }
  });
  let resolveDownload: (path: string) => void = () => {};
  const result = new Promise<string>((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject; });
  task.addEventListener('statechanged', event => {
    const downloaded = event.downloadedSize || 0;
    if (downloaded > release.size) { task.abort(); void remove(filename); rejectDownload(new Error('安装包大小异常，请稍后重试')); }
    else progress(downloaded / release.size * 100);
  });
  task.start();
  return { result, cancel() { task.abort(); void remove(filename); rejectDownload(new Error('已取消下载')); } };
  // #endif
  // #ifndef APP-PLUS
  return { result: Promise.reject<string>(new Error('当前平台不支持 APK 更新')), cancel() {} };
  // #endif
}
const updater = createUpdater({
  get supported() { return supportsAppUpdates(); },
  currentVersion() {
    // #ifdef APP-PLUS
    return Number(plus.runtime.versionCode);
    // #endif
    // #ifndef APP-PLUS
    return 0;
    // #endif
  },
  async latest() {
    const url = import.meta.env.VITE_API_BASE_URL?.trim();
    if (!url || !/^https:\/\//i.test(url)) throw new Error('更新服务尚未配置');
    // Public release metadata does not require or transmit login credentials.
    const response = await uni.request({ url, method: 'POST', timeout: 10000,
      header: { 'Content-Type': 'application/json' },
      data: { group: 'updates', action: 'check', data: { platform: 'android', versionCode: Number(plus.runtime.versionCode) } } });
    const envelope = response.data as { ok?: boolean; data?: { release: unknown } };
    if (response.statusCode !== 200 || !envelope?.ok || !envelope.data) throw new Error('暂时无法检查更新，请稍后重试');
    return envelope.data;
  },
  async confirmDownload(release) {
    const result = await uni.showModal({ title: `发现新版本 ${release.versionName}`, confirmText: '下载更新', cancelText: '稍后',
      content: `${release.notes || '体验优化与问题修复'}\n\n安装包 ${(release.size / 1024 / 1024).toFixed(1)} MB，下载后由你确认安装。` });
    return !!result.confirm;
  },
  async confirmInstall() {
    const result = await uni.showModal({ title: '更新已下载', content: '安装包已校验，是否打开系统安装界面？', confirmText: '安装更新', cancelText: '稍后安装' });
    return !!result.confirm;
  },
  download, remove,
  verify(filePath, release) {
    // #ifdef APP-PLUS
    return new Promise<void>((resolve, reject) => verifyApk({ filePath: plus.io.convertLocalFileSystemURL(filePath),
      sha256: release.sha256, size: release.size, versionCode: release.versionCode,
      success: resolve, fail: error => reject(new Error(error.message)) }));
    // #endif
    // #ifndef APP-PLUS
    return Promise.reject(new Error('当前平台不支持 APK 更新'));
    // #endif
  },
  async install(filePath) {
    // #ifdef APP-PLUS
    if (!canInstallPackages()) {
      const result = await uni.showModal({ title: '允许安装更新', content: '需要你在系统页面允许“小猪猪的家”安装应用，完成后返回并点击“安装更新”。', confirmText: '前往设置', cancelText: '稍后' });
      if (result.confirm) openInstallSettings();
      throw new Error('完成系统授权后，请再次点击“安装更新”');
    }
    // APK installation has no InstallSuccessCallback on Android. Return after
    // dispatch so cancelling the system installer cannot lock future checks.
    plus.runtime.install(filePath, { force: false }, () => {}, () => {
      uni.showToast({ title: '未完成安装，可点击“安装更新”重试', icon: 'none' });
    });
    // #endif
  },
  notify: message => { uni.showToast({ title: message, icon: 'none' }); },
}, updateState);
let startupChecked = false;
export function checkStartupUpdate(): void {
  if (startupChecked || !supportsAppUpdates()) return;
  startupChecked = true;
  setTimeout(() => { void updater.check(); }, 1800);
}
export const checkAppUpdate = () => updater.check(true);
export const downloadAppUpdate = () => updater.download();
export const cancelAppUpdate = () => updater.cancel();
export const installAppUpdate = () => updater.install();
