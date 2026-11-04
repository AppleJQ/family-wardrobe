<script setup lang="ts">
import { computed } from 'vue';
import type { CycleHome } from '../../services/cycle';
const props=defineProps<{home:CycleHome}>();
const recent=computed(()=>props.home.statistics.cycles.slice(-6).reverse());
const latest=computed(()=>recent.value[0]);
const maximum=computed(()=>Math.max(...recent.value.map(v=>v.days),1)+3);
const durations=computed(()=>props.home.statistics.periods.slice(-6));
const maxDuration=computed(()=>Math.max(...durations.value.map(v=>v.days),8));
const date=(value:string)=>`${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`;
const comparison=computed(()=>{const diff=props.home.statistics.difference;return diff===null?'首个完整周期':diff===0?'与上个周期相同':`比上个周期${diff>0?'多':'少'} ${Math.abs(diff)} 天`;});
</script>
<template>
  <view class="cy-analysis-intro"><text class="cy-analysis-heading">了解自己的节奏</text><text class="cy-muted cy-small">最近 {{home.statistics.cycles.length}} 个完整周期</text></view>
  <view class="cy-summary">
    <view><text class="cy-summary-label">平均周期</text><view class="cy-metric">{{home.statistics.averageCycle??'—'}}<text class="cy-unit">天</text></view></view>
    <view><text class="cy-summary-label">平均经期</text><view class="cy-metric">{{home.statistics.averagePeriod??'—'}}<text class="cy-unit">天</text></view></view>
    <view><text class="cy-summary-label">周期范围</text><view class="cy-metric cy-range">{{home.statistics.shortest===null?'—':`${home.statistics.shortest}–${home.statistics.longest}`}}<text class="cy-unit">天</text></view></view>
  </view>
  <slot name="smart" />
  <view class="cy-card cy-cycle-changes"><text class="cy-section-title">周期变化</text><text class="cy-card-sub">{{latest?`最近一次 · ${date(latest.start)} – ${date(latest.end)}`:'至少记录两次经期开始日期后，可查看周期变化。'}}</text>
    <view v-if="latest" class="cy-comparison"><view class="cy-comparison-number">{{latest.days}}<text class="cy-unit">天</text></view><text class="cy-comparison-note">{{comparison}}</text></view>
    <view v-else class="cy-empty">每一次记录，都有意义</view>
    <view class="cy-bars"><view v-for="(row,index) in recent" :key="row.start" class="cy-chart-row"><text class="cy-chart-label">{{date(row.start)}}</text><view class="cy-chart-track"><view class="cy-chart-bar" :class="{'cy-chart-latest':index===0}" :style="{width:(row.days/maximum*100)+'%'}"/></view><text class="cy-chart-days">{{row.days}}天</text></view></view>
  </view>
  <view class="cy-card cy-period-changes"><view class="cy-row"><text class="cy-section-title">经期持续时间</text><text class="cy-muted cy-small">最近 {{durations.length}} 次</text></view>
    <view v-if="!durations.length" class="cy-empty">补充结束日期后，可回看持续天数。</view>
    <view v-else class="cy-duration-chart"><view v-for="row in durations" :key="row.start" class="cy-duration-column"><text class="cy-duration-value">{{row.days}}天</text><view class="cy-duration-bar" :style="{height:(row.days/maxDuration*64)+'px'}"/><text class="cy-duration-label">{{Number(row.start.slice(5,7))}}月</text></view></view>
  </view>
</template>
