import { isWechat } from '../platform/runtime';
const sessionKey='family-home-session-v1';
let observedUserId='';let watching=false;
const sessionListeners = new Set<() => void>();
export function onSessionChanged(listener: () => void): () => void { sessionListeners.add(listener); return () => { sessionListeners.delete(listener); }; }
function notifySessionChanged() { for (const listener of sessionListeners) listener(); }
export interface Session { token:string; expiresAt:number; userId:string; username:string }
export function getSession():Session|null {
  const value=uni.getStorageSync(sessionKey) as Session|null;
  return value && typeof value.token==='string' && value.expiresAt>Date.now()?value:null;
}
export function setSession(session:Session) { uni.setStorageSync(sessionKey,session); observedUserId=session.userId; notifySessionChanged(); }
export function clearSession() { uni.removeStorageSync(sessionKey); observedUserId=''; notifySessionChanged(); }
export function watchSessionChanges():void {
  // #ifdef H5
  if(watching)return;watching=true;observedUserId=getSession()?.userId||'';
  window.addEventListener('storage',event=>{
    if(event.key!==sessionKey&&event.key!==null)return;
    const nextUserId=getSession()?.userId||'';
    if(nextUserId!==observedUserId){observedUserId=nextUserId;uni.reLaunch({url:'/pages/home/index'});}
  });
  // #endif
}
let redirecting=false;
export function requireLogin(returnTo='/pages/home/index'):boolean {
  if(isWechat || getSession())return true;
  if(!redirecting){redirecting=true;uni.reLaunch({url:`/pages/login/index?returnTo=${encodeURIComponent(returnTo)}`,complete:()=>{redirecting=false;}});}
  return false;
}
export function storageScope():string { return getSession()?.userId || uni.getStorageSync('family-home-wx-user-id') || 'wechat'; }
