import type { Garment } from './store';
import { CLOUD_ENV } from '../config/cloud';
import { isWechat } from '../platform/runtime';
import { clearSession,getSession,requireLogin } from './session';
import { displayPath,readBase64 } from '../platform/files';
import { compressPhoto } from '../platform/images';
export interface CloudMember {id:string;name:string;version:number}
export interface CloudFamily {id:string;name:string;role:'owner'|'member'}
export interface FamilyAccount {userId:string;role:'owner'|'member';isSelf:boolean;label:string}
export interface FamilySnapshot {family:CloudFamily|null;members:CloudMember[];accounts:FamilyAccount[]}
export type CloudGarment=Omit<Garment,'memberId'>&{memberId:string};
export interface GarmentPage {items:CloudGarment[];cursor:string}
export class CloudError extends Error {constructor(public code:string,message:string){super(message);}}
interface Envelope<T>{ok:boolean;data:T;error?:{code:string;message:string}}
const friendly:Record<string,string>={AI_BALANCE_LOW:'智能功能暂不可用，请稍后再试',AI_NOT_CONFIGURED:'智能功能暂不可用，请稍后再试',CUTOUT_NOT_CONFIGURED:'去背景暂不可用，请稍后再试',CUTOUT_CACHE_UNAVAILABLE:'预览暂不可读取，请稍后再试'};
export async function httpCall<T>(group:string,action:string,data:Record<string,unknown>={}):Promise<T>{
  const base=import.meta.env.VITE_API_BASE_URL?.trim();
  if(!base)throw new CloudError('NOT_CONFIGURED','服务连接尚未配置，请联系应用维护者');
  if(!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(base))throw new CloudError('NOT_CONFIGURED','服务地址需要使用 HTTPS');
  const session=getSession();
  let result:Envelope<T>;
  try{
    const response=await uni.request({url:base,method:'POST',data:{group,action,data},header:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.token}`}:{})},timeout:isInitialRead(group,action)?15000:35000});
    result=response.data as Envelope<T>;
  }catch{throw new CloudError('NETWORK','暂时无法连接，请检查网络后重试');}
  return unpack(result,session?.token);
}
function unpack<T>(result:Envelope<T>,dispatchedToken?:string):T{
  if(!result?.ok){
    const code=result?.error?.code||'INTERNAL_ERROR';
    if(code==='UNAUTHENTICATED'&&!isWechat){
      const current=getSession();
      if(!current||current.token===dispatchedToken){clearSession();requireLogin();}
    }
    throw new CloudError(code,friendly[code]||result?.error?.message||'服务暂时不可用，请稍后重试');
  }
  return result.data;
}
export async function call<T>(name:string,action:string,data:Record<string,unknown>={}):Promise<T>{
  // #ifdef MP-WEIXIN
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const request=wx.cloud.callFunction({name,data:{...data,action},config:{env:CLOUD_ENV}});
    const response=isInitialRead(name,action)?await Promise.race([request,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new CloudError('READ_TIMEOUT','连接较慢，请点击重新加载再试')),15000);})]):await request;
    const result=unpack(response.result as Envelope<T>);
    if(name==='bootstrapUser' && result && typeof result==='object' && 'userId' in result)uni.setStorageSync('family-home-wx-user-id',result.userId);
    return result;
  }catch(error){if(error instanceof CloudError)throw error;throw new CloudError('NETWORK','暂时无法连接，请检查网络后重试');}
  finally{if(timer!==undefined)clearTimeout(timer);}
  // #endif
  // #ifndef MP-WEIXIN
  if(!getSession()){requireLogin();throw new CloudError('UNAUTHENTICATED','请先登录');}
  return httpCall<T>(name,action,data);
  // #endif
}
function isInitialRead(name:string,action:string):boolean{return action==='home'||(name==='bootstrapUser'&&action==='bootstrap');}
export async function authCall<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
  // #ifdef MP-WEIXIN
  const response=await wx.cloud.callFunction({name:'multiPlatformApi',data:{group:'auth',action,data},config:{env:CLOUD_ENV}});
  return unpack(response.result as Envelope<T>);
  // #endif
  // #ifndef MP-WEIXIN
  return httpCall<T>('auth',action,data);
  // #endif
}
export async function prepareImage(path:string):Promise<{path:string;base64:string}>{
  let base64=await readBase64(path);
  const info=await uni.getImageInfo({src:displayPath(path)});
  const supported=base64.startsWith('iVBORw0KGgo')||base64.startsWith('/9j/');
  if(supported && info.width*info.height<=4000000 && base64.length<=Math.ceil(512*1024/3)*4)return{path,base64};
  const ratio=Math.min(1,1600/Math.max(info.width,info.height));
  for(const quality of [75,50,30]){
    const compressed=await compressPhoto(path,Math.round(info.width*ratio),Math.round(info.height*ratio),quality);
    base64=await readBase64(compressed);
    if(base64.length<=Math.ceil(512*1024/3)*4)return{path:compressed,base64};
  }
  throw new CloudError('IMAGE_TOO_LARGE','图片压缩后仍超过512KB，请换一张较小的照片');
}
