<script setup lang="ts">
import createController from '../../controllers/home';
import { usePage } from '../../platform/use-page';
import { displayPath } from '../../platform/files';
import AppUpdatePanel from '../../components/AppUpdatePanel.vue';
import AiResult from '../../components/AiResult.vue';
const { refs, handlers, allowed } = usePage(createController, '/pages/home/index');
const { appName, statusBarHeight, assets, family, members, accounts, loading, ready, error } = refs;
</script>
<template><view v-if="allowed" class="home-shell" :style="'padding-top: ' + (statusBarHeight) + 'px;'">
<view class="home-header">
<image :src="displayPath((assets?.imgSprout))" mode="aspectFit">
</image>
<text>{{ appName }}</text>
</view>
<scroll-view class="home-scroll" scroll-y>
<view class="home-content">
<view class="home-intro">
<text class="home-title">把一家人的日常，<text>放在一起。</text>
</text>
</view>
<view v-if="loading" class="family-summary home-skeleton">
<view class="family-symbol">家</view>
<view>
<view class="skeleton-line">
</view>
<text>正在打开我们的家…</text>
</view>
</view>
<view v-else-if="error" class="home-error">
<text>{{ error }}</text>
<button class="home-secondary" @tap="handlers.refresh">重新加载</button>
</view>
<template v-else-if="ready">
<view v-if="!family" class="family-welcome">
<view class="family-symbol">家</view>
<text class="welcome-title">给一家人的日常，安个家</text>
<text class="home-subtitle">使用各自的账号，创建或加入同一个家庭。</text>
<button class="home-primary" @tap="handlers.openFamily">创建或加入家庭</button>
</view>
<view class="home-section-title">
<text>家里的小事</text>
</view>
<view v-if="family" class="module-card" @tap="handlers.openWardrobe">
<view class="module-top">
<view class="module-icon">
<image :src="displayPath((assets?.imgShirt))" mode="aspectFit">
</image>
</view>
<text class="module-title">家庭衣橱</text>
</view>
<text class="module-description">全家人的衣物，收进一个衣橱。<text>拍照收录，按人整理，随时找到。</text>
</text>
<view class="module-bottom">
<text>打开衣橱</text>
<text>↗</text>
</view>
</view>
<view v-else class="module-card module-unjoined">
<view class="module-top">
<view class="module-icon">
<image :src="displayPath((assets?.imgShirt))" mode="aspectFit">
</image>
</view>
<text class="module-title">家庭衣橱</text>
</view>
<text class="module-description">加入家庭后，和家人一起收录、整理衣物。</text>
</view>
</template>
<view class="home-footer">
<text class="privacy-link" @tap="handlers.viewPrivacy">隐私保护指引</text>
</view>
</view>
</scroll-view>
<view class="home-nav">
<view class="home-nav-item active">
<image :src="displayPath((assets?.imgSprout))" mode="aspectFit">
</image>
<text>首页</text>
</view>
<view class="home-nav-item" @tap="handlers.openFamily">
<image :src="displayPath((assets?.imgUserRound))" mode="aspectFit">
</image>
<text>我的家庭</text>
</view>
</view>
</view><AppUpdatePanel /></template>
<style>
.home-shell { height: 100vh; display: flex; flex-direction: column; background: #f8f7f2; box-sizing: border-box; }
.home-header { display: flex; align-items: center; gap: 16rpx; height: 100rpx; padding: 0 36rpx; flex-shrink: 0; font-size: 30rpx; font-weight: 600; }
.home-header > image { width: 40rpx; height: 40rpx; }
.home-scroll { flex: 1; height: 0; }
.home-content { padding: 40rpx 36rpx 24rpx; }
.home-intro { margin-bottom: 44rpx; }
.home-title { display: block; font-size: 50rpx; line-height: 1.5; font-weight: 700; letter-spacing: -1rpx; }
.home-title > text, .module-description > text { display: block; }
.home-subtitle { color: #7b8178; font-size: 25rpx; line-height: 1.8; }
.family-summary { display: flex; align-items: center; gap: 22rpx; padding: 28rpx; border: 1rpx solid #e2e7dc; border-radius: 24rpx; background: #fffefa; }
.family-symbol { flex-shrink: 0; width: 78rpx; height: 78rpx; display: flex; align-items: center; justify-content: center; border-radius: 24rpx; background: #eaf0e6; color: #456b53; font-weight: 700; font-size: 32rpx; }
.home-section-title { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin: 48rpx 0 24rpx; font-size: 30rpx; font-weight: 600; }
.module-card { background: #eaf0e6; border: 1rpx solid #dbe5d7; border-radius: 30rpx; padding: 32rpx; }
.module-top { display: flex; align-items: center; gap: 22rpx; margin-bottom: 28rpx; }
.module-icon { display: flex; flex-shrink: 0; align-items: center; justify-content: center; background: #fffefa; width: 86rpx; height: 86rpx; border-radius: 24rpx; }
.module-icon > image { width: 49rpx; height: 49rpx; }
.module-title { display: block; font-size: 36rpx; font-weight: 700; }
.module-description { display: block; color: #687961; line-height: 1.9; font-size: 25rpx; }
.module-bottom { display: flex; justify-content: space-between; align-items: center; border-top: 1rpx solid #d3dfcd; margin-top: 30rpx; padding-top: 24rpx; font-size: 25rpx; color: #456b53; font-weight: 600; }
.module-bottom > text:last-child { font-size: 35rpx; }
.module-unjoined { background: #f0f1e9; }
.family-welcome { text-align: center; padding: 32rpx; background: #fffefa; border: 1rpx solid #e2e7dc; border-radius: 24rpx; }
.family-welcome .family-symbol { margin: 0 auto 24rpx; }
.welcome-title { display: block; font-size: 30rpx; font-weight: 600; margin-bottom: 14rpx; }
.home-primary, .home-secondary { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 82rpx; border-radius: 20rpx; font-size: 27rpx; margin-top: 28rpx; }
.home-primary { background: #456b53; color: #fff; }
.home-secondary { background: #eaf0e6; color: #456b53; }
.home-error { padding: 28rpx; background: #faeee8; border-radius: 24rpx; color: #9b4d38; font-size: 26rpx; line-height: 1.8; }
.home-footer { text-align: center; color: #90968b; font-size: 22rpx; line-height: 1.8; padding: 38rpx 0 16rpx; }
.home-footer > text { display: block; }
.privacy-link { color: #70816e; }
.home-nav { display: flex; flex-shrink: 0; background: #fffefa; border-top: 1rpx solid #e5e7da; min-height: 106rpx; padding-bottom: env(safe-area-inset-bottom); }
.home-nav-item { display: flex; flex: 1; flex-direction: column; justify-content: center; align-items: center; gap: 8rpx; color: #7b8178; font-size: 22rpx; padding: 18rpx 0; }
.home-nav-item image { width: 36rpx; height: 36rpx; opacity: .6; }
.home-nav-item.active { color: #456b53; font-weight: 600; }
.home-nav-item.active image { opacity: 1; }
.home-skeleton { color: #7b8178; font-size: 24rpx; }
.skeleton-line { width: 220rpx; height: 24rpx; background: #e9ede3; border-radius: 8rpx; margin-bottom: 20rpx; }
</style>
