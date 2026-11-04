import { computed, ref } from 'vue';
import { onLoad, onShow, onHide, onUnload, onBackPress } from '@dcloudio/uni-app';
import { notebook, type NotebookEntry, type NotebookHome, type NotebookWrite, type NotebookKind, type NotebookAiResult, type NotebookImage, type NotebookDraft } from './notebook';
import { getSession, requireLogin } from './session';
import { isWechat } from '../platform/runtime';
import { call } from './cloud';
import { beijingToday, createRequestScope, findConflicts, requestId, copyNotebookData } from './notebook-state';
import { androidReminderState, canEnableNotebookReminder, enableAndroidReminders, disableAndroidReminders, supportsAndroidReminders } from './android-reminders';

export interface NotebookEditor {
  id: string; version: number; requestId: string; kind: NotebookKind; title: string; body: string;
  noteMemberId: string; category: string; date: string; startTime: string; endTime: string; participantMemberIds?: string[]; participantUserIds: string[];
  place: string; listId: string; noteId: string; reminderMinutes: number | null;
  eventState: NotebookEntry['eventState']; pinned: boolean; items: NotebookEntry['items']; images: NotebookImage[];
}
const confirm = async (content: string, title = '请确认', confirmText = '确定'): Promise<boolean> => {
  const result = await uni.showModal({ title, content, confirmText, cancelText: '取消' }); return result.confirm;
};
export function useNotebook() {
  const snapshot = ref<NotebookHome | null>(null), entries = ref<NotebookEntry[]>([]), trash = ref<NotebookEntry[]>([]);
  const tab = ref<NotebookKind>('event'), selectedDate = ref(beijingToday()), weekend = ref(false), personFilter = ref('');
  const noteFilter = ref(''), query = ref(''), loading = ref(false), busy = ref(false), error = ref(''), initialized = ref(false);
  const editor = ref<NotebookEditor | null>(null), selected = ref<NotebookEntry | null>(null), showTrash = ref(false), showAi = ref(false);
  const aiText = ref(''), aiMode = ref<'parse'|'query'>('parse'), aiResult = ref<NotebookAiResult | null>(null), aiRequest = ref('');
  const editorReturn = ref<NotebookEditor | null>(null), operationKeys = new Map<string,string>();
  let disposed = false, initialShow = true, initialEntryId='';
  const account = () => getSession()?.userId || (isWechat ? 'wechat' : '');
  const scope = createRequestScope(account);
  let ownerAccount=account();
  const active = computed(() => entries.value.filter(entry => entry.status === 'active'));
  const lists = computed(() => active.value.filter(entry => entry.kind === 'list'));
  const notes = computed(() => active.value.filter(entry => entry.kind === 'note'));
  const accounts = computed(() => snapshot.value?.accounts || []), members = computed(() => snapshot.value?.members || []);
  const name = (id: string) => accounts.value.find(a => a.userId === id)?.name || '家庭成员';
  const memberName = (id: string) => members.value.find(m => m.id === id)?.name || '';
  const errorText = (err: unknown) => err instanceof Error ? err.message : '操作未成功，请稍后重试';
  function report(err: unknown) { error.value = errorText(err); uni.showToast({title:error.value, icon:'none', duration:2600}); }
  function clearShared() { snapshot.value=null; notebook.familyId='';entries.value=[]; trash.value=[]; selected.value=null; editor.value=null; showTrash.value=false; showAi.value=false; aiResult.value=null; aiText.value='';aiRequest.value='';personFilter.value='';noteFilter.value='';query.value='';editorReturn.value=null; operationKeys.clear(); }
  function upsert(entry: NotebookEntry) {
    entries.value = [entry, ...entries.value.filter(row => row.id !== entry.id)];
    trash.value = entry.status === 'deleted' ? [entry, ...trash.value.filter(row => row.id !== entry.id)] : trash.value.filter(row => row.id !== entry.id);
    if(selected.value?.id===entry.id)selected.value=entry;
  }
  async function refresh() {
    if(disposed || !requireLogin('/pages/notebook/index'))return;
    if(ownerAccount!==account()){clearShared();ownerAccount=account();}
    const token=scope.begin(), previousFamily=snapshot.value?.familyId;
    loading.value=true; error.value='';
    try {
      const home=await notebook.home();
      if(!scope.active(token)||disposed)return;
      if(previousFamily && previousFamily!==home.familyId)clearShared();
      notebook.familyId=home.familyId;
      let items=home.entries, cursor=home.cursor;
      while(cursor) { const page=await notebook.page('active',cursor,home.familyId); items=[...items,...page.items]; cursor=page.cursor; if(!scope.active(token)||disposed)return; }
      if(!scope.active(token)||disposed)return;
      snapshot.value=home; entries.value=items; initialized.value=true;
      if(selected.value)selected.value=items.find(row=>row.id===selected.value?.id)||null;
      if(initialEntryId){const id=initialEntryId;initialEntryId='';const entry=items.find(row=>row.id===id);if(entry){tab.value=entry.kind;if(entry.kind==='event'){selectedDate.value=entry.date;weekend.value=false;}selected.value=entry;}else error.value='消息对应的内容已删除或当前账号无权访问';}
    } catch(err) { if(scope.active(token)&&!disposed){ if(['NO_FAMILY','UNAUTHENTICATED','FORBIDDEN'].includes((err as {code?:string}).code||''))clearShared();report(err); } }
    finally { if(scope.active(token)&&!disposed)loading.value=false; }
  }
  async function mutate(work: () => Promise<unknown>) {
    if(busy.value)return;
    if(ownerAccount!==account()){clearShared();report(new Error('账号已变化，请重新打开家庭记事'));return;}
    const owner=account(), family=snapshot.value?.familyId;
    busy.value=true;error.value='';
    try { await work(); } catch(err) { if(account()===owner&&snapshot.value?.familyId===family&&!disposed){if(['NO_FAMILY','UNAUTHENTICATED','FORBIDDEN'].includes((err as {code?:string}).code||''))clearShared();report(err);} }
    finally { if(!disposed)busy.value=false; }
  }
  function usable(owner: string, family?: string) { return !disposed&&account()===owner&&snapshot.value?.familyId===family; }
  function startEditor(kind: NotebookKind, entry?: NotebookEntry, draft?: NotebookDraft) {
    if(busy.value || !snapshot.value)return;
    const self=members.value.find(member=>member.linkedUserId===snapshot.value?.userId);
    const initial: NotebookEditor={id:'',version:0,requestId:requestId(),kind,title:'',body:'',category:'其他',noteMemberId:noteFilter.value||self?.id||members.value[0]?.id||'',
      date:selectedDate.value,startTime:kind==='event'?'14:00':'',endTime:'',participantMemberIds:self?[self.id]:[],participantUserIds:self?[snapshot.value.userId]:[],place:'',listId:'',noteId:'',reminderMinutes:30,eventState:'planned',pinned:false,items:[],images:[]};
    if(entry)Object.assign(initial,copyNotebookData(entry),{requestId:requestId()});
    if(draft)Object.assign(initial,copyNotebookData(draft));
    if(kind==='event'&&(entry||draft)){
      const ids=(entry||draft)!.participantMemberIds;
      initial.participantMemberIds=ids===undefined?undefined:[...ids];
    }
    editor.value=initial;selected.value=null;showAi.value=false;
  }
  async function openEntry(entry: NotebookEntry) {
    if(busy.value)return;
    await mutate(async()=>{ const owner=account(), family=snapshot.value?.familyId;const fresh=await notebook.get(entry.id);if(!usable(owner,family))return;upsert(fresh);selected.value=fresh; });
  }
  function writeOf(value: NotebookEditor): NotebookWrite {
    return {kind:value.kind,title:value.title.trim(),body:value.body,category:value.kind==='list'?value.category:'',noteMemberId:value.kind==='note'?value.noteMemberId:'',
      date:value.kind==='event'?value.date:'',startTime:value.kind==='event'?value.startTime:'',endTime:value.kind==='event'?value.endTime:'',
      participantUserIds:value.kind==='event'?[...value.participantUserIds]:[],place:value.place,listId:value.listId,noteId:value.noteId,
      ...(value.kind==='event'&&value.participantMemberIds!==undefined?{participantMemberIds:[...value.participantMemberIds]}:{}),
      reminderMinutes:value.kind==='event'&&value.startTime?value.reminderMinutes:null,eventState:value.eventState,pinned:value.pinned,
      items:value.items,imageIds:value.images.map(image=>image.id)};
  }
  async function saveEditor() {
    const value=editor.value;if(!value||busy.value)return;
    if(!value.title.trim()){report(new Error('请填写标题'));return;}
    if(value.kind==='event'&&!(value.participantMemberIds??value.participantUserIds).length){report(new Error('请选择参与人'));return;}
    if(value.kind==='note'&&!value.noteMemberId){report(new Error('请选择笔记关于谁'));return;}
    if(value.kind==='event'&&value.endTime&&(!value.startTime||value.endTime<=value.startTime)){report(new Error('结束时间需要晚于开始时间'));return;}
    const conflicts=value.kind==='event'?findConflicts(value,active.value):[];
    if(conflicts.length&&!await confirm(`与“${conflicts.map(item=>item.title).join('、')}”时间重叠，仍然保存吗？`,'时间有重叠','仍保存'))return;
    await mutate(async()=>{
      const owner=account(), family=snapshot.value?.familyId;
      const result=value.id?await notebook.update(value.id,value.version,writeOf(value)):await notebook.create(writeOf(value),value.requestId);
      if(!usable(owner,family))return;
      upsert(result);editor.value=null;
      if(editorReturn.value){const parent=editorReturn.value;parent.listId=result.id;editorReturn.value=null;editor.value=parent;return;}
      tab.value=result.kind;if(result.kind==='event'){selectedDate.value=result.date;weekend.value=false;personFilter.value='';}if(result.kind==='note')noteFilter.value=result.noteMemberId;
      selected.value=result;uni.showToast({title:'已保存',icon:'success'});
    });
  }
  function createLinkedList() { if(!editor.value)return;editorReturn.value=copyNotebookData(editor.value);startEditor('list'); }
  async function closeEditor() {
    if(busy.value)return;
    if(editor.value&&(editor.value.title||editor.value.body||editor.value.items.length)&&!await confirm('尚未保存的内容将放弃。','离开编辑','放弃'))return;
    editor.value=editorReturn.value;editorReturn.value=null;
  }
  async function toggleItem(entry: NotebookEntry,itemId: string,done: boolean) {
    await mutate(async()=>{const owner=account(), family=snapshot.value?.familyId;const result=await notebook.toggle(entry,itemId,done);if(usable(owner,family))upsert(result);});
  }
  async function copyList(entry: NotebookEntry) {
    const key=`copy/${entry.id}/${entry.version}`;if(!operationKeys.has(key))operationKeys.set(key,requestId());
    await mutate(async()=>{const owner=account(), family=snapshot.value?.familyId;const result=await notebook.copy(entry,operationKeys.get(key)!);if(!usable(owner,family))return;operationKeys.delete(key);upsert(result);selected.value=result;tab.value='list';});
  }
  async function remove(entry: NotebookEntry) {
    const linked=active.value.filter(row=>row.listId===entry.id||row.noteId===entry.id).length;
    if(!await confirm(`“${entry.title}”将移入回收站，30天内可以恢复。${linked?`关联的${linked}个日程会保留。`:''}`,'移入回收站','移入'))return;
    await mutate(async()=>{const owner=account(), family=snapshot.value?.familyId;const result=await notebook.mutate('delete',entry);if(!usable(owner,family))return;upsert(result);selected.value=null;uni.showToast({title:'已移入回收站',icon:'none'});});
  }
  async function loadTrash() {
    if(busy.value)return;
    await mutate(async()=>{const owner=account(),family=snapshot.value?.familyId;let rows:NotebookEntry[]=[],cursor='';do{if(!usable(owner,family))return;const page=await notebook.page('deleted',cursor,family);if(!usable(owner,family))return;rows=[...rows,...page.items];cursor=page.cursor;}while(cursor);if(!usable(owner,family))return;trash.value=rows;showTrash.value=true;selected.value=null;});
  }
  async function restore(entry: NotebookEntry) {await mutate(async()=>{const owner=account(),family=snapshot.value?.familyId;const result=await notebook.mutate('restore',entry);if(usable(owner,family))upsert(result);});}
  async function purge(entry: NotebookEntry) {
    if(!await confirm(`“${entry.title}”及其内容将无法恢复。关联日程会保留。`,'彻底删除','删除'))return;
    await mutate(async()=>{const owner=account(),family=snapshot.value?.familyId;await notebook.mutate('purge',entry);if(!usable(owner,family))return;trash.value=trash.value.filter(row=>row.id!==entry.id);entries.value=entries.value.filter(row=>row.id!==entry.id);await refresh();});
  }
  async function chooseImages() {
    const target=editor.value;if(!target||busy.value)return;
    const owner=account(),family=snapshot.value?.familyId;
    try {
      const result=await uni.chooseImage({count:Math.max(1,6-target.images.length),sizeType:['compressed'],sourceType:['album','camera']});
      if(!usable(owner,family)||editor.value!==target)return;
      const paths=typeof result.tempFilePaths==='string'?[result.tempFilePaths]:result.tempFilePaths;
      await mutate(async()=>{for(const path of paths){if(!usable(owner,family)||editor.value!==target)return;const image=await notebook.upload(path,requestId());if(usable(owner,family)&&editor.value===target)target.images=[...target.images,image];}});
    }catch(err){if(!/cancel/i.test(String((err as {errMsg?:string}).errMsg||'')))report(err);}
  }
  async function linkSelf() {
    const choices=members.value.filter(member=>!member.linkedUserId||member.linkedUserId===snapshot.value?.userId);
    if(!choices.length){report(new Error('没有可关联的成员档案，请先到我的家庭添加'));return;}
    const result=await uni.showActionSheet({itemList:choices.map(member=>member.name)}).catch(()=>null);if(!result)return;
    const member=choices[result.tapIndex];await mutate(async()=>{await notebook.linkProfile(member.id,member.version);await refresh();});
  }
  async function runAi(recheck=false) {
    if(!aiText.value.trim()&&!recheck)return;
    if(!aiRequest.value)aiRequest.value=requestId();
    await mutate(async()=>{
      const owner=account(),family=snapshot.value?.familyId;
      try{const result=recheck?await notebook.aiGet(aiRequest.value):await notebook.ai(aiMode.value,aiText.value,aiRequest.value);if(usable(owner,family))aiResult.value=result;}
      catch(err){if(usable(owner,family))aiResult.value={requestId:aiRequest.value,status:'unknown',drafts:[],questions:[],answer:'',entryIds:[],error:'暂时无法确认处理结果，请查看原请求。'};throw err;}
    });
  }
  function resetAi(){aiRequest.value='';aiResult.value=null;}
  async function subscribe(entry: NotebookEntry) {
    const home=snapshot.value;
    if(!home||!canEnableNotebookReminder(entry,home.userId)){report(new Error('只有仍在安排中、有具体时间的日程参与人可以开启自己的提醒'));return;}
    // #ifdef MP-WEIXIN
    await subscribeWechat(entry);return;
    // #endif
    await subscribeAndroid(entry);
  }
  async function subscribeWechat(entry: NotebookEntry) {
    const home=snapshot.value;
    if(!home||!canEnableNotebookReminder(entry,home.userId))return;
    const owner=account(),family=home.familyId;
    const choice=await uni.showActionSheet({itemList:['订阅我的微信提醒','关闭我的微信提醒']}).catch(()=>null);
    if(!choice||!usable(owner,family))return;
    if(choice.tapIndex===1){
      if(!await confirm('将关闭当前账号的微信日程提醒，Android 提醒、已有微信授权和日程会保留。','关闭微信提醒','关闭微信')||!usable(owner,family))return;
      await mutate(async()=>{
        await call('notebook','reminders.preference',{expectedFamilyId:family,channel:'wechat',enabled:false});
        if(usable(owner,family))uni.showToast({title:'已关闭微信提醒，Android 提醒保留',icon:'none',duration:3000});
      });return;
    }
    if(!home.capabilities.wechatReminder||!home.capabilities.wechatTemplateId){report(new Error('微信提醒尚未开通，日程已保存'));return;}
    if(!await confirm('微信与 Android 提醒可同时开启，已有 Android 提醒会保留。微信提醒需要本人授权，具体次数以微信授权结果为准。','订阅微信提醒','继续订阅')||!usable(owner,family))return;
    try{
      const id=home.capabilities.wechatTemplateId,result=await wx.requestSubscribeMessage({tmplIds:[id]});
      if(!usable(owner,family))return;
      if(result[id]!=='accept'){uni.showToast({title:'未开启微信提醒',icon:'none'});return;}
      await mutate(async()=>{const receipt=await notebook.subscribe(entry);if(usable(owner,family))uni.showToast({title:receipt.message,icon:'none',duration:3000});});
    }catch(err){if(usable(owner,family))report(err);}
  }
  async function subscribeAndroid(entry: NotebookEntry) {
    const home=snapshot.value;
    if(!home||!canEnableNotebookReminder(entry,home.userId))return;
    if(!supportsAndroidReminders()){report(new Error('当前平台暂不支持 Android 提醒，可在微信小程序订阅微信提醒'));return;}
    const owner=account(),family=home.familyId;
    const current=androidReminderState.userId===home.userId&&androidReminderState.familyId===family&&androidReminderState.androidEnabled;
    if(current){
      const choice=await uni.showActionSheet({itemList:['重新检查 Android 提醒','关闭我的 Android 提醒']}).catch(()=>null);
      if(!choice||!usable(owner,family))return;
      if(choice.tapIndex===1){
        if(!await confirm('将关闭当前账号的 Android 日程提醒，微信提醒和已保存的日程会保留。','关闭 Android 提醒','关闭提醒')||!usable(owner,family))return;
        await mutate(async()=>{await disableAndroidReminders({userId:home.userId,familyId:family});if(usable(owner,family))uni.showToast({title:'已关闭 Android 提醒，微信提醒保留',icon:'none',duration:3000});});return;
      }
    }
    if(!await confirm('开启后，当前账号参与的所有后续日程将使用 Android 提醒，微信提醒可同时保留。需要允许系统通知；厂商离线通道尚未开通，应用关闭或锁屏后可能无法收到。','开启 Android 提醒','开启提醒')||!usable(owner,family))return;
    await mutate(async()=>{await enableAndroidReminders({userId:home.userId,familyId:family});if(usable(owner,family))uni.showToast({title:'已开启 Android 提醒，关闭应用后可能无法收到',icon:'none',duration:3500});});
  }
  onLoad((options)=>{disposed=false;initialEntryId=typeof options?.entryId==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(options.entryId)?options.entryId:'';void refresh();});
  onShow(()=>{if(initialShow){initialShow=false;return;}void refresh();});
  onHide(()=>{scope.invalidate();loading.value=false;});
  onUnload(()=>{disposed=true;scope.invalidate();clearShared();});
  onBackPress(()=>{if(busy.value){uni.showToast({title:'请等待当前操作完成',icon:'none'});return true;}if(editor.value){void closeEditor();return true;}if(selected.value||showTrash.value||showAi.value){selected.value=null;showTrash.value=false;showAi.value=false;return true;}return false;});
  return {snapshot,entries,active,lists,notes,members,accounts,tab,selectedDate,weekend,personFilter,noteFilter,query,loading,busy,error,initialized,editor,selected,showTrash,trash,showAi,aiText,aiMode,aiResult,aiRequest,name,memberName,refresh,openEntry,startEditor,saveEditor,closeEditor,createLinkedList,toggleItem,copyList,remove,loadTrash,restore,purge,chooseImages,linkSelf,runAi,resetAi,subscribe,report};
}
