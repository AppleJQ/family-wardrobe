import { parseAndroidRelease, type AndroidRelease } from './app-update-policy';

export interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error';
  progress: number; error: string; release: AndroidRelease | null;
}
interface Dependencies {
  supported: boolean; currentVersion: () => number; latest: () => Promise<{ release: unknown }>;
  confirmDownload: (release: AndroidRelease) => Promise<boolean>; confirmInstall: () => Promise<boolean>;
  download: (release: AndroidRelease, progress: (value: number) => void) => { result: Promise<string>; cancel: () => void };
  verify: (filePath: string, release: AndroidRelease) => Promise<void>; install: (filePath: string) => Promise<void>;
  remove: (filePath: string) => Promise<void>; notify: (message: string) => void;
}
export const initialUpdateState = (): UpdateState => ({ phase: 'idle', progress: 0, error: '', release: null });
export function createUpdater(deps: Dependencies, state: UpdateState) {
  let checking = false, transferring = false, installing = false, generation = 0, filePath = '';
  let transfer: ReturnType<Dependencies['download']> | undefined;
  const remove = async (file: string) => { if (file) await deps.remove(file).catch(() => {}); };
  const current = () => {
    const version = deps.currentVersion();
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('无法读取应用版本，请安装完整 APK 后重试');
    return version;
  };
  async function install() {
    if (!deps.supported || installing || state.phase !== 'ready' || !state.release || !filePath) return;
    installing = true;
    try {
      if (current() >= state.release.versionCode) { await remove(filePath); filePath = ''; state.phase = 'idle'; return; }
      state.phase = 'verifying'; state.error = '';
      try { await deps.verify(filePath, state.release); }
      catch (error) { await remove(filePath); filePath = ''; throw error; }
      state.phase = 'installing';
      await deps.install(filePath);
      // Opening/returning from the system installer is not proof of an upgrade.
      state.phase = 'ready';
    } catch (error) {
      state.phase = filePath ? 'ready' : 'error'; state.error = error instanceof Error ? error.message : '无法安装，请重试';
    } finally { installing = false; }
  }
  async function download() {
    if (!deps.supported || transferring || installing || !state.release || !['available', 'error'].includes(state.phase)) return;
    transferring = true;
    const release = state.release, operation = ++generation;
    state.phase = 'downloading'; state.progress = 0; state.error = '';
    let downloaded = '';
    try {
      if (current() >= release.versionCode) { state.phase = 'idle'; return; }
      await remove(filePath); filePath = '';
      transfer = deps.download(release, value => { if (operation === generation) state.progress = Math.max(0, Math.min(100, Math.floor(value))); });
      downloaded = await transfer.result;
      if (operation !== generation) { await remove(downloaded); return; }
      state.phase = 'verifying';
      await deps.verify(downloaded, release);
      if (operation !== generation) { await remove(downloaded); return; }
      filePath = downloaded; state.phase = 'ready'; state.progress = 100;
      if (await deps.confirmInstall() && operation === generation) await install();
    } catch (error) {
      await remove(downloaded);
      if (operation === generation) { state.phase = 'error'; state.error = error instanceof Error ? error.message : '下载失败，请重试'; }
    } finally { transfer = undefined; transferring = false; }
  }
  async function check(manual = false) {
    if (!deps.supported || checking || transferring || installing) return;
    if (state.phase === 'ready' && !manual) return;
    const cachedRelease = state.release;
    checking = true; state.phase = 'checking'; state.error = ''; state.release = null;
    try {
      const version = current(), response = await deps.latest();
      if (!response || !Object.prototype.hasOwnProperty.call(response, 'release')) throw new Error('暂时无法检查更新');
      const release = response.release === null ? null : parseAndroidRelease(response.release);
      state.release = release;
      if (!release || release.versionCode <= version) {
        await remove(filePath); filePath = '';
        state.phase = 'idle';
        if (manual) deps.notify(release ? '当前已是最新版本' : '暂无可用更新');
        return;
      }
      if (filePath && cachedRelease?.sha256 === release.sha256 && cachedRelease.versionCode === release.versionCode) {
        state.phase = 'ready';
        if (manual) deps.notify('更新已下载，请点击“安装更新”');
        return;
      }
      await remove(filePath); filePath = '';
      state.phase = 'available';
      if (await deps.confirmDownload(release)) await download();
    } catch (error) {
      if (filePath && cachedRelease) { state.release = cachedRelease; state.phase = 'ready'; }
      else state.phase = 'error';
      state.error = error instanceof Error ? error.message : '检查更新失败，请重试';
      if (manual) deps.notify(state.error);
    } finally { checking = false; }
  }
  function cancel() {
    if (state.phase !== 'downloading') return;
    generation++; state.phase = 'available'; state.error = ''; state.progress = 0;
    transfer?.cancel();
  }
  return { check, download, cancel, install };
}
