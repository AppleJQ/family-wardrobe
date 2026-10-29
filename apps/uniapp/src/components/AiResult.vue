<script setup lang="ts">
import type { AiTask } from '../services/ai';
import type { ViewGarment } from '../services/wardrobe';
defineProps<{aiTask:AiTask|null;aiBusy:boolean;screen:string;selected:ViewGarment|null;suggestionCategory:string;handlers:Record<string,(...args:any[])=>unknown>}>();
</script>
<template><view v-if="aiTask" class="cloud-panel ai-result">
<text class="section-title-text">{{ aiTask?.type === 'recognize' ? '衣物识别' : '搭配建议' }} · {{ aiTask?.status === 'succeeded' ? '已完成' : aiTask?.status === 'running' ? '处理中' : aiTask?.status === 'unknown' ? '结果未知' : '未成功' }}</text>
<text v-if="aiTask?.status === 'unknown'" class="cloud-warning">结果暂未返回，请稍后查看。</text>
<text v-if="aiTask?.status === 'failed'" class="muted">本次未取得可用建议，可稍后重试。</text>
<view v-if="(aiTask?.result)?.suggestions" class="suggestions">
<text class="muted">逐项点“应用”后再保存；不会自动覆盖正在填写的信息。</text>
<view class="suggestion-row">
<text>名称 · {{ ((aiTask?.result)?.suggestions)?.name || '暂无建议' }}</text>
<button v-if="screen === 'detail' && selected?.id === (aiTask?.result)?.garmentId && ((aiTask?.result)?.suggestions)?.name" data-field="name" @tap="handlers.applySuggestion">应用</button>
</view>
<view class="suggestion-row">
<text>分类 · {{ suggestionCategory }}</text>
<button v-if="screen === 'detail' && selected?.id === (aiTask?.result)?.garmentId && ((aiTask?.result)?.suggestions)?.category" data-field="category" @tap="handlers.applySuggestion">应用</button>
</view>
<view class="suggestion-row">
<text>颜色 · {{ ((aiTask?.result)?.suggestions)?.color || '暂无建议' }}</text>
<button v-if="screen === 'detail' && selected?.id === (aiTask?.result)?.garmentId && ((aiTask?.result)?.suggestions)?.color" data-field="color" @tap="handlers.applySuggestion">应用</button>
</view>
<button v-if="screen === 'ai'" class="secondary-wide" @tap="handlers.openRecognizedGarment">打开对应衣物，查看并应用建议</button>
</view>
<button class="secondary-wide" :loading="!!((aiBusy))" :disabled="!!((aiBusy))" @tap="handlers.queryAiTask">刷新结果</button>
</view></template>
