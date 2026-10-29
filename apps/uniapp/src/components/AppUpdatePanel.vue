<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { updateState as state, supportsAppUpdates, checkAppUpdate, downloadAppUpdate, cancelAppUpdate, installAppUpdate } from '../services/app-update';
defineProps<{ manual?: boolean }>();
const supported = supportsAppUpdates();
const hidden = ref(false);
watch(() => state.phase, phase => { if (phase === 'downloading') hidden.value = false; });
const floating = computed(() => !hidden.value && (['downloading', 'verifying', 'ready', 'installing'].includes(state.phase) || (state.phase === 'error' && state.release)));
const busy = computed(() => ['checking', 'downloading', 'verifying', 'installing'].includes(state.phase));
const label = computed(() => ({ checking: '正在检查更新…', downloading: `正在下载更新 ${state.progress}%`, verifying: '正在校验安装包…',
  installing: '请在系统界面确认安装', ready: '更新已下载，可继续安装', available: `可更新至 ${state.release?.versionName || ''}`, error: '更新暂未完成', idle: '检查应用新版本' }[state.phase]));
</script>
<template>
  <view v-if="supported && (manual || floating)" :class="['update-panel', { 'update-floating': !manual }]">
    <text class="update-title">{{ label }}</text>
    <progress v-if="state.phase === 'downloading'" :percent="state.progress" stroke-width="5" activeColor="#819570" />
    <text v-if="state.error" class="update-error">{{ state.error }}</text>
    <view class="update-actions">
      <button v-if="state.phase === 'downloading'" @tap="cancelAppUpdate">取消下载</button>
      <button v-else-if="state.phase === 'ready'" @tap="installAppUpdate">安装更新</button>
      <button v-else-if="!busy && state.release && ['available', 'error'].includes(state.phase)" @tap="downloadAppUpdate">{{ state.phase === 'error' ? '重试下载' : '下载更新' }}</button>
      <button v-if="manual" :disabled="busy" @tap="checkAppUpdate">{{ state.phase === 'checking' ? '检查中…' : '检查更新' }}</button>
      <button v-else-if="['ready', 'error'].includes(state.phase)" @tap="hidden = true">稍后</button>
    </view>
  </view>
</template>
<style scoped>
.update-panel{margin:24rpx 0;padding:24rpx;border-radius:20rpx;background:#fffefa;color:#445d3b;}
.update-floating{position:fixed;left:24rpx;right:24rpx;bottom:calc(120rpx + env(safe-area-inset-bottom));z-index:90;box-shadow:0 4rpx 24rpx #29372f22;}
.update-title,.update-error{display:block;font-size:25rpx;line-height:1.6;}.update-error{margin-top:12rpx;color:#9b4d38;font-size:23rpx;}
.update-actions{display:flex;gap:16rpx;margin-top:14rpx;}.update-actions button{margin:0;flex:1;background:#edf1e7;color:#445d3b;font-size:24rpx;border-radius:14rpx;}
</style>
