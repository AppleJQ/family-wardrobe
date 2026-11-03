<script setup lang="ts">
defineProps<{ title: string; busy?: boolean }>();
const emit=defineEmits<{close:[]}>();
</script>
<template>
  <view class="nb-overlay" @tap="!busy&&emit('close')">
    <view class="nb-sheet" @tap.stop>
      <view class="nb-grip" />
      <view class="nb-row nb-sheet-heading"><text>{{title}}</text><button class="nb-icon" :disabled="busy" aria-label="关闭" @tap="emit('close')">×</button></view>
      <scroll-view scroll-y enhanced :show-scrollbar="false" class="nb-sheet-scroll"><slot /></scroll-view>
    </view>
  </view>
</template>
