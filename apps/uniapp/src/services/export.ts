import { createZip,csvCell,utf8 } from './archive';
import { call,CloudGarment,FamilySnapshot } from './cloud';
import {localPath,writeBase64} from '../platform/files';
interface ExportOptions {memberId?:string;onProgress?:(count:number)=>void;isCancelled?:()=>boolean}
interface ExportPage {items:Array<CloudGarment&Record<string,unknown>>;cursor:string;manifest?:{locations?:unknown[]}}
export async function exportWardrobe(options:ExportOptions={}):Promise<{path:string;count:number;bytes:number}>{
  const scope=await call<FamilySnapshot>('families','get');if(!scope.family)throw new Error('请先加入家庭');
  const familyId=scope.family.id,records:Array<Record<string,unknown>>=[],outfits:Array<Record<string,unknown>>=[],chunks:Uint8Array[]=[],seen=new Set<string>();
  let bytes=0,locations:unknown[]=[];
  const active=()=>{if(options.isCancelled?.())throw new Error('已取消导出');};
  const sameFamily=async()=>{active();if((await call<FamilySnapshot>('families','get')).family?.id!==familyId)throw new Error('家庭已变化，导出已停止');active();};
  const zip=createZip(chunk=>{active();bytes+=chunk.length;if(bytes>80*1024*1024)throw new Error('导出超过80MB，请按成员分别导出');chunks.push(chunk.slice());});
  let cursor='';
  do{
    active();const page=await call<ExportPage>('wardrobe','exportPage',{memberId:options.memberId||undefined,limit:20,cursor});
    if(page.manifest?.locations)locations=page.manifest.locations;await sameFamily();
    for(const row of page.items){
      active();if(seen.has(row.id))throw new Error('导出分页出现重复，请重新导出');
      const current=await call<CloudGarment>('garments','get',{garmentId:row.id});if(current.version!==row.version)throw new Error('衣物在导出时被修改，请重新导出');
      const photo=await call<{base64:string;mimeType:string}>('garments','photoBase64',{garmentId:row.id});active();
      const name=`photos/${row.id.replace(/[^a-zA-Z0-9_-]/g,'_')}.${photo.mimeType==='image/png'?'png':'jpg'}`;
      zip.add(name,new Uint8Array(uni.base64ToArrayBuffer(photo.base64)));
      const {image:_image,...metadata}=row;records.push({...metadata,memberName:scope.members.find(m=>m.id===row.memberId)?.name||'',photo:name});seen.add(row.id);options.onProgress?.(records.length);
    }
    cursor=page.cursor;
  }while(cursor);
  do{
    active();const page=await call<{items:Array<Record<string,unknown>>;cursor:string}>('wardrobe','outfits.list',{memberId:options.memberId||undefined,limit:20,cursor});
    outfits.push(...page.items.map(outfit=>({...outfit,garments:Array.isArray(outfit.garments)?outfit.garments.map(raw=>{const{image:_image,...snapshot}=raw as Record<string,unknown>;return snapshot;}):[]})));cursor=page.cursor;
  }while(cursor);
  await sameFamily();
  zip.add('manifest.json',utf8(JSON.stringify({version:'0.3.0',exportedAt:new Date().toISOString(),familyName:scope.family.name,members:scope.members,locations,garments:records},null,2)));
  zip.add('outfits.json',utf8(JSON.stringify(outfits,null,2)));
  const fields=['id','memberName','name','category','color','season','location','notes','photo'];
  zip.add('衣物清单.csv',utf8('\ufeff'+[fields.map(csvCell).join(','),...records.map(row=>fields.map(field=>csvCell(row[field])).join(','))].join('\r\n')));zip.finish();
  const output=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
  active();const path=localPath(`wardrobe-${Date.now()}.zip`);await writeBase64(path,uni.arrayBufferToBase64(output.buffer));
  return{path,count:records.length,bytes};
}
