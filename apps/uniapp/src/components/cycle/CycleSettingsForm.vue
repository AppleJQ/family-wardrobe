<script setup lang="ts">
import { ref } from 'vue';
import type { NotebookHome } from '../../services/notebook';
import type { CycleSettingsDraft } from '../../services/use-cycle';
const props=defineProps<{value:CycleSettingsDraft;home:NotebookHome;today:string;setup:boolean;busy:boolean}>();
const emit=defineEmits<{account:[id:string];save:[];skip:[];history:[];addPeriod:[]}>();
const showSharing=ref(false);
function selectMember(event:{detail:{value:string|number}}){props.value.memberId=props.home.members[Number(event.detail.value)]?.id||'';}
const chooseStart=(event:{detail:{value:string}})=>{props.value.start=event.detail.value;};
const chooseEnd=(event:{detail:{value:string}})=>{props.value.end=event.detail.value;};
</script>
<template>
  <view class="cy-form cy-settings-form">
    <view v-if="setup" class="cy-onboard"><view class="cy-onboard-icon">♡</view><text class="cy-heading">一起，记住身体的节奏</text><text class="cy-help">先记下最近一次经期。<br/>不确定的内容，可以以后慢慢补充。</text></view>
    <view class="cy-settings-fields"><template v-if="setup"><view class="cy-field"><text>最近一次开始日期</text><picker mode="date" :value="value.start||today" :end="today" :disabled="busy" @change="chooseStart"><view class="cy-picker">{{value.start||'不确定'}} ›</view></picker><button v-if="value.start" class="cy-link" :disabled="busy" @tap="value.start='';value.end=''">清空</button></view><view class="cy-field"><text>结束日期 <text class="cy-muted cy-small">选填</text></text><picker mode="date" :value="value.end||today" :start="value.start||undefined" :end="today" :disabled="busy" @change="chooseEnd"><view class="cy-picker">{{value.end||'未结束 / 不确定'}} ›</view></picker><button v-if="value.end" class="cy-link" :disabled="busy" @tap="value.end=''">清空</button></view></template>
    <view class="cy-field"><text>平时周期 <text class="cy-field-unit">天</text></text><input v-model="value.cycleLength" type="number" maxlength="2" placeholder="不确定" :disabled="busy"/></view><view class="cy-field"><text>经期持续 <text class="cy-field-unit">天</text></text><input v-model="value.periodLength" type="number" maxlength="2" placeholder="不确定" :disabled="busy"/></view></view>
    <text v-if="setup" class="cy-help cy-settings-help">已有历史记录？开始后可以继续补录，帮助更新预测。<br/>数据较少时，页面会标注“初步估算”。</text>
    <view v-if="setup" class="cy-field cy-member-field"><text>经期属于谁</text><picker mode="selector" :range="home.members" range-key="name" :disabled="busy" @change="selectMember"><view class="cy-picker">{{home.members.find(m=>m.id===value.memberId)?.name||'请选择成员'}} ›</view></picker></view>
    <view v-if="setup&&!home.members.length" class="cy-help">请先到“我的家庭”添加成员，再启用经期记录。</view>
    <button class="cy-sharing-summary" :disabled="busy" @tap="showSharing=!showSharing"><text>♧ {{home.accounts.filter(a=>value.accessUserIds.includes(a.userId)).map(a=>a.name).join('与')}}共同查看和修改</text><text>›</text></button>
    <view v-if="showSharing" class="cy-sharing-options"><text class="cy-form-label">共同查看与修改</text><view class="cy-options"><button v-for="account in home.accounts" :key="account.userId" class="cy-option" :class="{chosen:value.accessUserIds.includes(account.userId)}" :disabled="busy||account.userId===home.userId" @tap="emit('account',account.userId)">{{account.name}}{{account.userId===home.userId?'（本人）':''}}</button></view><text class="cy-help">最多两人，必须包含本人；可以先一个人启用，以后再加入另一方。</text></view>
    <template v-if="!setup"><button class="cy-field cy-settings-row" :disabled="busy" @tap="emit('history')"><text>历史经期</text><text>›</text></button><button class="cy-field cy-settings-row" :disabled="busy" @tap="emit('addPeriod')"><text>补录历史经期</text><text>＋</text></button><text class="cy-help">已记录的数据优先用于预测。参考周期15–60天，经期持续1–20天，不确定可留空。</text><text class="cy-form-label">预测状态</text><view class="cy-options"><button class="cy-option" :class="{chosen:!value.predictionPaused}" :disabled="busy" @tap="value.predictionPaused=false">开启预测</button><button class="cy-option" :class="{chosen:value.predictionPaused}" :disabled="busy" @tap="value.predictionPaused=true">暂停预测</button></view><text class="cy-help">孕期、哺乳期或暂不需要预测时可暂停，仍可记录和回看。</text></template>
    <button v-if="setup" class="cy-primary cy-full" :disabled="busy||!home.members.length" @tap="emit('save')">{{busy?'正在保存…':'开始记录  →'}}</button><button v-if="setup" class="cy-skip" :disabled="busy" @tap="emit('skip')">先看看，稍后填写</button>
  </view>
</template>
