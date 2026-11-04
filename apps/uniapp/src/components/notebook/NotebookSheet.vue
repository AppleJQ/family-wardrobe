<script setup lang="ts">
defineProps<{ title: string; busy?: boolean; variant?: 'cycle' }>();
const emit=defineEmits<{close:[]}>();
</script>
<template>
  <view class="nb-overlay" :class="{'nb-cycle-overlay':variant==='cycle'}" @tap="!busy&&emit('close')">
    <view class="nb-sheet" :class="{'nb-cycle-sheet':variant==='cycle'}" @tap.stop>
      <view class="nb-grip" />
      <view class="nb-row nb-sheet-heading"><text>{{title}}</text><button class="nb-icon" :disabled="busy" aria-label="关闭" @tap="emit('close')">×</button></view>
      <scroll-view scroll-y enhanced :show-scrollbar="false" class="nb-sheet-scroll"><slot /></scroll-view>
      <slot name="footer" />
    </view>
  </view>
</template>
