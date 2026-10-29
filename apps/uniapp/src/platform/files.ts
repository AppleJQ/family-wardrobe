// #ifdef APP-PLUS || APP-HARMONY
import { exportDocument } from '@/uni_modules/family-file-export';
// #endif
/** Private photos use IndexedDB on Web and app-private files on phones. */
const browserUrls = new Map<string, string>();
let database: Promise<IDBDatabase> | undefined;
let initialized: Promise<void> | undefined;
function browserDb(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('family-home-private-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开照片草稿存储，请允许网站存储后重试'));
  });
}
export function initFiles(): Promise<void> {
  return initialized ??= (async () => {
    // #ifdef H5
    const db = await browserDb();
    await new Promise<void>((resolve, reject) => {
      const cursor = db.transaction('files').objectStore('files').openCursor();
      cursor.onsuccess = () => { const row = cursor.result; if (!row) { resolve(); return; } browserUrls.set(String(row.key), URL.createObjectURL(row.value as Blob)); row.continue(); };
      cursor.onerror = () => reject(cursor.error);
    });
    // #endif
  })();
}
export function displayPath(path: string | undefined): string { return path ? browserUrls.get(path) || path : ''; }
export function localPath(name: string): string {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('文件名无效');
  // #ifdef MP-WEIXIN
  return `${wx.env.USER_DATA_PATH}/${name}`;
  // #endif
  // #ifdef APP-HARMONY
  return `${(uni as typeof uni & {env:{USER_DATA_PATH:string}}).env.USER_DATA_PATH}/${name}`;
  // #endif
  // #ifdef APP-PLUS
  return `_doc/family-home/${name}`;
  // #endif
  // #ifdef H5
  return `idb://family-home/${name}`;
  // #endif
  throw new Error('当前平台暂不支持文件存储');
}
function mime(path: string) { return /\.png$/i.test(path) ? 'image/png' : /\.zip$/i.test(path) ? 'application/zip' : 'image/jpeg'; }
export async function readBase64(path: string): Promise<string> {
  if (path.startsWith('data:')) return path.slice(path.indexOf(',') + 1);
  // #ifdef H5
  await initFiles();
  const blob = await (await fetch(displayPath(path))).blob();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
  // #endif
  // #ifdef MP-WEIXIN
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath:path, encoding:'base64', success:r=>resolve(r.data as string), fail:reject }));
  // #endif
  // #ifdef APP-HARMONY
  return new Promise((resolve, reject) => uni.getFileSystemManager().readFile({ filePath:path, encoding:'base64', success:r=>resolve(r.data as string), fail:reject }));
  // #endif
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('无法读取所选照片，请重新选择后重试'));
    plus.io.resolveLocalFileSystemURL(path, entry => (entry as unknown as PlusIoFileEntry).file(file => {
      const reader = new plus.io.FileReader();
      reader.onloadend = event => {
        const target = event.target as unknown as { result?: string } | undefined;
        const result = target?.result ?? reader.result;
        if (reader.error || typeof result !== 'string' || !/^data:[^,]*;base64,/i.test(result)) { fail(); return; }
        const base64 = result.slice(result.indexOf(',') + 1);
        if (!base64) { fail(); return; }
        resolve(base64);
      };
      reader.onerror = fail; reader.onabort = fail;
      reader.readAsDataURL(file);
    }, fail), fail);
  });
  // #endif
  throw new Error('无法读取照片');
}
export async function readBytes(path: string): Promise<Uint8Array> { return new Uint8Array(uni.base64ToArrayBuffer(await readBase64(path))); }
export async function writeBase64(path: string, base64: string): Promise<void> {
  // #ifdef H5
  await initFiles();
  const bytes = uni.base64ToArrayBuffer(base64); const blob = new Blob([bytes], {type:mime(path)});
  const db = await browserDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('files','readwrite'); tx.objectStore('files').put(blob,path); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(new Error('照片存储空间不足，请先保存或清理草稿')); tx.onabort=()=>reject(tx.error); });
  const old = browserUrls.get(path); if (old) URL.revokeObjectURL(old); browserUrls.set(path,URL.createObjectURL(blob)); return;
  // #endif
  // #ifdef MP-WEIXIN
  await new Promise<void>((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:base64,encoding:'base64',success:()=>resolve(),fail:reject})); return;
  // #endif
  // #ifdef APP-HARMONY
  await new Promise<void>((resolve,reject)=>uni.getFileSystemManager().writeFile({filePath:path,data:base64,encoding:'base64',success:()=>resolve(),fail:reject})); return;
  // #endif
  // #ifdef APP-PLUS
  // Android native bridge writes binary; FileWriter.write would corrupt image/ZIP bytes as text.
  try {
    const File = plus.android.importClass('java.io.File') as any;
    const FileOutputStream = plus.android.importClass('java.io.FileOutputStream') as any;
    const Base64 = plus.android.importClass('android.util.Base64') as any;
    const file = new File(plus.io.convertLocalFileSystemURL(path));
    const parent = file.getParentFile();
    // Returned Java objects are handles; call their methods through the native bridge.
    if (!parent || (!plus.android.invoke(parent, 'exists') && !plus.android.invoke(parent, 'mkdirs') && !plus.android.invoke(parent, 'exists'))) {
      throw new Error('Private file directory is unavailable');
    }
    const output = new FileOutputStream(file);
    try { output.write(Base64.decode(base64,0)); } finally { output.close(); }
  } catch { throw new Error('无法保存本机文件，请检查手机存储空间后重试'); }
  return;
  // #endif
  throw new Error('无法保存文件');
}
export async function copyFile(source: string, target: string): Promise<void> { await writeBase64(target, await readBase64(source)); }
export async function removeFile(path: string): Promise<void> {
  if (!path) return;
  // #ifdef H5
  if (!path.startsWith('idb://family-home/')) return;
  const db = await browserDb();
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(path);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  const url=browserUrls.get(path);if(url)URL.revokeObjectURL(url);browserUrls.delete(path);return;
  // #endif
  // #ifdef MP-WEIXIN
  await new Promise<void>(resolve=>wx.getFileSystemManager().unlink({filePath:path,success:()=>resolve(),fail:()=>resolve()}));return;
  // #endif
  // #ifdef APP-HARMONY
  await new Promise<void>(resolve=>uni.getFileSystemManager().unlink({filePath:path,success:()=>resolve(),fail:()=>resolve()}));return;
  // #endif
  // #ifdef APP-PLUS
  await new Promise<void>(resolve=>plus.io.resolveLocalFileSystemURL(path,entry=>entry.remove(()=>resolve(),()=>resolve()),()=>resolve()));return;
  // #endif
}
export async function shareLocalFile(path: string, name: string): Promise<void> {
  // #ifdef H5
  const anchor=document.createElement('a');anchor.href=displayPath(path);anchor.download=name;anchor.click();return;
  // #endif
  // #ifdef MP-WEIXIN
  await wx.shareFileMessage({filePath:path,fileName:name});return;
  // #endif
  // #ifdef APP-PLUS || APP-HARMONY
  let sourcePath = path;
  // #ifdef APP-PLUS
  sourcePath = plus.io.convertLocalFileSystemURL(path);
  // #endif
  await new Promise<void>((resolve,reject)=>exportDocument({
    filePath:sourcePath,fileName:name,success:()=>resolve(),
    fail:result=>{const error=Object.assign(new Error(result.message),{code:result.code});if(result.code==='CANCELLED')error.name='AbortError';reject(error);},
  }));return;
  // #endif
}
