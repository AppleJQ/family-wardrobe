<script setup lang="ts">
import type { CycleDailyInput, CycleSymptom } from '../../services/cycle';
import { cycleLabels, toggleSymptom } from '../../services/cycle-core-client';
import { dateLabel } from '../../services/notebook-state';
const props=defineProps<{value:CycleDailyInput;busy:boolean;existing:boolean;running:boolean;periodStatus?:'unrecorded'|'started'|'ongoing'|'ended';author:string}>();
const emit=defineEmits<{save:[];remove:[];start:[];end:[]}>();
const flows=Object.entries(cycleLabels.flow) as [Exclude<CycleDailyInput['flow'],''>,string][];
const symptoms=Object.entries(cycleLabels.symptoms) as [CycleSymptom,string][];
const moods=Object.entries(cycleLabels.mood) as [Exclude<CycleDailyInput['mood'],''>,string][];
const tests=Object.entries(cycleLabels.ovulationTest) as [Exclude<CycleDailyInput['ovulationTest'],''>,string][];
function symptom(value:CycleSymptom){props.value.symptoms=toggleSymptom(props.value.symptoms,value);}
</script>
<template>
  <view class="cy-form cy-daily-form"><view class="cy-row cy-daily-date"><text>{{dateLabel(value.date)}}</text><text>全部选填</text></view>
    <view class="cy-form-section"><text class="cy-form-label">经期状态</text><view class="cy-options"><text class="cy-option period" :class="{chosen:!periodStatus||periodStatus==='unrecorded'}">未记录</text><button class="cy-option period" :class="{chosen:periodStatus==='started'}" :disabled="busy" @tap="emit('start')">来了</button><text class="cy-option period" :class="{chosen:periodStatus==='ongoing'}">进行中</text><button class="cy-option period" :class="{chosen:periodStatus==='ended'}" :disabled="busy||!running" @tap="emit('end')">结束了</button></view></view>
    <view class="cy-form-section"><text class="cy-form-label">经量</text><view class="cy-options"><button v-for="[key,label] in flows" :key="key" class="cy-option" :class="{chosen:value.flow===key}" :disabled="busy" @tap="value.flow=value.flow===key?'':key">{{label}}</button></view></view>
    <view class="cy-form-section"><text class="cy-form-label">身体感受</text><view class="cy-options"><button v-for="[key,label] in symptoms" :key="key" class="cy-option" :class="{chosen:value.symptoms.includes(key)}" :disabled="busy" @tap="symptom(key)">{{label}}</button></view></view>
    <view class="cy-form-section"><text class="cy-form-label">心情</text><view class="cy-options"><button v-for="[key,label] in moods" :key="key" class="cy-option" :class="{chosen:value.mood===key}" :disabled="busy" @tap="value.mood=value.mood===key?'':key">{{label}}</button></view></view>
    <view class="cy-form-section"><text class="cy-form-label">同房</text><view class="cy-options"><button class="cy-option" :class="{chosen:value.intimacy===true}" :disabled="busy" @tap="value.intimacy=value.intimacy===true?null:true">有</button><button class="cy-option" :class="{chosen:value.intimacy===false}" :disabled="busy" @tap="value.intimacy=value.intimacy===false?null:false">无</button></view></view>
    <view class="cy-form-section"><text class="cy-form-label">排卵试纸</text><view class="cy-options"><button v-for="[key,label] in tests" :key="key" class="cy-option test" :class="{chosen:value.ovulationTest===key}" :disabled="busy" @tap="value.ovulationTest=value.ovulationTest===key?'':key">{{label}}</button></view></view>
    <text class="cy-meta cy-daily-meta">♧ 双方都能编辑 · 本次以{{author}}身份记录</text><text class="cy-help cy-daily-help">经期起止单独确认保存，其余选填内容点底部保存。再次点已选项目可取消。</text>
    <button v-if="existing" class="cy-danger" :disabled="busy" @tap="emit('remove')">删除这一天的记录</button>
  </view>
</template>
