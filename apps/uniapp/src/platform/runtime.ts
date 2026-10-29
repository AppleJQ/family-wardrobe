import { displayPath, shareLocalFile } from './files';
export const isWechat = (() => {
  // #ifdef MP-WEIXIN
  return true;
  // #endif
  return false;
})();
let storageOwner='guest';
export function setStorageOwner(userId:string):void { storageOwner=userId||'guest'; }
export const platform = {
  // Drafts and pending tasks belong to the authenticated account, even on a shared phone.
  getStorageSync: (key:string) => uni.getStorageSync(scopedKey(key)),
  setStorageSync: (key:string,value:unknown) => uni.setStorageSync(scopedKey(key),value),
  removeStorageSync: (key:string) => uni.removeStorageSync(scopedKey(key)),
  getWindowInfo: () => ({ ...uni.getWindowInfo(), statusBarHeight:uni.getWindowInfo().statusBarHeight || 0 }),
  showToast: uni.showToast, showModal:uni.showModal, showActionSheet:uni.showActionSheet,
  navigateTo:uni.navigateTo, navigateBack:uni.navigateBack, reLaunch:uni.reLaunch,
  setClipboardData:uni.setClipboardData,
  previewImage: (options: UniApp.PreviewImageOptions) => uni.previewImage({...options,urls:options.urls?.map(displayPath)}),
  shareFileMessage: (options:{filePath:string;fileName:string;fail?:()=>void}) => { void shareLocalFile(options.filePath,options.fileName).catch(error=>{if((error as {code?:string})?.code!=='CANCELLED')options.fail?.();}); },
  openPrivacyContract: (options:{fail?:()=>void}={}) => {
    // #ifdef MP-WEIXIN
    wx.openPrivacyContract(options); return;
    // #endif
    uni.navigateTo({url:'/pages/privacy/index',fail:options.fail});
  },
  getPrivacySetting: (options:{success:(r:WechatMiniprogram.GetPrivacySettingSuccessCallbackResult)=>void;fail:(error:unknown)=>void}) => {
    // #ifdef MP-WEIXIN
    wx.getPrivacySetting(options); return;
    // #endif
    options.success({needAuthorization:!uni.getStorageSync('family-home-photo-consent'),privacyContractName:'隐私保护指引',errMsg:'getPrivacySetting:ok'});
  },
  chooseMedia: async (options:{count:number;mediaType:string[];sourceType:Array<'album'|'camera'>}) => {
    const result=await uni.chooseImage({count:options.count,sourceType:options.sourceType,sizeType:['original']});
    const paths=typeof result.tempFilePaths==='string'?[result.tempFilePaths]:result.tempFilePaths;
    return {tempFiles:paths.map(tempFilePath=>({tempFilePath}))};
  },
};
function scopedKey(key:string):string {
  // On WeChat retain the old key so existing native drafts survive migration.
  return isWechat?key:`${storageOwner}:${key}`;
}
