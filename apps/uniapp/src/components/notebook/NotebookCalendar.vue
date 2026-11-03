<script setup lang="ts">
import { computed } from 'vue';
import type { NotebookEntry, NotebookHome } from '../../services/notebook';
import { monthDays, dateLabel, shiftMonth, weekendDates, beijingToday, selectedMemberIds, participantNames } from '../../services/notebook-state';
const props=defineProps<{date:string;weekend:boolean;filter:string;entries:NotebookEntry[];accounts:NotebookHome['accounts'];members:NotebookHome['members'];busy:boolean}>();
const emit=defineEmits<{select:[date:string];weekend:[value:boolean];filter:[id:string];open:[entry:NotebookEntry];add:[]}>();
const days=computed(()=>monthDays(props.date));
const dates=computed(()=>props.weekend?weekendDates():[props.date]);
const memberIds=(entry:NotebookEntry)=>selectedMemberIds(entry,props);
const events=(date:string)=>props.entries.filter(e=>e.kind==='event'&&e.status==='active'&&e.date===date&&(!props.filter||(props.filter==='__together'?memberIds(e).length>1:memberIds(e).includes(props.filter))))
  .sort((a,b)=>(a.startTime||'99').localeCompare(b.startTime||'99'));
const hasEvent=(date:string)=>props.entries.some(e=>e.kind==='event'&&e.status==='active'&&e.eventState!=='cancelled'&&e.date===date);
const participant=(entry:NotebookEntry)=>participantNames(entry,props).join('、');
const linkedList=(entry:NotebookEntry)=>props.entries.find(e=>e.id===entry.listId&&e.status==='active');
function pick(date:string){emit('select',date);emit('weekend',false);}
</script>
<template>
  <view class="nb-row nb-month-row"><view class="nb-month">{{Number(date.slice(5,7))}}月 <text>{{date.slice(0,4)}}</text></view><view class="nb-inline"><button class="nb-icon" aria-label="上个月" @tap="pick(shiftMonth(date,-1))">‹</button><button class="nb-mini" @tap="pick(beijingToday())">今天</button><button class="nb-mini" :class="{selected:weekend}" @tap="emit('select',weekendDates()[0]);emit('weekend',true)">本周末</button><button class="nb-icon" aria-label="下个月" @tap="pick(shiftMonth(date,1))">›</button></view></view>
  <view class="nb-calendar"><view class="nb-weekdays"><text v-for="d in ['一','二','三','四','五','六','日']" :key="d">{{d}}</text></view><view class="nb-days"><button v-for="day in days" :key="day.date" class="nb-day" :class="{outside:!day.inMonth,chosen:day.date===date,today:day.date===beijingToday(),weekend:weekend&&weekendDates().includes(day.date)}" :aria-label="day.date" @tap="pick(day.date)"><text>{{day.label}}</text><text v-if="hasEvent(day.date)" class="nb-date-dot">·</text></button></view></view>
  <view class="nb-filters"><button class="nb-filter" :class="{chosen:!filter}" @tap="emit('filter','')">全部</button><button v-for="member in members" :key="member.id" class="nb-filter" :class="{chosen:filter===member.id}" @tap="emit('filter',member.id)">{{member.name}}</button><button v-if="members.length>1" class="nb-filter" :class="{chosen:filter==='__together'}" @tap="emit('filter','__together')">一起</button></view>
  <view v-for="day in dates" :key="day" class="nb-day-section">
    <view class="nb-row"><view class="nb-section-title">{{dateLabel(day)}} <text class="nb-caption">{{events(day).length}} 个安排</text></view><button class="nb-text-button" :disabled="busy" @tap="emit('select',day);emit('add')">＋ 安排</button></view>
    <view v-if="!events(day).length" class="nb-empty">这天还没有安排</view>
    <button v-for="entry in events(day)" :key="entry.id" class="nb-event" :class="{cancelled:entry.eventState==='cancelled'}" :disabled="busy" @tap="emit('open',entry)">
      <view class="nb-time"><text>{{entry.startTime||'待定'}}</text><text class="nb-caption">{{entry.endTime}}</text></view>
      <view class="nb-event-card" :class="{together:memberIds(entry).length>1}"><view class="nb-row"><text class="nb-item-title">{{entry.title}}</text><text class="nb-badge">{{entry.eventState==='cancelled'?'已取消':entry.eventState==='completed'?'已完成':memberIds(entry).length>1?'一起':participant(entry)}}</text></view><text class="nb-caption nb-block">{{entry.place||'地点待定'}}</text><text v-if="linkedList(entry)" class="nb-linked">☷ {{linkedList(entry)!.title}} · {{linkedList(entry)!.items.filter(i=>i.done).length}}/{{linkedList(entry)!.items.length}} ›</text></view>
    </button>
  </view>
</template>
