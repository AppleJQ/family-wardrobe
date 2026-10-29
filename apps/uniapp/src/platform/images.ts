import {displayPath} from './files';
/** H5 has no uni.compressImage; encode via an actual browser canvas. */
export async function compressPhoto(path:string,width:number,height:number,quality:number):Promise<string>{
  // #ifdef H5
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('无法读取照片，请换一张图片'));img.src=displayPath(path);});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw new Error('浏览器暂时无法处理照片');
  context.fillStyle='#ffffff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
  const data=canvas.toDataURL('image/jpeg',quality/100);canvas.width=0;canvas.height=0;return data;
  // #endif
  // #ifdef MP-WEIXIN
  const wxResult=await wx.compressImage({src:path,quality,compressedWidth:width,compressedHeight:height});return wxResult.tempFilePath;
  // #endif
  // #ifdef APP-PLUS || APP-HARMONY
  const nativeResult=await uni.compressImage({src:path,quality,width:String(width),height:String(height)});return nativeResult.tempFilePath;
  // #endif
  throw new Error('当前平台无法压缩照片');
}
