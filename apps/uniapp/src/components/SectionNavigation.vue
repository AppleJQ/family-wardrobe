<script setup lang="ts">
defineProps<{
  title: string;
  parentLabel: string;
  homeOnly?: boolean;
  disabled?: boolean;
  backDisabled?: boolean;
}>();
const emit = defineEmits<{
  back: [];
  home: [];
}>();
</script>

<template>
  <view class="section-navigation">
    <view class="section-navigation-capsule">
      <button
        class="section-navigation-back"
        :disabled="disabled || backDisabled"
        :aria-label="'返回' + parentLabel"
        hover-class="section-navigation-pressed"
        @tap="emit('back')"
      >
        <view class="section-navigation-chevron" aria-hidden="true"></view>
        <text>{{ parentLabel }}</text>
      </button>
      <template v-if="!homeOnly">
        <view class="section-navigation-divider" aria-hidden="true"></view>
        <button
          class="section-navigation-home"
          :disabled="disabled"
          aria-label="返回首页"
          hover-class="section-navigation-pressed"
          @tap="emit('home')"
        >
          <image class="section-navigation-home-icon" src="/static/icons/navigation-home.svg" mode="aspectFit" aria-hidden="true" />
        </button>
      </template>
    </view>
    <text class="section-navigation-title">{{ title }}</text>
  </view>
</template>

<style scoped>
.section-navigation { display: flex; align-items: center; justify-content: space-between; gap: 24rpx; min-height: 72rpx; margin-bottom: 36rpx; }
.section-navigation-capsule { display: flex; align-items: center; flex-shrink: 0; border: 1rpx solid #dce3d4; border-radius: 48rpx; background: #f1f3eb; overflow: hidden; }
.section-navigation-capsule button { display: flex; align-items: center; justify-content: center; flex: none; min-width: 44px; min-height: 36px; height: 72rpx; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: #52705a; font-family: inherit; font-size: 26rpx; font-weight: 400; line-height: 1; white-space: nowrap; box-sizing: border-box; }
.section-navigation-capsule button::after { border: 0; }
.section-navigation-capsule button[disabled] { background: transparent; color: #52705a; opacity: .45; }
.section-navigation-capsule .section-navigation-back { gap: 12rpx; padding: 0 28rpx 0 24rpx; }
.section-navigation-chevron { width: 12rpx; height: 12rpx; border-left: 3rpx solid currentColor; border-bottom: 3rpx solid currentColor; transform: rotate(45deg); flex-shrink: 0; }
.section-navigation-divider { height: 28rpx; width: 1rpx; background: #d6dfce; flex-shrink: 0; }
.section-navigation-capsule .section-navigation-home { width: 92rpx; }
.section-navigation-home-icon { width: 36rpx; height: 36rpx; }
.section-navigation-title { min-width: 0; font-size: 24rpx; line-height: 1.5; color: #7b8178; text-align: right; }
.section-navigation-capsule .section-navigation-pressed { background: #e6ebdf; }
</style>
