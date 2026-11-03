<script setup lang="ts">
import type { NotebookAiResult, NotebookDraft, NotebookEntry, NotebookHome } from '../../services/notebook';
import NotebookSheet from './NotebookSheet.vue';
import { participantNames } from '../../services/notebook-state';
const props=defineProps<{text:string;mode:'parse'|'query';result:NotebookAiResult|null;busy:boolean;request:string;entries:NotebookEntry[];home:NotebookHome}>();
const emit=defineEmits<{close:[];text:[value:string];mode:[value:'parse'|'query'];run:[];recheck:[];draft:[draft:NotebookDraft];open:[entry:NotebookEntry]}>();
const inputText=(event:unknown)=>(event as {detail:{value:string}}).detail.value;
const resultEntries=()=>props.entries.filter(e=>props.result?.entryIds.includes(e.id));
</script>
<template>
  <NotebookSheet title="帮你记，也帮你找" :busy="busy" @close="emit('close')">
    <view class="nb-person-options"><button :class="{chosen:mode==='parse'}" :disabled="busy" @tap="emit('mode','parse')">一句话记事</button><button :class="{chosen:mode==='query'}" :disabled="busy" @tap="emit('mode','query')">查询安排</button></view>
    <view class="nb-field"><textarea class="nb-input nb-textarea" :value="text" :disabled="busy||!!request" maxlength="1000" auto-height :placeholder="mode==='parse'?'例如：周六下午两点大王王和小猪猪一起看家具':'例如：我们这个周末有什么安排？'" @input="emit('text',inputText($event))" /></view>
    <text class="nb-caption">日程确认前不会保存；信息含糊时会补问。</text>
    <button v-if="!request" class="nb-primary nb-save" :loading="busy" :disabled="busy||!text.trim()" @tap="emit('run')">{{mode==='parse'?'整理一下':'查一查'}}</button>
    <template v-if="result">
      <view v-if="result.questions.length" class="nb-notice">{{result.questions.join('\n')}}</view>
      <text v-if="result.answer" class="nb-note-body">{{result.answer}}</text>
      <view v-for="(draft,index) in result.drafts" :key="index" class="nb-ai-card"><text class="nb-caption">待确认的安排</text><text class="nb-item-title nb-block">{{draft.title}}</text><text class="nb-block">{{draft.date}} {{draft.startTime||'时间待定'}}{{draft.endTime?' — '+draft.endTime:''}}</text><text class="nb-caption">{{participantNames(draft,home).join('、')}}</text><button class="nb-primary nb-save" :disabled="busy" @tap="emit('draft',draft)">核对并加入日历</button></view>
      <button v-for="entry in resultEntries()" :key="entry.id" class="nb-link-card" :disabled="busy" @tap="emit('open',entry)">{{entry.date}} {{entry.startTime}} · {{entry.title}} ›</button>
      <view v-if="result.error" class="nb-notice">{{result.error}}</view>
      <button v-if="['running','unknown'].includes(result.status)" class="nb-secondary nb-save" :disabled="busy" @tap="emit('recheck')">查看原请求结果</button>
    </template>
    <button v-if="request" class="nb-text-button nb-save" :disabled="busy" @tap="emit('mode',mode)">{{result?.status==='unknown'?'原请求可能已处理，改写新问题':'继续提问'}}</button>
  </NotebookSheet>
</template>
