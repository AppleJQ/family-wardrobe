<script setup lang="ts">
import { computed } from 'vue';
import type { NotebookEntry, NotebookHome } from '../../services/notebook';
import NotebookSheet from './NotebookSheet.vue';
import { dateLabel, participantNames } from '../../services/notebook-state';
import { isWechat } from '../../platform/runtime';
import { androidReminderState, canEnableNotebookReminder, supportsAndroidReminders } from '../../services/android-reminders';
const props=defineProps<{entry:NotebookEntry;home:NotebookHome;entries:NotebookEntry[];busy:boolean}>();
const emit=defineEmits<{close:[];edit:[];remove:[];copy:[];toggle:[id:string,done:boolean];open:[entry:NotebookEntry];trash:[];subscribe:[]}>();
const accountName=(id:string)=>props.home.accounts.find(a=>a.userId===id)?.name||'家庭成员';
const memberName=computed(()=>props.home.members.find(m=>m.id===props.entry.noteMemberId)?.name||'');
const linkedList=computed(()=>props.entries.find(e=>e.id===props.entry.listId));
const linkedNote=computed(()=>props.entries.find(e=>e.id===props.entry.noteId));
const related=computed(()=>props.entries.filter(e=>e.kind==='event'&&e.status==='active'&&(e.listId===props.entry.id||e.noteId===props.entry.id)));
const completed=computed(()=>props.entry.items.filter(i=>i.done).length);
const date=(time:number)=>new Date(time+8*3600000).toISOString().slice(0,10);
const hasReminder=computed(()=>props.entry.reminderMinutes!==null&&!!props.entry.startTime);
const canSubscribe=computed(()=>canEnableNotebookReminder(props.entry,props.home.userId));
const androidSupported=supportsAndroidReminders();
const reminderHint=computed(()=>{
  if(isWechat)return props.home.capabilities.wechatReminder?'微信与 Android 提醒可同时开启；微信需本人订阅，每次授权以微信实际结果为准':'微信提醒尚未开通，日程已保存';
  if(!androidSupported)return '当前平台暂不支持通知提醒，可在微信小程序订阅';
  if(androidReminderState.userId===props.home.userId&&androidReminderState.familyId===props.home.familyId&&androidReminderState.message)return androidReminderState.message;
  return '可开启我的 Android 提醒；厂商离线通道尚未开通，应用关闭或锁屏后可能无法收到';
});
function preview(url:string){uni.previewImage({current:url,urls:props.entry.images.map(i=>i.url)});}
</script>
<template>
  <NotebookSheet :title="entry.title" :busy="busy" @close="emit('close')">
    <text class="nb-caption nb-block nb-detail-meta">夫妻共享 · {{entry.kind==='note'&&memberName?memberName+' · ':''}}{{accountName(entry.updatedBy)}}更新 · {{date(entry.updatedAt)}}</text>
    <template v-if="entry.kind==='event'">
      <view class="nb-detail-row"><text>日期</text><view>{{dateLabel(entry.date)}}<text class="nb-block">{{entry.startTime||'时间待定'}}{{entry.endTime?' — '+entry.endTime:''}}</text></view></view>
      <view class="nb-detail-row"><text>参与人</text><view>{{participantNames(entry,home).join('、')}}</view></view>
      <view v-if="entry.place" class="nb-detail-row"><text>地点</text><view>{{entry.place}}</view></view>
      <view class="nb-detail-row"><text>状态</text><view>{{entry.eventState==='cancelled'?'已取消':entry.eventState==='completed'?'已完成':'已安排'}}</view></view>
      <view class="nb-detail-row"><text>提醒</text><view>{{hasReminder?(entry.reminderMinutes===0?'日程开始时':'提前'+entry.reminderMinutes+'分钟'):'不提醒'}}<text v-if="hasReminder" class="nb-caption nb-block">{{reminderHint}}</text></view></view>
      <button v-if="canSubscribe&&(isWechat||androidSupported)" class="nb-secondary" :disabled="busy" @tap="emit('subscribe')">{{isWechat?'管理我的微信提醒':'管理我的 Android 提醒'}}</button>
      <view v-if="entry.listId" class="nb-field"><text>关联清单</text><button v-if="linkedList&&linkedList.status==='active'" class="nb-link-card" :disabled="busy" @tap="emit('open',linkedList)"><text>{{linkedList.title}}</text><text class="nb-caption">{{linkedList.items.filter(i=>i.done).length}}/{{linkedList.items.length}} 已完成 ›</text></button><button v-else class="nb-link-card" @tap="emit('trash')">关联清单已移入回收站，恢复后继续使用 ›</button></view>
      <view v-if="entry.noteId" class="nb-field"><text>关联笔记</text><button v-if="linkedNote&&linkedNote.status==='active'" class="nb-link-card" @tap="emit('open',linkedNote)">{{linkedNote.title}} ›</button><button v-else class="nb-link-card" @tap="emit('trash')">关联笔记已移入回收站 ›</button></view>
    </template>
    <template v-if="entry.kind==='list'">
      <text class="nb-caption nb-block">{{completed}}/{{entry.items.length}} 已完成</text>
      <view v-for="item in entry.items" :key="item.id" class="nb-check-row"><checkbox :checked="item.done" :disabled="busy" color="#456b53" @tap="emit('toggle',item.id,!item.done)"/><text :class="{done:item.done}" @tap="!busy&&emit('toggle',item.id,!item.done)">{{item.text}}</text><text v-if="item.done" class="nb-caption">{{accountName(item.completedBy)}}已完成</text></view>
      <button class="nb-text-button" :disabled="busy" @tap="emit('edit')">＋ 添加或编辑条目</button>
    </template>
    <text v-if="entry.body" class="nb-note-body">{{entry.body}}</text>
    <view v-if="entry.images.length" class="nb-detail-images"><image v-for="image in entry.images" :key="image.id" :src="image.url" mode="widthFix" @tap="preview(image.url)" /></view>
    <view v-if="related.length" class="nb-field"><text>关联日程</text><button v-for="event in related" :key="event.id" class="nb-link-card" :disabled="busy" @tap="emit('open',event)">{{dateLabel(event.date)}} {{event.startTime}} · {{event.title}} ›</button></view>
    <view class="nb-action-row"><button v-if="entry.kind==='list'" class="nb-secondary" :disabled="busy" @tap="emit('copy')">复制为新清单</button><button class="nb-primary" :disabled="busy" @tap="emit('edit')">编辑{{entry.kind==='event'?'安排':entry.kind==='list'?'清单':'笔记'}}</button></view>
    <button class="nb-danger-light" :disabled="busy" @tap="emit('remove')">移入回收站</button>
  </NotebookSheet>
</template>
