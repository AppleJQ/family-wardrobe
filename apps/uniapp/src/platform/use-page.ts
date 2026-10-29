import { reactive,toRefs,ref } from 'vue';
import { onLoad,onShow,onHide,onUnload,onBackPress } from '@dcloudio/uni-app';
import { createPageInstance } from './page-state';
import { initFiles } from './files';
import { requireLogin,getSession } from '../services/session';
import {isWechat,setStorageOwner} from './runtime';
type Definition={data:Record<string,unknown>} & Record<string,any>;
export function usePage<D extends Definition>(factory:()=>D,route:string){
  const definition=factory();const state=reactive(definition.data as D['data']);const instance=createPageInstance(definition,state as D['data']);
  const ownerId=getSession()?.userId||'';
  const currentAccount=()=>isWechat||(getSession()?.userId||'')===ownerId;
  const allowed=ref(false);let initialized=false;let initialShow=true;let cancelled=false;
  const handlers={...instance};
  for(const [key,value] of Object.entries(definition))if(typeof value==='function'){
    (handlers as Record<string,unknown>)[key]=(...args:unknown[])=>{
      if(!currentAccount()){cancelled=true;allowed.value=false;instance.onUnload?.();uni.reLaunch({url:'/pages/home/index'});return;}
      return (instance as Record<string,(...args:unknown[])=>unknown>)[key](...args);
    };
  }
  onLoad(async options=>{const returnTo=route+(options?.section==='account'?'?section=account':'');if(!requireLogin(returnTo))return;setStorageOwner(ownerId);try{await initFiles();if(cancelled||!currentAccount())return;allowed.value=true;initialized=true;await instance.onLoad?.(options);}catch(error){uni.showToast({title:error instanceof Error?error.message:'无法读取本机草稿',icon:'none'});}});
  onShow(()=>{if(initialShow){initialShow=false;return;}if(initialized&&requireLogin(route))void instance.onShow?.();});
  onHide(()=>instance.onHide?.());onUnload(()=>{cancelled=true;instance.onUnload?.();});
  onBackPress(()=>{if(state.saving||state.exporting||state.recognizingBatch){uni.showToast({title:'请等待当前操作完成',icon:'none'});return true;}return false;});
  return {state,refs:toRefs(state as D['data']),handlers,allowed};
}
