<script setup lang="ts">
import { computed } from 'vue';
import { useNotebook } from '../../services/use-notebook';
import { dateLabel } from '../../services/notebook-state';
import NotebookCalendar from '../../components/notebook/NotebookCalendar.vue';
import NotebookEditor from '../../components/notebook/NotebookEditor.vue';
import NotebookDetail from '../../components/notebook/NotebookDetail.vue';
import NotebookAi from '../../components/notebook/NotebookAi.vue';
import NotebookSheet from '../../components/notebook/NotebookSheet.vue';
import type { NotebookEntry } from '../../services/notebook';
import { APP_ROUTES } from '../../config/app';
const {snapshot,entries,active,lists,notes,members,accounts,tab,selectedDate,weekend,personFilter,noteFilter,query,loading,busy,error,initialized,editor,selected,showTrash,trash,showAi,aiText,aiMode,aiResult,aiRequest,name,memberName,refresh,openEntry,startEditor,saveEditor,closeEditor,createLinkedList,toggleItem,copyList,remove,loadTrash,restore,purge,chooseImages,linkSelf,runAi,resetAi,subscribe}=useNotebook();
const filteredNotes=computed(()=>notes.value.filter(n=>(!noteFilter.value||n.noteMemberId===noteFilter.value)&&(!query.value||(n.title+n.body).toLowerCase().includes(query.value.toLowerCase()))).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt));
const self=computed(()=>accounts.value.find(a=>a.isSelf));
const done=(entry:NotebookEntry)=>entry.items.filter(i=>i.done).length;
const related=(id:string)=>active.value.filter(e=>e.kind==='event'&&e.listId===id).map(e=>`${dateLabel(e.date)} ${e.startTime} · ${e.title}`).join('；');
const updated=(time:number)=>new Date(time+8*3600000).toISOString().slice(5,10).replace('-','月')+'日';
const daysLeft=(entry:NotebookEntry)=>Math.max(0,Math.ceil((30*86400000-(Date.now()-(entry.deletedAt||0)))/86400000));
function switchTab(kind:'event'|'list'|'note'){if(busy.value)return;tab.value=kind;query.value='';}
function back(){if(busy.value)return;const pages=getCurrentPages();if(pages.length>1)uni.navigateBack();else uni.reLaunch({url:APP_ROUTES.home});}
function setAiMode(mode:'parse'|'query'){aiMode.value=mode;resetAi();}
function openFamily(){uni.navigateTo({url:APP_ROUTES.family});}
</script>
<template>
  <view class="nb-page">
    <view class="nb-topbar"><button class="nb-icon" aria-label="返回首页" @tap="back">‹</button><text>小猪猪的家</text><button class="nb-text-button" :disabled="busy||loading" @tap="refresh">刷新</button></view>
    <view class="nb-brand"><view><text class="nb-title">家庭记事</text><text class="nb-caption nb-block">把要记住的事，放在一起。</text></view><view class="nb-avatars"><text v-for="account in accounts.slice(0,2)" :key="account.userId">{{account.name.slice(0,1)}}</text></view></view>
    <view class="nb-tabs"><button :class="{active:tab==='event'}" @tap="switchTab('event')">日历</button><button :class="{active:tab==='list'}" @tap="switchTab('list')">清单</button><button :class="{active:tab==='note'}" @tap="switchTab('note')">笔记</button></view>
    <scroll-view scroll-y class="nb-content">
      <view v-if="error" class="nb-error">{{error}}<button class="nb-text-button" :disabled="loading" @tap="refresh">重新加载</button><button v-if="!snapshot" class="nb-text-button" @tap="openFamily">我的家庭</button></view>
      <view v-if="loading&&!initialized" class="nb-empty">正在打开我们的记事…</view>
      <template v-if="snapshot">
        <view v-if="self&&!self.memberId" class="nb-profile-tip" @tap="!busy&&linkSelf()">绑定我的家庭成员名字，让参与人显示正确姓名 ›</view>
        <NotebookCalendar v-if="tab==='event'" :date="selectedDate" :weekend="weekend" :filter="personFilter" :entries="active" :accounts="accounts" :members="members" :busy="busy" @select="selectedDate=$event" @weekend="weekend=$event" @filter="personFilter=$event" @open="openEntry" @add="startEditor('event')"/>
        <template v-if="tab==='list'"><view class="nb-row"><view class="nb-section-title">一起完成的小事 <text class="nb-caption">{{lists.length}} 份清单</text></view><button class="nb-text-button" :disabled="busy" @tap="loadTrash">♲ 回收站</button></view><view v-if="!lists.length" class="nb-empty">暂时没有清单，点右下角新建。</view><button v-for="entry in lists" :key="entry.id" class="nb-list-card" :disabled="busy" @tap="openEntry(entry)"><view class="nb-row"><text class="nb-item-title">{{entry.title}}</text><text class="nb-list-symbol">☷</text></view><text class="nb-caption nb-block">{{done(entry)}} / {{entry.items.length}} 已完成</text><view class="nb-progress"><view :style="{width:(entry.items.length?done(entry)/entry.items.length*100:0)+'%'}"/></view><text v-if="related(entry.id)" class="nb-caption nb-block">{{related(entry.id)}}</text></button></template>
        <template v-if="tab==='note'"><view class="nb-search"><text>⌕</text><input v-model="query" placeholder="搜一搜记下来的事" maxlength="100"/></view><view class="nb-filters"><button class="nb-filter" :class="{chosen:!noteFilter}" @tap="noteFilter=''">全部</button><button v-for="member in members" :key="member.id" class="nb-filter" :class="{chosen:noteFilter===member.id}" @tap="noteFilter=member.id">{{member.name}}</button></view><view class="nb-row"><view class="nb-section-title">{{noteFilter?memberName(noteFilter)+'的笔记':'我们的笔记'}} <text class="nb-caption">{{filteredNotes.length}} 篇</text></view><button class="nb-text-button" :disabled="busy" @tap="loadTrash">♲ 回收站</button></view><view v-if="!filteredNotes.length" class="nb-empty">还没有相关笔记，点右下角写一篇。</view><button v-for="entry in filteredNotes" :key="entry.id" class="nb-note-row" :disabled="busy" @tap="openEntry(entry)"><text class="nb-item-title">{{entry.pinned?'⌖ ':''}}{{entry.title}}</text><view class="nb-note-meta"><text v-if="memberName(entry.noteMemberId)" class="nb-badge">{{memberName(entry.noteMemberId)}}</text><text>{{updated(entry.updatedAt)}}</text><text>{{name(entry.updatedBy)}}更新</text></view></button></template>
      </template>
      <view class="nb-bottom-space" />
    </scroll-view>
    <view v-if="snapshot" class="nb-dock"><button class="nb-ai-entry" :disabled="busy" @tap="showAi=true">✧ <text>说一句，帮你记下来</text></button><button class="nb-add" :disabled="busy" aria-label="新增" @tap="startEditor(tab)">＋</button></view>
    <NotebookDetail v-if="selected&&snapshot&&!editor&&!showTrash&&!showAi" :entry="selected" :home="snapshot" :entries="entries" :busy="busy" @close="selected=null" @edit="startEditor(selected.kind,selected)" @remove="remove(selected)" @copy="copyList(selected)" @toggle="(id,checked)=>selected&&toggleItem(selected,id,checked)" @open="openEntry" @trash="loadTrash" @subscribe="subscribe(selected)"/>
    <NotebookEditor v-if="editor&&snapshot" :value="editor" :home="snapshot" :entries="entries" :busy="busy" @close="closeEditor" @save="saveEditor" @images="chooseImages" @new-list="createLinkedList"/>
    <NotebookAi v-if="showAi&&snapshot&&!editor" :text="aiText" :mode="aiMode" :result="aiResult" :busy="busy" :request="aiRequest" :entries="active" :home="snapshot" @close="showAi=false" @text="aiText=$event" @mode="setAiMode" @run="runAi()" @recheck="runAi(true)" @draft="startEditor('event',undefined,$event)" @open="showAi=false;openEntry($event)"/>
    <NotebookSheet v-if="showTrash" title="记事回收站" :busy="busy" @close="showTrash=false"><text class="nb-caption nb-block">内容保留30天，可恢复原内容及完成记录。</text><view v-if="!trash.length" class="nb-empty">回收站是空的</view><view v-for="entry in trash" :key="entry.id" class="nb-trash-card"><view class="nb-row"><view><text class="nb-item-title">{{entry.title}}</text><text class="nb-caption nb-block">{{entry.kind==='list'?'清单':entry.kind==='note'?'笔记':'日程'}} · 剩余{{daysLeft(entry)}}天</text></view><button class="nb-secondary nb-small" :disabled="busy||daysLeft(entry)===0" @tap="restore(entry)">恢复</button></view><button class="nb-text-button nb-danger-text" :disabled="busy" @tap="purge(entry)">彻底删除</button></view></NotebookSheet>
  </view>
</template>
