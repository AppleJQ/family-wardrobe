<script setup lang="ts">
import { computed, toRef, onUnmounted } from 'vue';
import type { NotebookHome } from '../../services/notebook';
import { useCycle } from '../../services/use-cycle';
import { dateLabel } from '../../services/notebook-state';
import { dayKind, dailySummary, cycleUpdatedLabel } from '../../services/cycle-core-client';
import NotebookSheet from '../notebook/NotebookSheet.vue';
import CycleCalendar from './CycleCalendar.vue';
import CycleDailyForm from './CycleDailyForm.vue';
import CycleSettingsForm from './CycleSettingsForm.vue';
import CycleAnalysis from './CycleAnalysis.vue';
import CycleAi from './CycleAi.vue';
const props=defineProps<{notebook:NotebookHome;active:boolean}>();
const c=useCycle(toRef(props,'notebook'),toRef(props,'active'));
const {home,profile,today,loading,busy,error,view,sheet,selectedDate,month,daily,dailyDraft,periodDraft,settingsDraft,periods,runningPeriod,aiResult,aiBusy,aiError,pending,staleAi,canAnalyze,refresh,openDaily,openPeriod,openSettings,openSetup,skipSetup,toggleAccount,saveSettings,saveDaily,savePeriod,periodShortcut,removePeriod,restorePeriod,removeDaily,restoreDaily,closeSheet,beforeLeave,runAi}=c;
const author=computed(()=>props.notebook.accounts.find(a=>a.userId===props.notebook.userId)?.name||'本人');
const selectedKind=computed(()=>home.value?dayKind(selectedDate.value,home.value):'');
const selectedKindLabel=computed(()=>({actual:'已记录经期',predicted:'预计经期',fertile:'预计易孕期',ovulation:'预计排卵日'}[selectedKind.value]||''));
const summary=computed(()=>dailySummary(daily.value).map(label=>['开心','平静','低落','烦躁','焦虑'].includes(label)?'心情'+label:label));
const updatedInfo=(value:{updatedBy:string;updatedAt:number})=>cycleUpdatedLabel(value,props.notebook.accounts);
const dailyUpdated=computed(()=>daily.value?updatedInfo(daily.value):'');
const deletedPeriods=computed(()=>profile.value?.periods.filter(row=>row.deletedAt!==null).sort((a,b)=>b.start.localeCompare(a.start))||[]);
const deletedDaily=computed(()=>profile.value?.daily.filter(row=>row.deletedAt!==null).sort((a,b)=>b.date.localeCompare(a.date))||[]);
const showDeleted=computed(()=>deletedPeriods.value.length+deletedDaily.value.length>0);
const currentPeriod=computed(()=>periods.value.find(row=>row.start<=today.value&&(!row.end||row.end>=today.value)));
const sheetTitle=computed(()=>sheet.value==='daily'?'记录这一天':sheet.value==='settings'?'周期设置':periodDraft.value?.id?'修改经期':'补录历史经期');
const editingPeriod=computed(()=>profile.value?.periods.find(row=>row.id===periodDraft.value?.id));
const format=(date:string)=>date?`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`:'';
const currentPeriodDay=computed(()=>currentPeriod.value?Math.round((Date.parse(today.value+'T00:00:00Z')-Date.parse(currentPeriod.value.start+'T00:00:00Z'))/86400000)+1:0);
const periodStatus=computed(()=>{const p=periods.value.find(row=>row.start<=selectedDate.value&&(!row.end||row.end>=selectedDate.value));return !p?'unrecorded':p.start===selectedDate.value?'started':p.end===selectedDate.value?'ended':'ongoing';});
const pageTitle=computed(()=>view.value==='setup'?'开始经期记录':view.value==='analysis'?'周期分析':view.value==='history'?'经期记录':'智能分析');
async function changeView(next:'calendar'|'setup'|'analysis'|'history'|'ai'){const stillCurrent=c.captureScope();if(sheet.value&&!await closeSheet())return;if(stillCurrent())view.value=next;}
function selectDate(date:string){selectedDate.value=date;if(date.slice(0,7)!==month.value.slice(0,7))month.value=date;}
function setStart(event:{detail:{value:string}}){if(periodDraft.value)periodDraft.value.start=event.detail.value;}
function setEnd(event:{detail:{value:string}}){if(periodDraft.value)periodDraft.value.end=event.detail.value;}
async function backInCycle(){const stillCurrent=c.captureScope();if(await beforeLeave()&&stillCurrent())view.value=view.value==='ai'||view.value==='history'?'analysis':'calendar';}
async function handleBack():Promise<boolean>{const stillCurrent=c.captureScope(),hadSheet=!!sheet.value;if(!await beforeLeave()||!stillCurrent())return true;if(hadSheet)return true;if(view.value!=='calendar'){view.value=view.value==='ai'||view.value==='history'?'analysis':'calendar';return true;}return false;}
async function openSettingsHistory(){const stillCurrent=c.captureScope();if(await closeSheet()&&stillCurrent())view.value='history';}
async function addFromSettings(){const stillCurrent=c.captureScope();if(await closeSheet()&&stillCurrent())openPeriod();}
defineExpose({beforeLeave,handleBack,busy,view,pause:c.pause,resume:c.resume});
onUnmounted(c.dispose);
</script>
<template>
  <view class="cy-root cy-panel" :class="{'cy-standalone':view!=='calendar'}">
    <view v-if="view!=='calendar'" class="cy-page-header"><button class="cy-icon" aria-label="返回" :disabled="busy" @tap="backInCycle">‹</button><text class="cy-page-title">{{pageTitle}}</text><button v-if="view==='analysis'" class="cy-link cy-header-action" :disabled="busy" @tap="changeView('history')">历史记录</button><button v-else-if="view==='history'" class="cy-link cy-header-action" :disabled="busy" @tap="openPeriod()">＋ 补录</button><view v-else class="cy-header-action"/></view>
    <scroll-view scroll-y enhanced :show-scrollbar="false" class="cy-scroll" :class="{'cy-calendar-scroll':view==='calendar'}">
    <view v-if="loading&&!home" class="cy-empty">正在打开经期记录…</view>
    <view v-if="error&&!sheet" class="cy-error" role="alert">{{error}}<button v-if="!home" class="cy-link" :disabled="loading" @tap="refresh">重新加载</button></view>
    <template v-if="home">
      <CycleSettingsForm v-if="view==='setup'&&settingsDraft" :value="settingsDraft" :home="notebook" :today="today" :setup="true" :busy="busy" @account="toggleAccount" @save="saveSettings(true)" @skip="skipSetup"/>
      <template v-else-if="view==='calendar'">
        <view v-if="!profile" class="cy-card cy-welcome"><text class="cy-heading">慢慢了解身体的节奏</text><text class="cy-help">启用后，共同记录经期、身体感受与备孕日常。只在页面显示提示，不发送主动提醒。</text><button class="cy-primary" :disabled="busy" @tap="openSetup">开始经期记录</button></view>
        <template v-else>
          <view class="cy-hero" :class="{'cy-with-orbit':!!home.prediction}">
            <text class="cy-eyebrow">{{currentPeriod?'本次经期':home.prediction?.daysUntil!==undefined&&home.prediction.daysUntil<0?'尚未记录新的经期':'距离预计下次经期'}}<text v-if="home.prediction?.preliminary"> · 初步估算</text></text>
            <view v-if="currentPeriod" class="cy-countdown">第 <text class="cy-big">{{currentPeriodDay}}</text> 天</view>
            <view v-else-if="home.prediction&&home.prediction.daysUntil>=0" class="cy-countdown">还有 <text class="cy-big">{{home.prediction.daysUntil}}</text> 天</view>
            <view v-else-if="home.prediction" class="cy-countdown">已过预计日期 <text class="cy-big">{{Math.abs(home.prediction.daysUntil)}}</text> 天</view>
            <view v-else class="cy-countdown"><text class="cy-hero-state">{{profile.settings.predictionPaused?'预测已暂停':'慢慢了解自己的周期'}}</text></view>
            <text class="cy-hero-date">{{home.prediction?`预计 ${format(home.prediction.start)}${home.prediction.end?' – '+format(home.prediction.end):'开始'}`:currentPeriod?`${format(currentPeriod.start)}开始`:home.predictionReason}}</text>
            <text v-if="home.prediction" class="cy-phase">✧ 预计易孕期 · {{format(home.prediction.fertileStart)}} – {{format(home.prediction.fertileEnd)}}</text>
            <view v-if="home.prediction" class="cy-orbit"><view class="cy-orbit-content"><text>本周期</text><text class="cy-orbit-number">第 {{home.prediction.cycleDay}} 天</text></view></view>
          </view>
          <text v-if="home.prediction" class="cy-help">{{home.predictionReason}}</text>
        </template>
        <CycleCalendar :home="home" :month="month" :selected="selectedDate" :busy="busy" @month="month=$event" @select="selectDate" @analysis="changeView('analysis')"/>
        <view class="cy-row cy-section-head"><view>{{dateLabel(selectedDate)}}<text v-if="selectedDate===today" class="cy-date-note">今天</text></view><button class="cy-link" :disabled="busy||loading||selectedDate>today" @tap="profile?openDaily(selectedDate):openSetup()">{{daily?'编辑':'记录'}} <text class="cy-pencil">✎</text></button></view>
        <view class="cy-card cy-day-card"><view v-if="summary.length" class="cy-options"><text v-for="label in summary" :key="label" class="cy-record-chip" :class="{'cy-record-test':label.startsWith('试纸')}">{{label}}</text></view><text v-else class="cy-empty-inline">{{selectedDate>today?'这一天可以查看预测':'这一天还没有记录'}}</text><text v-if="daily" class="cy-meta">♧ {{dailyUpdated}} · 双方可编辑</text><text v-else class="cy-meta">{{selectedKindLabel||'身体状态、心情和备孕记录，都可以记在这里'}}</text></view>
        <text class="cy-help cy-disclaimer">经期与易孕期预测仅供参考，不作为避孕依据。</text>
      </template>
      <template v-else-if="view==='analysis'&&profile">
        <CycleAnalysis :home="home"><template #smart><view class="cy-ai-entry"><view><text class="cy-section-title">✧ 让记录更有帮助</text><text class="cy-help">读懂周期变化，看看关怀与备孕建议</text></view><button class="cy-primary" :disabled="aiBusy||(!canAnalyze&&!pending&&!aiResult)" @tap="runAi()">{{pending?'查询原任务':aiResult?.status==='succeeded'?(staleAi?'查看上次分析':'查看分析'):'智能分析'}}</button></view><text v-if="!canAnalyze&&!pending" class="cy-help cy-ai-unavailable">{{home.aiAvailable?'至少记录两次经期开始日期后可分析。':'智能分析暂不可用，基础统计仍可查看。'}}</text></template></CycleAnalysis>
        <button class="cy-card cy-history-link" :disabled="busy" @tap="changeView('history')"><view><text>全部经期记录</text><text class="cy-help">可补录、修改，预测会随记录更新</text></view><text class="cy-chevron">›</text></button><text class="cy-help cy-disclaimer">统计基于已记录数据；未结束的经期不计入平均经期。</text>
      </template>
      <template v-else-if="view==='history'&&profile">
        <view class="cy-row cy-section-head"><text>已记录 {{periods.length}} 次经期</text><button class="cy-link" :disabled="busy" @tap="openPeriod()">＋ 补录</button></view><view v-if="!periods.length" class="cy-card cy-empty">还没有经期记录</view><view class="cy-history"><button v-for="period in periods" :key="period.id" class="cy-history-row" :disabled="busy" @tap="openPeriod(period)"><view><text class="cy-section-title">{{period.start}} – {{period.end||'未结束'}}</text><text class="cy-help">{{updatedInfo(period)}}</text></view><text class="cy-muted">›</text></button></view><text class="cy-help">开始日期用于计算周期，起止日期用于计算经期持续时间。删除经期不会删除这几天的每日记录。</text>
        <text class="cy-section-head cy-block">每日记录</text><view v-if="!profile.daily.some(row=>row.deletedAt===null)" class="cy-empty">还没有每日记录</view><button v-for="row in profile.daily.filter(d=>d.deletedAt===null).sort((a,b)=>b.date.localeCompare(a.date))" :key="row.date" class="cy-history-row" :disabled="busy" @tap="openDaily(row.date)"><view><text>{{row.date}}</text><text class="cy-help">{{dailySummary(row).join(' · ')||'未填写选项'}}</text><text class="cy-help">{{updatedInfo(row)}}</text></view><text>›</text></button>
        <view v-if="showDeleted" class="cy-card"><text class="cy-section-title">已删除，可恢复</text><view v-for="period in deletedPeriods" :key="period.id" class="cy-recover-row"><view><text class="cy-small">经期 · {{period.start}} – {{period.end||'未结束'}}</text><text class="cy-help">{{updatedInfo(period)}}</text></view><button class="cy-link" :disabled="busy" @tap="restorePeriod(period)">恢复</button></view><view v-for="row in deletedDaily" :key="row.date" class="cy-recover-row"><view><text class="cy-small">每日记录 · {{row.date}}</text><text class="cy-help">{{updatedInfo(row)}}</text></view><button class="cy-link" :disabled="busy" @tap="restoreDaily(row.date)">恢复</button></view></view>
      </template>
      <CycleAi v-else-if="view==='ai'" :result="aiResult" :busy="aiBusy" :error="aiError" :stale="staleAi" :pending="pending" :available="canAnalyze" :hide-action="true" @run="runAi"/>
    </template>
    </scroll-view>
    <view v-if="home&&view==='calendar'" class="cy-dock"><button class="cy-secondary" :disabled="busy||loading" @tap="profile?openSettings():openSetup()">周期设置</button><button class="cy-primary" :disabled="busy||loading||selectedDate>today" @tap="profile?openDaily(selectedDate):openSetup()">＋ {{selectedDate===today?'记录今天':'记录'+format(selectedDate)}}</button></view>
    <view v-if="home&&view==='ai'&&!pending" class="cy-dock cy-ai-dock"><button class="cy-primary" :disabled="aiBusy||!canAnalyze" @tap="runAi(true)">✧ {{aiResult?'重新分析':'开始智能分析'}}</button></view>
    <NotebookSheet v-if="sheet" :title="sheetTitle" :busy="busy" variant="cycle" @close="closeSheet"><view class="cy-root cy-sheet-content"><view v-if="error" class="cy-error" role="alert">{{error}}</view><CycleDailyForm v-if="sheet==='daily'&&dailyDraft" :value="dailyDraft" :busy="busy" :existing="!!daily" :running="!!runningPeriod" :period-status="periodStatus" :author="author" @save="saveDaily" @remove="removeDaily(dailyDraft.date)" @start="periodShortcut('start')" @end="periodShortcut('end')"/><CycleSettingsForm v-if="sheet==='settings'&&settingsDraft" :value="settingsDraft" :home="notebook" :today="today" :setup="false" :busy="busy" @account="toggleAccount" @save="saveSettings(false)" @history="openSettingsHistory" @add-period="addFromSettings"/>
      <view v-if="sheet==='period'&&periodDraft" class="cy-form"><view class="cy-field"><text>开始日期</text><picker mode="date" :value="periodDraft.start||today" :end="today" :disabled="busy" @change="setStart"><view class="cy-picker">{{periodDraft.start||'请选择'}} ›</view></picker></view><view class="cy-field"><text>结束日期 <text class="cy-muted cy-small">选填</text></text><picker mode="date" :value="periodDraft.end||today" :start="periodDraft.start||undefined" :end="today" :disabled="busy" @change="setEnd"><view class="cy-picker">{{periodDraft.end||'未结束'}} ›</view></picker><button v-if="periodDraft.end" class="cy-link" :disabled="busy" @tap="periodDraft.end=''">清空</button></view><text class="cy-help">未结束时可留空。保存后更新日历、统计和预测。</text><button v-if="editingPeriod" class="cy-danger" :disabled="busy" @tap="removePeriod(editingPeriod)">删除这次经期记录</button></view>
    </view><template #footer><view class="cy-root cy-sheet-footer"><button class="cy-primary" :disabled="busy" @tap="sheet==='daily'?saveDaily():sheet==='settings'?saveSettings(false):savePeriod()">{{busy?'正在保存…':'保存记录'}}</button></view></template></NotebookSheet>
  </view>
</template>
