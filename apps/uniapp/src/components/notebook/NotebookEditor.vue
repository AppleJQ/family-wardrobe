<script setup lang="ts">
import { computed, ref } from 'vue';
import type { NotebookEditor } from '../../services/use-notebook';
import type { NotebookEntry, NotebookHome, NotebookItem } from '../../services/notebook';
import NotebookSheet from './NotebookSheet.vue';
import { requestId, findConflicts, selectedMemberIds } from '../../services/notebook-state';
const props=defineProps<{value:NotebookEditor;home:NotebookHome;entries:NotebookEntry[];busy:boolean}>();
const emit=defineEmits<{close:[];save:[];images:[];newList:[]}>();
const lists=computed(()=>props.entries.filter(e=>e.kind==='list'&&e.status==='active'));
const notes=computed(()=>props.entries.filter(e=>e.kind==='note'&&e.status==='active'));
const conflicts=computed(()=>props.value.kind==='event'?findConflicts(props.value,props.entries):[]);
const reminders=[{label:'不提醒',value:null},{label:'提前15分钟',value:15},{label:'提前30分钟',value:30},{label:'提前1小时',value:60},{label:'提前1天',value:1440}];
const listLabel=computed(()=>lists.value.find(l=>l.id===props.value.listId)?.title||(props.value.listId?'关联清单已移入回收站':'不关联清单'));
const noteLabel=computed(()=>notes.value.find(n=>n.id===props.value.noteId)?.title||'不关联笔记');
const pickerIndex=(event:unknown)=>Number((event as {detail:{value:string}}).detail.value);
const switchValue=(event:unknown)=>(event as {detail:{value:boolean}}).detail.value;
const showEndTime=ref(Boolean(props.value.endTime));
const selectedParticipants=computed(()=>selectedMemberIds(props.value,props.home));
function selectParticipants(ids:string[]){props.value.participantMemberIds=ids;props.value.participantUserIds=props.home.accounts.filter(a=>ids.includes(a.memberId)).map(a=>a.userId);}
function participant(id:string){const ids=selectedParticipants.value.filter(value=>props.home.members.some(m=>m.id===value));selectParticipants(ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]);}
function addItem(){props.value.items=[...props.value.items,{id:requestId(),text:'',done:false,completedBy:'',completedAt:null}];}
function removeItem(item:NotebookItem){props.value.items=props.value.items.filter(row=>row.id!==item.id);}
function preview(url:string){uni.previewImage({current:url,urls:props.value.images.map(image=>image.url)});}
</script>
<template>
  <NotebookSheet :title="value.id?'编辑'+(value.kind==='event'?'安排':value.kind==='list'?'清单':'笔记'):(value.kind==='event'?'记一件小事':value.kind==='list'?'新建清单':'写一篇笔记')" :busy="busy" @close="emit('close')">
    <view class="nb-field"><text>{{value.kind==='event'?'做什么':'标题'}}</text><input v-model="value.title" class="nb-input" :disabled="busy" maxlength="60" :placeholder="value.kind==='event'?'例如：一起去看家具':'给这件事起个名字'" /></view>
    <template v-if="value.kind==='event'">
      <view class="nb-two-fields nb-datetime"><view class="nb-field"><text>日期</text><picker mode="date" :value="value.date" :disabled="busy" @change="value.date=($event.detail.value as string)"><view class="nb-input">{{value.date.replace(/-/g,'/')}}</view></picker></view><view class="nb-field"><text>开始时间</text><picker mode="time" :value="value.startTime||'14:00'" :disabled="busy" @change="value.startTime=($event.detail.value as string)"><view class="nb-input">{{value.startTime||'时间待定'}}</view></picker></view></view>
      <view v-if="value.startTime&&showEndTime" class="nb-field"><view class="nb-row"><text>结束时间 · 可选</text><button class="nb-text-button" :disabled="busy" @tap="value.endTime='';showEndTime=false">移除</button></view><picker mode="time" :value="value.endTime||value.startTime" :disabled="busy" @change="value.endTime=($event.detail.value as string)"><view class="nb-input">{{value.endTime||'选择结束时间'}}</view></picker></view>
      <view class="nb-field"><text>谁参加</text><view class="nb-person-options"><button v-for="member in home.members" :key="member.id" :disabled="busy" :class="{chosen:selectedParticipants.includes(member.id)}" @tap="participant(member.id)">{{member.name}}</button><button v-if="home.members.length>1" :disabled="busy" :class="{chosen:home.members.every(m=>selectedParticipants.includes(m.id))}" @tap="selectParticipants(home.members.map(m=>m.id))">一起</button></view></view>
      <view class="nb-field"><text>地点 · 可选</text><input v-model="value.place" class="nb-input" :disabled="busy" maxlength="120" placeholder="在哪里见" /></view>
      <view v-if="value.startTime" class="nb-field"><text>提醒</text><picker :range="reminders" range-key="label" :value="Math.max(0,reminders.findIndex(r=>r.value===value.reminderMinutes))" :disabled="busy" @change="value.reminderMinutes=reminders[pickerIndex($event)].value"><view class="nb-input nb-select"><text>{{reminders.find(r=>r.value===value.reminderMinutes)?.label||'不提醒'}}</text><view class="nb-picker-chevron" aria-hidden="true" /></view></picker><text class="nb-caption">仅提醒已绑定账号的参与人，通知需本人开启。</text></view>
      <view class="nb-field"><view class="nb-row"><text>关联清单 · 可选</text><button class="nb-text-button" :disabled="busy" @tap="emit('newList')">＋ 新建清单</button></view><picker :range="['不关联清单',...lists.map(l=>l.title)]" :disabled="busy" :value="Math.max(0,lists.findIndex(l=>l.id===value.listId)+1)" @change="value.listId=lists[pickerIndex($event)-1]?.id||''"><view class="nb-input nb-select nb-list-picker"><text>{{listLabel}}</text><view class="nb-picker-chevron" aria-hidden="true" /></view></picker></view>
      <view class="nb-field"><text>关联笔记 · 可选</text><picker :range="['不关联笔记',...notes.map(n=>n.title)]" :disabled="busy" :value="Math.max(0,notes.findIndex(n=>n.id===value.noteId)+1)" @change="value.noteId=notes[pickerIndex($event)-1]?.id||''"><view class="nb-input nb-select"><text>{{noteLabel}}</text><view class="nb-picker-chevron" aria-hidden="true" /></view></picker></view>
      <view v-if="value.id" class="nb-field"><text>状态</text><view class="nb-person-options"><button v-for="status in [{id:'planned',label:'待安排'},{id:'completed',label:'已完成'},{id:'cancelled',label:'已取消'}]" :key="status.id" :disabled="busy" :class="{chosen:value.eventState===status.id}" @tap="value.eventState=(status.id as NotebookEntry['eventState'])">{{status.label}}</button></view></view>
      <view v-if="conflicts.length" class="nb-notice">与“{{conflicts.map(e=>e.title).join('、')}}”时间重叠，保存时需要确认。</view>
    </template>
    <view v-if="value.kind==='note'" class="nb-field"><text>关于谁</text><picker :range="home.members" range-key="name" :value="Math.max(0,home.members.findIndex(m=>m.id===value.noteMemberId))" :disabled="busy" @change="value.noteMemberId=home.members[pickerIndex($event)]?.id||''"><view class="nb-input">{{home.members.find(m=>m.id===value.noteMemberId)?.name||'请选择家庭成员'}}</view></picker></view>
    <template v-if="value.kind==='list'"><view v-for="(item,index) in value.items" :key="item.id" class="nb-edit-item"><text class="nb-caption">{{index+1}}</text><input v-model="item.text" class="nb-input" :disabled="busy" maxlength="200" placeholder="要做的事"/><button class="nb-icon" :disabled="busy" aria-label="删除条目" @tap="removeItem(item)">×</button></view><button class="nb-text-button" :disabled="busy||value.items.length>=100" @tap="addItem">＋ 添加一项</button></template>
    <view class="nb-field"><text>{{value.kind==='note'?'内容':'备注 · 可选'}}</text><textarea v-model="value.body" class="nb-input nb-textarea" :disabled="busy" maxlength="12000" auto-height placeholder="想记下来的，都写在这里" /></view>
    <template v-if="value.kind==='note'"><view class="nb-image-grid"><view v-for="image in value.images" :key="image.id" class="nb-image-cell"><image :src="image.url" mode="aspectFill" @tap="preview(image.url)" /><button class="nb-image-remove" :disabled="busy" aria-label="移除照片" @tap.stop="value.images=value.images.filter(i=>i.id!==image.id)">×</button></view></view><button class="nb-text-button" :disabled="busy||value.images.length>=6" @tap="emit('images')">＋ 添加图片</button><view class="nb-row nb-field"><text>置顶笔记</text><switch :checked="value.pinned" :disabled="busy" color="#456b53" @change="value.pinned=switchValue($event)" /></view></template>
    <button class="nb-primary nb-save" :loading="busy" :disabled="busy" @tap="emit('save')">{{value.kind==='event'?'保存安排':value.kind==='list'?'保存清单':'保存笔记'}}</button>
  </NotebookSheet>
</template>
