import type { CycleHome, CyclePeriod, CycleDailyInput, CycleSymptom, CycleAiResult } from './cycle';
import type { CyclePeriodInput } from './cycle';

export function emptyDaily(date:string):CycleDailyInput{return {date,flow:'',symptoms:[],mood:'',intimacy:null,ovulationTest:''};}
export function toggleSymptom(values:CycleSymptom[],value:CycleSymptom):CycleSymptom[]{
  if(values.includes(value))return values.filter(row=>row!==value);
  return value==='none'?['none']:[...values.filter(row=>row!=='none'),value];
}
const within=(date:string,start:string,end:string)=>date>=start&&date<=end;
export function dayKind(date:string,home:CycleHome):string{
  if(home.profile?.periods.some(row=>row.deletedAt===null&&within(date,row.start,row.end||home.today)))return 'actual';
  const p=home.prediction;if(!p)return '';
  if(within(date,p.start,p.end||p.start))return 'predicted';
  if(date===p.ovulation)return 'ovulation';
  return within(date,p.fertileStart,p.fertileEnd)?'fertile':'';
}
export function periodError(value:CyclePeriodInput,rows:CyclePeriod[],today:string):string{
  if(!value.start)return '请选择经期开始日期';
  if(value.start>today||(value.end&&value.end>today))return '实际记录请选择今天或过去的日期';
  if(value.end&&value.end<value.start)return '结束日期不能早于开始日期';
  if(rows.some(row=>row.id!==value.id&&row.deletedAt===null&&value.start<=(row.end||today)&&row.start<=(value.end||today)))return '与已有经期重叠，请修改原记录';
  return '';
}
export function aiAction(result:Pick<CycleAiResult,'status'|'profileVersion'>|null,_version:number):'query'|'view'|'analyze'{
  if(result?.status==='running'||result?.status==='unknown')return 'query';
  return result?.status==='succeeded'?'view':'analyze';
}
export function cycleUpdatedLabel(value:{updatedBy:string;updatedAt:number},accounts:Array<{userId:string;name:string}>):string{
  const name=accounts.find(account=>account.userId===value.updatedBy)?.name||'共享账号';
  const date=new Date(value.updatedAt+8*3600000);
  const time=value.updatedAt>0&&!Number.isNaN(date.getTime())?date.toISOString().slice(0,16).replace('T',' '):'时间未记录';
  return `${name} · ${time} 更新`;
}
export const cycleLabels={
  flow:{light:'少',medium:'中',heavy:'多'},
  symptoms:{none:'无不适',mild_cramps:'轻微痛经',strong_cramps:'明显痛经',backache:'腰酸',breast_tenderness:'乳房胀痛',fatigue:'乏力',headache:'头痛'},
  mood:{happy:'开心',calm:'平静',low:'低落',irritable:'烦躁',anxious:'焦虑'},
  ovulationTest:{negative:'阴性',weak_positive:'弱阳',positive:'强阳'},
};
export function dailySummary(value:CycleDailyInput|null):string[]{
  if(!value)return [];
  return [value.flow?`经量${cycleLabels.flow[value.flow]}`:'',...value.symptoms.map(v=>cycleLabels.symptoms[v]),value.mood?cycleLabels.mood[value.mood]:'',value.intimacy===null?'':value.intimacy?'同房：有':'同房：无',value.ovulationTest?`试纸${cycleLabels.ovulationTest[value.ovulationTest]}`:''].filter(Boolean);
}
