import { call, prepareImage } from './cloud';
import { getSession } from './session';
export type { NotebookEntry, NotebookItem, NotebookImage, NotebookHome, NotebookDraft, NotebookAiResult, NotebookWrite, NotebookKind } from '../../../../cloud/src/notebook-model';
import type { NotebookEntry, NotebookHome, NotebookImage, NotebookAiResult, NotebookWrite } from '../../../../cloud/src/notebook-model';
function scoped<T>(action: string, data: Record<string,unknown> = {}): Promise<T> {
  return call<T>('notebook', action, {expectedFamilyId:notebook.familyId, ...data});
}
export const notebook = {
  familyId: '',
  home: () => call<NotebookHome>('notebook', 'home'),
  page: (status: 'active'|'deleted', cursor = '', expectedFamilyId?: string) => scoped<{items: NotebookEntry[]; cursor: string}>('list', { status, cursor, limit: 100, expectedFamilyId:expectedFamilyId||notebook.familyId }),
  get: (entryId: string) => scoped<NotebookEntry>('get', { entryId }),
  create: (entry: NotebookWrite, requestId: string) => scoped<NotebookEntry>('create', { entry, requestId }),
  update: (entryId: string, version: number, patch: NotebookWrite) => scoped<NotebookEntry>('update', { entryId, version, patch }),
  mutate: (action: 'delete'|'restore'|'purge', entry: NotebookEntry) => scoped<NotebookEntry>(action, { entryId: entry.id, version: entry.version }),
  toggle: (entry: NotebookEntry, itemId: string, done: boolean) => scoped<NotebookEntry>('toggle', { entryId: entry.id, version: entry.version, itemId, done }),
  copy: (entry: NotebookEntry, requestId: string) => scoped<NotebookEntry>('copy', { entryId: entry.id, version: entry.version, requestId }),
  linkProfile: (memberId: string, version: number) => scoped<{memberId: string}>('profile.link', {memberId, version}),
  upload: async (path: string, requestId: string): Promise<NotebookImage> => {
    const familyId=notebook.familyId, owner=getSession()?.userId||'';
    const photo = await prepareImage(path, { maxBytes: 60 * 1024 });
    if(notebook.familyId!==familyId||(getSession()?.userId||'')!==owner)throw new Error('账号或家庭已变化，请重新选择图片');
    return scoped<NotebookImage>('images.upload', {requestId, photoBase64: photo.base64, expectedFamilyId:familyId});
  },
  ai: (action: 'parse'|'query', text: string, requestId: string) => scoped<NotebookAiResult>(`ai.${action}`, {text, requestId}),
  aiGet: (requestId: string) => scoped<NotebookAiResult>('ai.get', {requestId}),
  subscribe: (entry: NotebookEntry) => scoped<{enabled:boolean;message:string}>('reminders.subscribe', {entryId:entry.id,version:entry.version}),
};
