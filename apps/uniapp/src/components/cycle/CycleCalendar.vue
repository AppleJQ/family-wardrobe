<script setup lang="ts">
import { computed } from 'vue';
import type { CycleHome } from '../../services/cycle';
import { monthDays, shiftMonth, dateLabel } from '../../services/notebook-state';
import { dayKind } from '../../services/cycle-core-client';
const props=defineProps<{home:CycleHome;month:string;selected:string;busy:boolean}>();
const emit=defineEmits<{month:[date:string];select:[date:string];analysis:[]}>();
const days=computed(()=>monthDays(props.month));
const recorded=(date:string)=>props.home.profile?.daily.some(row=>row.date===date&&row.deletedAt===null);
</script>
<template>
  <view class="cy-toolbar"><view class="cy-month">{{Number(month.slice(5,7))}}月<text class="cy-year">{{month.slice(0,4)}}</text></view><view class="cy-month-nav"><button class="cy-icon" aria-label="上个月" :disabled="busy" @tap="emit('month',shiftMonth(month,-1))">‹</button><button class="cy-today" :disabled="busy" @tap="emit('month',home.today);emit('select',home.today)">今天</button><button class="cy-icon" aria-label="下个月" :disabled="busy" @tap="emit('month',shiftMonth(month,1))">›</button><button class="cy-link cy-analysis-link" :disabled="busy||!home.profile" @tap="emit('analysis')"><text class="cy-chart-symbol">▥</text> 分析</button></view></view>
  <view class="cy-calendar"><view class="cy-week"><text v-for="label in ['一','二','三','四','五','六','日']" :key="label">{{label}}</text></view><view class="cy-dates"><button v-for="day in days" :key="day.date" class="cy-date" :class="[dayKind(day.date,home),{'outside':!day.inMonth,'selected':selected===day.date,'is-today':home.today===day.date,'recorded':recorded(day.date)}]" :aria-label="dateLabel(day.date)+(dayKind(day.date,home)==='actual'?'，已记录经期':'')+(day.date===selected?'，已选择':'')" :disabled="busy" @tap="emit('select',day.date)">{{day.label}}</button></view><view class="cy-legend"><view><text class="cy-swatch actual"/>已记录经期</view><view><text class="cy-swatch predicted"/>预计经期</view><view><text class="cy-swatch fertile"/>预计易孕期</view><view><text class="cy-swatch ovulation"/>预计排卵日</view></view></view>
</template>
