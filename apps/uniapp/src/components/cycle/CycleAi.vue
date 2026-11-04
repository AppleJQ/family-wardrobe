<script setup lang="ts">
import type { CycleAiResult } from '../../services/cycle';
defineProps<{result:CycleAiResult|null;busy:boolean;error:string;stale:boolean;pending:boolean;available:boolean;hideAction?:boolean}>();
const emit=defineEmits<{run:[newAnalysis:boolean]}>();
const generated=(time:number)=>time?new Date(time+8*3600000).toISOString().slice(0,16).replace('T',' '):'';
const date=(value:string)=>value?`${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`:'';
</script>
<template>
  <view class="cy-ai-head"><text class="cy-ai-mark">✧ 智能解读</text><text class="cy-heading">从记录里，了解自己</text><text class="cy-ai-description">一份关于周期、日常关怀与备孕的解读</text></view>
  <view v-if="stale" class="cy-notice">记录已更新，这份结果基于之前的数据。{{pending?'先查询原任务结果，再按最新记录重新分析。':'可按最新记录重新分析。'}}</view>
  <view v-if="error" class="cy-error" role="alert">{{error}}<text v-if="pending" class="cy-block">暂时无法确认完成状态，请查询原任务；不会重复发起分析。</text></view>
  <view v-if="busy||pending" class="cy-card cy-ai-loading" aria-live="polite"><text class="cy-ai-orbit" :class="{spinning:busy}">✧</text><text class="cy-section-title">{{busy?'正在整理你的记录…':result?.status==='running'?'分析仍在处理中':'等待确认分析结果'}}</text><text class="cy-help">梳理周期变化、身体感受与备孕记录。<br/>可以离开页面，回来后继续查询原任务。</text><button class="cy-secondary" :disabled="busy" @tap="emit('run',false)">{{busy?'正在查询…':'查询原任务'}}</button></view>
  <template v-if="result?.status==='succeeded'"><view class="cy-ai-scope"><text>分析依据 · {{date(result.range.start)}} – {{date(result.range.end)}}</text><text class="cy-block">{{result.range.cycles}} 个完整周期 · {{result.range.periods}} 次已结束经期 · {{result.range.dailyDays}} 天日常记录</text></view><view v-for="(section,index) in result.sections" :key="index" class="cy-card cy-ai-section"><text class="cy-section-title">{{section.title}}</text><text v-for="(paragraph,p) in section.content.split('\n').filter(Boolean)" :key="p" class="cy-ai-copy">{{paragraph}}</text></view><text class="cy-result-time">生成于 {{generated(result.generatedAt)}}</text></template>
  <view v-else-if="result?.status==='failed'" class="cy-card"><text class="cy-section-title">本次分析未完成</text><text class="cy-help">{{result.error||'请稍后重试。基础统计和记录仍可正常查看。'}}</text></view>
  <view v-else-if="!pending&&!busy" class="cy-card"><text class="cy-section-title">让每一次记录更有意义</text><text class="cy-help">结合经期、身体感受与备孕记录，整理一份有依据的解读与建议。至少记录两次经期开始日期后可分析。</text></view>
  <text class="cy-help cy-disclaimer">结果仅使用本次范围内的记录；未记录的信息不做推断。<br/>智能建议仅供参考，不替代医生诊断。</text><button v-if="!pending&&!hideAction" class="cy-primary cy-full" :disabled="busy||!available" @tap="emit('run',true)">{{result?'重新分析':'开始智能分析'}}</button><text v-if="!available&&!pending" class="cy-help">智能分析暂不可用或记录不足，基础统计仍可查看。</text>
</template>
