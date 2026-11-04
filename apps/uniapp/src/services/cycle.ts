import { call } from './cloud';
import { getSession, storageScope } from './session';
import type { CycleHome, CycleSettings, CycleDailyInput, CycleAiResult } from '../../../../cloud/src/cycle-model';
export type { CycleHome, CycleProfile, CyclePeriod, CycleSettings, CycleDailyInput, CycleDaily, CycleSymptom, CycleAiResult } from '../../../../cloud/src/cycle-model';

export interface CycleScope { familyId: string; userId: string; sessionKey: string }
export interface CyclePeriodInput { id?: string; start: string; end: string }
export interface CycleSetup { requestId: string; memberId: string; accessUserIds: string[]; settings: CycleSettings; period?: CyclePeriodInput }
export function sessionIdentity(): string { const session=getSession();return session ? `${session.userId}/${session.token}` : storageScope(); }
export function sameCycleScope(a: CycleScope, b: CycleScope): boolean { return a.familyId===b.familyId&&a.userId===b.userId&&a.sessionKey===b.sessionKey; }

/** Scope is captured before dispatch and checked again before exposing sensitive responses. */
export function createCycleService(current: () => CycleScope, transport: typeof call = call) {
  async function scoped<T>(action: string, data: Record<string,unknown> = {}): Promise<T> {
    const scope={...current()};
    if(!scope.familyId||!scope.userId)throw new Error('请先打开当前家庭');
    const result=await transport<T>('notebook',`cycle.${action}`,{...data,expectedFamilyId:scope.familyId});
    if(!sameCycleScope(scope,current()))throw new Error('账号或家庭已变化，请重新打开经期记录');
    return result;
  }
  const mutation=(action: string,version: number,requestId: string,data: Record<string,unknown>)=>scoped<CycleHome>(action,{version,requestId,...data});
  return {
    home:()=>scoped<CycleHome>('home'),
    setup:(data: CycleSetup)=>scoped<CycleHome>('setup',{...data}),
    settings:(version:number,requestId:string,settings:CycleSettings,accessUserIds:string[])=>mutation('settings.update',version,requestId,{settings,accessUserIds}),
    periodSave:(version:number,requestId:string,period:CyclePeriodInput)=>mutation('period.save',version,requestId,{period}),
    periodMutate:(action:'delete'|'restore',version:number,requestId:string,periodId:string)=>mutation(`period.${action}`,version,requestId,{periodId}),
    dailySave:(version:number,requestId:string,daily:CycleDailyInput)=>mutation('daily.save',version,requestId,{daily}),
    dailyMutate:(action:'delete'|'restore',version:number,requestId:string,date:string)=>mutation(`daily.${action}`,version,requestId,{date}),
    analyze:(requestId:string,version:number)=>scoped<CycleAiResult>('ai.analyze',{requestId,version}),
    aiGet:(requestId:string)=>scoped<CycleAiResult>('ai.get',{requestId}),
    aiLatest:()=>scoped<CycleAiResult|null>('ai.latest'),
  };
}
