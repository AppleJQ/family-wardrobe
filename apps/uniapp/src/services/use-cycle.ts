import { computed, ref, watch, type Ref } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import type { NotebookHome } from './notebook';
import { createCycleService, sessionIdentity, type CycleHome, type CycleAiResult, type CycleDailyInput, type CyclePeriod, type CycleSettings, type CyclePeriodInput } from './cycle';
import { emptyDaily, periodError, aiAction } from './cycle-core-client';
import { beijingToday, requestId, copyNotebookData } from './notebook-state';

export interface CycleSettingsDraft { cycleLength:string; periodLength:string; predictionPaused:boolean; memberId:string; accessUserIds:string[]; start:string; end:string }
export function useCycle(notebook: Ref<NotebookHome|null>, enabled: Ref<boolean>) {
  const home=ref<CycleHome|null>(null),loading=ref(false),busy=ref(false),error=ref('');
  const view=ref<'calendar'|'setup'|'analysis'|'history'|'ai'>('calendar'),sheet=ref<''|'daily'|'period'|'settings'>('');
  const selectedDate=ref(beijingToday()),month=ref(beijingToday()),dailyDraft=ref<CycleDailyInput|null>(null),periodDraft=ref<CyclePeriodInput|null>(null),settingsDraft=ref<CycleSettingsDraft|null>(null);
  const aiResult=ref<CycleAiResult|null>(null),aiBusy=ref(false),aiError=ref(''),pendingRequest=ref('');
  let epoch=0,aiEpoch=0,disposed=false,skipped=false,draftBefore='',draftRequest='',draftVersion=0,pendingVersion=0,ownerScope='';
  const operationKeys=new Map<string,string>();
  const current=()=>({familyId:notebook.value?.familyId||'',userId:notebook.value?.userId||'',sessionKey:sessionIdentity()});
  const scopeKey=()=>JSON.stringify(current());
  const api=createCycleService(current);
  const today=computed(()=>home.value?.today||beijingToday());
  const profile=computed(()=>home.value?.profile||null);
  const periods=computed(()=>profile.value?.periods.filter(row=>row.deletedAt===null).sort((a,b)=>b.start.localeCompare(a.start))||[]);
  const daily=computed(()=>profile.value?.daily.find(row=>row.date===selectedDate.value&&row.deletedAt===null)||null);
  const runningPeriod=computed(()=>periods.value.find(row=>!row.end&&row.start<=selectedDate.value)||null);
  const staleAi=computed(()=>!!aiResult.value&&(aiResult.value.stale||aiResult.value.profileVersion!==profile.value?.version));
  const canAnalyze=computed(()=>!!profile.value&&!!home.value?.aiAvailable&&(home.value?.statistics.cycles.length||0)>0);
  const pending=computed(()=>!!pendingRequest.value||aiResult.value?.status==='unknown'||aiResult.value?.status==='running');
  const storageKey=()=>`family-cycle-ai-v1/${encodeURIComponent(current().userId)}/${encodeURIComponent(current().familyId)}`;
  const valid=(key:string,stamp:number)=>!disposed&&key===scopeKey()&&stamp===epoch;
  const message=(err:unknown)=>typeof (err as {message?:unknown})?.message==='string'?(err as {message:string}).message:'操作未成功，请稍后重试';
  const revoked=(err:unknown)=>['FORBIDDEN','NO_FAMILY','UNAUTHENTICATED'].includes((err as {code?:string})?.code||'');
  function captureScope(){const key=scopeKey(),stamp=epoch;return ()=>valid(key,stamp);}
  async function confirm(content:string,title='离开编辑',confirmText='放弃'){const stillCurrent=captureScope();const result=await uni.showModal({title,content,confirmText,cancelText:'取消'});return stillCurrent()&&result.confirm;}
  function clear(){epoch++;aiEpoch++;home.value=null;error.value='';sheet.value='';view.value='calendar';dailyDraft.value=null;periodDraft.value=null;settingsDraft.value=null;aiResult.value=null;aiError.value='';pendingRequest.value='';busy.value=false;loading.value=false;aiBusy.value=false;skipped=false;operationKeys.clear();}
  function persistPending(){try{if(pendingRequest.value)uni.setStorageSync(storageKey(),{requestId:pendingRequest.value,version:pendingVersion});else uni.removeStorageSync(storageKey());}catch{/* In-memory request remains queryable when storage is unavailable. */}}
  function restorePending(){try{const value=uni.getStorageSync(storageKey()) as {requestId?:string;version?:number}|null;if(value&&typeof value.requestId==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value.requestId)){pendingRequest.value=value.requestId;pendingVersion=Number(value.version)||0;}}catch{/* Storage is optional. */}}
  function markAi(result:CycleAiResult){aiResult.value=result;if(result.status==='running'||result.status==='unknown'){pendingRequest.value=result.requestId;pendingVersion=result.profileVersion;}else pendingRequest.value='';persistPending();}
  function placeholder(status:'running'|'unknown'|'failed'):CycleAiResult{return {requestId:pendingRequest.value,status,generatedAt:0,profileVersion:pendingVersion,stale:pendingVersion!==profile.value?.version,range:{start:'',end:'',cycles:0,periods:0,dailyDays:0},statistics:home.value!.statistics,sections:[],error:''};}
  function aiFailure(err:unknown,action:'analyze'|'query'|'latest'){
    const code=(err as {code?:string})?.code||'';
    const missing=action==='query'&&code==='NOT_FOUND';
    const rejected=action==='analyze'&&['RATE_LIMITED','AI_NOT_CONFIGURED','CONFLICT','INSUFFICIENT_DATA','AI_INPUT_TOO_LARGE','INVALID_INPUT','REQUEST_CONFLICT'].includes(code);
    aiError.value=missing?'原分析任务不存在，未创建可查询的任务。可主动重新分析。':message(err);
    if(!pendingRequest.value)return;
    if(missing||rejected)markAi({...placeholder('failed'),error:aiError.value});
    else aiResult.value=placeholder('unknown');
  }
  async function loadAi(key:string,stamp:number){
    const aiStamp=++aiEpoch;
    if(!pendingRequest.value)restorePending();
    const action=pendingRequest.value?'query':'latest';
    try{
      const result=action==='query'?await api.aiGet(pendingRequest.value):await api.aiLatest();
      if(valid(key,stamp)&&aiStamp===aiEpoch){if(result)markAi(result);else aiResult.value=null;aiError.value='';}
    }catch(err){if(valid(key,stamp)&&aiStamp===aiEpoch){if(revoked(err)){clear();error.value=message(err);return;}aiFailure(err,action);}}
  }
  async function refresh(){
    if(disposed||!notebook.value||busy.value||aiBusy.value)return;
    if(ownerScope!==scopeKey()){clear();ownerScope=scopeKey();}
    if(loading.value)return;
    const key=scopeKey(),stamp=++epoch;loading.value=true;error.value='';
    try{const result=await api.home();if(!valid(key,stamp))return;home.value=result;loading.value=false;if(!result.profile&&!skipped)view.value='setup';if(result.profile)await loadAi(key,stamp);}
    catch(err){if(valid(key,stamp)){if(revoked(err))clear();home.value=null;error.value=message(err);}}
    finally{if(valid(key,stamp))loading.value=false;}
  }
  async function mutate(work:(version:number,id:string)=>Promise<CycleHome>,onSaved?:()=>void,key=draftRequest+JSON.stringify(dailyDraft.value||periodDraft.value||settingsDraft.value),expectedVersion?:number){
    if(busy.value||loading.value||!home.value)return false;
    const scope=scopeKey(),stamp=epoch,version=expectedVersion??profile.value?.version??0;
    key=`${version}/${key}`;
    if(!operationKeys.has(key))operationKeys.set(key,requestId());
    busy.value=true;error.value='';
    try{const result=await work(version,operationKeys.get(key)!);if(!valid(scope,stamp))return false;home.value=result;operationKeys.delete(key);onSaved?.();uni.showToast({title:'已保存',icon:'success'});return true;}
    catch(err){if(valid(scope,stamp)){if(revoked(err)){clear();error.value=message(err);return false;}error.value=message(err);if(['CONFLICT','VERSION_CONFLICT'].includes((err as {code?:string}).code||'')){operationKeys.delete(key);try{const latest=await api.home();if(valid(scope,stamp)){home.value=latest;error.value=`${message(err)}。当前草稿已保留，请关闭后重新打开最新记录，核对后再保存。`;}}catch(reloadError){if(valid(scope,stamp)&&revoked(reloadError)){clear();error.value=message(reloadError);}}}}return false;}
    finally{if(valid(scope,stamp))busy.value=false;}
  }
  function snapshotDraft(){draftRequest=requestId();draftVersion=profile.value?.version||0;draftBefore=JSON.stringify(dailyDraft.value||periodDraft.value||settingsDraft.value);error.value='';}
  function closeDraft(){sheet.value='';dailyDraft.value=null;periodDraft.value=null;settingsDraft.value=null;draftBefore='';error.value='';}
  async function closeSheet(){if(busy.value)return false;const stillCurrent=captureScope(),opened=sheet.value,value=dailyDraft.value||periodDraft.value||settingsDraft.value;if(value&&JSON.stringify(value)!==draftBefore&&!await confirm('尚未保存的内容将放弃。'))return false;if(!stillCurrent()||opened!==sheet.value||value!==(dailyDraft.value||periodDraft.value||settingsDraft.value))return false;closeDraft();return true;}
  async function beforeLeave(){const stillCurrent=captureScope();if(busy.value){uni.showToast({title:'请等待保存完成',icon:'none'});return false;}if(sheet.value&&!await closeSheet())return false;if(!stillCurrent())return false;if(view.value==='setup'&&settingsDraft.value&&JSON.stringify(settingsDraft.value)!==draftBefore&&!await confirm('尚未保存的启用设置将放弃。'))return false;if(!stillCurrent())return false;if(view.value==='setup')settingsDraft.value=null;return true;}
  function openDaily(date:string){if(!profile.value||busy.value)return;if(date>today.value){error.value='未来日期可查看预测，实际记录请选择今天或过去';return;}selectedDate.value=date;closeDraft();dailyDraft.value=daily.value?copyNotebookData(daily.value):emptyDaily(date);sheet.value='daily';snapshotDraft();}
  function openPeriod(period?:CyclePeriod){if(!profile.value||busy.value)return;closeDraft();periodDraft.value=period?{id:period.id,start:period.start,end:period.end}:{start:selectedDate.value<=today.value?selectedDate.value:today.value,end:''};sheet.value='period';snapshotDraft();}
  function makeSettings():CycleSettingsDraft{const nb=notebook.value!,p=profile.value;return {cycleLength:p?.settings.cycleLength?.toString()||'',periodLength:p?.settings.periodLength?.toString()||'',predictionPaused:p?.settings.predictionPaused||false,memberId:p?.memberId||nb.members.find(m=>m.linkedUserId===nb.userId)?.id||'',accessUserIds:p?[...p.accessUserIds]:[nb.userId,...nb.accounts.filter(a=>a.userId!==nb.userId).slice(0,1).map(a=>a.userId)],start:'',end:''};}
  function openSettings(){if(!home.value||busy.value)return;closeDraft();settingsDraft.value=makeSettings();sheet.value='settings';snapshotDraft();}
  function openSetup(){if(!home.value||busy.value)return;closeDraft();view.value='setup';settingsDraft.value=makeSettings();snapshotDraft();}
  function skipSetup(){settingsDraft.value=null;skipped=true;view.value='calendar';error.value='';}
  function toggleAccount(id:string){const draft=settingsDraft.value;if(!draft||id===notebook.value?.userId)return;if(draft.accessUserIds.includes(id))draft.accessUserIds=draft.accessUserIds.filter(v=>v!==id);else if(draft.accessUserIds.length<2)draft.accessUserIds.push(id);else error.value='最多选择两个共享账号（含本人），请先取消另一个账号';}
  function settingsValue():CycleSettings|null{const d=settingsDraft.value;if(!d)return null;const cycle=d.cycleLength.trim(),period=d.periodLength.trim();if(cycle&&(!/^\d+$/.test(cycle)||Number(cycle)<15||Number(cycle)>60)){error.value='参考周期请填15–60的整数天数，或留空表示不确定';return null;}if(period&&(!/^\d+$/.test(period)||Number(period)<1||Number(period)>20)){error.value='经期持续请填1–20的整数天数，或留空表示不确定';return null;}if(!d.accessUserIds.includes(notebook.value!.userId)||d.accessUserIds.length>2){error.value='请选择含本人在内的至多两个共享账号';return null;}return {cycleLength:cycle?Number(cycle):null,periodLength:period?Number(period):null,predictionPaused:d.predictionPaused};}
  async function saveSettings(setup=false){const d=settingsDraft.value,settings=settingsValue();if(!d||!settings)return;if(setup&&!d.memberId){error.value='请选择经期所属的家庭成员';return;}if(setup&&d.end&&!d.start){error.value='请先选择开始日期，或将起止日期都留空';return;}if(setup&&d.start){const reason=periodError({start:d.start,end:d.end},[],today.value);if(reason){error.value=reason;return;}}await mutate((version,id)=>setup?api.setup({requestId:id,memberId:d.memberId,accessUserIds:d.accessUserIds,settings,...(d.start?{period:{start:d.start,end:d.end}}:{})}):api.settings(version,id,settings,d.accessUserIds),()=>{closeDraft();view.value='calendar';},undefined,draftVersion);}
  async function saveDaily(){const d=dailyDraft.value;if(!d)return;if(d.date>today.value){error.value='实际记录请选择今天或过去';return;}await mutate((version,id)=>api.dailySave(version,id,{date:d.date,flow:d.flow,symptoms:[...d.symptoms],mood:d.mood,intimacy:d.intimacy,ovulationTest:d.ovulationTest}),closeDraft,undefined,draftVersion);}
  async function savePeriod(){const d=periodDraft.value;if(!d)return;const reason=periodError(d,profile.value?.periods||[],today.value);if(reason){error.value=reason;return;}await mutate((version,id)=>api.periodSave(version,id,{...d}),closeDraft,undefined,draftVersion);}
  async function periodShortcut(action:'start'|'end'){
    if(!profile.value||busy.value||selectedDate.value>today.value)return;
    const d:CyclePeriodInput=action==='start'?{start:selectedDate.value,end:''}:runningPeriod.value?{id:runningPeriod.value.id,start:runningPeriod.value.start,end:selectedDate.value}:{start:'',end:''};
    if(action==='end'&&!d.start){error.value='请先补录本次经期开始日期';return;}
    const reason=periodError(d,profile.value.periods,today.value);if(reason){error.value=reason;return;}
    const previousVersion=profile.value.version,originalDraft=dailyDraft.value,originalDraftRequest=draftRequest,originalBaseline=draftBefore;
    const advanceDraft=!!originalDraft&&draftVersion===previousVersion;
    if(!await confirm(`将${selectedDate.value}保存为本次经期${action==='start'?'开始':'结束'}日期。其他每日选填内容请另点“保存每日记录”。`,'保存经期日期','保存'))return;
    await mutate((version,id)=>api.periodSave(version,id,d),()=>{
      if(advanceDraft&&profile.value?.version===previousVersion+1&&dailyDraft.value===originalDraft&&draftVersion===previousVersion&&draftRequest===originalDraftRequest&&draftBefore===originalBaseline)draftVersion=previousVersion+1;
    },`shortcut/${action}/${selectedDate.value}/${previousVersion}`,previousVersion);
  }
  async function removePeriod(period:CyclePeriod){const version=profile.value?.version||0;if(!await confirm('移入已删除记录后，相关统计和预测会更新；之后可恢复。','删除这次经期','删除'))return;await mutate((v,id)=>api.periodMutate('delete',v,id,period.id),closeDraft,`period/delete/${period.id}/${version}`,version);}
  async function restorePeriod(period:CyclePeriod){await mutate((v,id)=>api.periodMutate('restore',v,id,period.id),undefined,`period/restore/${period.id}/${profile.value?.version}`);}
  async function removeDaily(date:string){const version=profile.value?.version||0;if(!await confirm('删除这天的每日记录，经期起止日期会保留；之后可恢复。','删除每日记录','删除'))return;await mutate((v,id)=>api.dailyMutate('delete',v,id,date),closeDraft,`daily/delete/${date}/${version}`,version);}
  async function restoreDaily(date:string){await mutate((v,id)=>api.dailyMutate('restore',v,id,date),undefined,`daily/restore/${date}/${profile.value?.version}`);}
  async function runAi(forceNew=false){
    if(!profile.value||!home.value||aiBusy.value)return;
    const action=pendingRequest.value?'query':forceNew?'analyze':aiAction(aiResult.value,profile.value.version);
    view.value='ai';if(action==='view')return;
    if(action==='analyze'&&!canAnalyze.value){aiError.value=home.value.aiAvailable?'至少记录两次经期开始日期后可分析':'智能分析暂不可用，基础统计仍可查看';return;}
    const key=scopeKey(),stamp=epoch,aiStamp=++aiEpoch;
    if(action==='analyze'){pendingRequest.value=requestId();pendingVersion=profile.value.version;persistPending();aiResult.value=placeholder('running');}
    const id=pendingRequest.value||aiResult.value?.requestId||'';aiBusy.value=true;aiError.value='';
    try{const result=action==='query'?await api.aiGet(id):await api.analyze(id,pendingVersion);if(valid(key,stamp)&&aiStamp===aiEpoch)markAi(result);}
    catch(err){if(valid(key,stamp)&&aiStamp===aiEpoch){if(revoked(err)){clear();error.value=message(err);return;}aiFailure(err,action);}}
    finally{if(valid(key,stamp)&&aiStamp===aiEpoch)aiBusy.value=false;}
  }
  watch(()=>`${notebook.value?.userId||''}/${notebook.value?.familyId||''}/${sessionIdentity()}`,()=>{const key=scopeKey();if(key!==ownerScope){clear();ownerScope=key;if(enabled.value&&notebook.value)void refresh();}},{immediate:true,flush:'sync'});
  watch(enabled,value=>{if(value&&notebook.value){if(!home.value)void refresh();else if(!profile.value&&!skipped&&!settingsDraft.value)openSetup();}},{flush:'sync'});
  watch(()=>view.value,value=>{if(value==='setup'&&!settingsDraft.value&&notebook.value){settingsDraft.value=makeSettings();snapshotDraft();}},{flush:'sync'});
  function pause(){epoch++;aiEpoch++;loading.value=false;aiBusy.value=false;busy.value=false;}
  function resume(){if(enabled.value&&notebook.value)return refresh();return Promise.resolve();}
  onHide(pause);
  onShow(resume);
  onUnload(()=>{disposed=true;clear();});
  function dispose(){disposed=true;clear();}
  return {home,profile,today,loading,busy,error,view,sheet,selectedDate,month,daily,dailyDraft,periodDraft,settingsDraft,periods,runningPeriod,aiResult,aiBusy,aiError,pendingRequest,pending,staleAi,canAnalyze,refresh,openDaily,openPeriod,openSettings,openSetup,skipSetup,toggleAccount,saveSettings,saveDaily,savePeriod,periodShortcut,removePeriod,restorePeriod,removeDaily,restoreDaily,closeSheet,beforeLeave,runAi,dispose,pause,resume,captureScope};
}
