<script setup lang="ts">
import { computed } from 'vue';
import createController from '../../controllers/cloud';
import { usePage } from '../../platform/use-page';
import { displayPath } from '../../platform/files';
import AppUpdatePanel from '../../components/AppUpdatePanel.vue';
import AiResult from '../../components/AiResult.vue';
import SectionNavigation from '../../components/SectionNavigation.vue';
import { isWechat } from '../../platform/runtime';
const { refs, handlers, allowed } = usePage(createController, '/pages/cloud/index');
const { appName, entryScreen, statusBarHeight, screen, ready, loading, saving, error, selectedMember, selectedMemberName, category, garments, cursor, listContext, selected, form, formDirty, categoryNames, memberNames, search, filterColor, filtersOpen, selecting, selectedIds, locations, locationNames, locationIds, batch, batchIndex, photoCount, replaceBatchIndex, batchProgress, recognizingBatch, recognitionPending, outfits, outfitCursor, outfitForm, outfitPicked, outfitMemberName, suggestionCategory, outfitCandidates, candidateCursor, pickerReturn, pickedIds, aiStatus, aiTask, aiHistory, aiCursor, aiBusy, pendingAi, recommendations, aiMemberIndex, aiOccasion, aiSeason, lockedIds, lockedNames, lockedGarments, exporting, exportCount, exportPath, exportBytes, cutoutPath, cutoutRequestId, cutoutVersion, imagePath, inviteToken, invitePreview, inviteInput, inviteId, showPrivacy, privacyContractName, assets, family, members } = refs;
const navigation = computed(() => {
  const pages = {
    wardrobe: { title: '家庭衣橱', parent: '', parentLabel: '首页' },
    account: { title: '我的家庭', parent: '', parentLabel: '首页' },
    upload: { title: '添加衣物', parent: 'wardrobe', parentLabel: '衣橱' },
    detail: { title: '衣物详情', parent: 'wardrobe', parentLabel: '衣橱' },
    trash: { title: '回收站', parent: 'wardrobe', parentLabel: '衣橱' },
    locations: { title: '收纳位置', parent: 'account', parentLabel: '我的家庭' },
    outfits: { title: '收藏搭配', parent: 'wardrobe', parentLabel: '衣橱' },
    outfitEdit: { title: outfitForm.value.id ? '编辑搭配' : '创建搭配', parent: 'outfits', parentLabel: '搭配' },
    ai: { title: '搭配助手', parent: 'outfits', parentLabel: '搭配' },
    picker: { title: '挑选衣物', parent: pickerReturn.value, parentLabel: pickerReturn.value === 'ai' ? '搭配助手' : '编辑搭配' },
  };
  const current = pages[screen.value];
  return family.value ? current : { ...current, parent: '', parentLabel: '首页' };
});
const navigationDisabled = computed(() => saving.value || recognizingBatch.value || exporting.value || aiBusy.value);
</script>
<template><view v-if="allowed" class="app-shell cloud-shell" :style="'padding-top: ' + (statusBarHeight) + 'px;'">
<view class="cloud-header">
<image :src="displayPath((assets?.imgSprout))" mode="aspectFit">
</image>
<text>{{ appName }}</text>
<text class="cloud-header-tag">{{ screen === 'account' || screen === 'locations' ? '我的家庭' : '家庭衣橱' }}</text>
</view>
<scroll-view class="cloud-scroll" scroll-y>
<view class="page-content">
<SectionNavigation
  v-if="screen !== 'account'"
  :title="navigation.title"
  :parent-label="navigation.parentLabel"
  :home-only="!navigation.parent"
  :disabled="navigationDisabled"
  :back-disabled="!!navigation.parent && !ready && loading"
  @back="navigation.parent ? handlers.nav({ currentTarget: { dataset: { screen: navigation.parent } } }) : handlers.goHome()"
  @home="handlers.goHome"
/>
<view v-if="error" class="cloud-error">
<text>{{ error }}</text>
<text v-if="!ready" @tap="handlers.bootstrap" class="link">重试连接</text>
<text v-else-if="family" @tap="handlers.refresh" class="link">重新加载</text>
</view>
<view v-if="!ready && loading" class="loading-preview">
<text class="title-xl">{{ screen === 'account' ? '正在打开我的家庭' : '正在打开你的衣橱' }}</text>
<text class="muted">{{ screen === 'account' ? '正在同步家庭信息…' : '正在同步最新衣物…' }}</text>
<view class="loading-members">
<view>
</view>
<view>
</view>
<view>
</view>
</view>
<view v-if="screen !== 'account'" class="garment-grid">
<template v-for="(item, index) in [1,2,3,4]" :key="item">
<view class="loading-card">
<view class="loading-photo">
</view>
<view class="loading-line">
</view>
</view>
</template>
</view>
</view>
<template v-if="ready && !family">
<view class="intro">
<text class="title-xl">一家人的日常，<text>一起好好照顾</text>
</text>
<text class="muted">使用各自的账号，走进同一个家。</text>
</view>
<view class="cloud-welcome">
<image :src="displayPath((assets?.imgSprout))" mode="aspectFit">
</image>
<text>先为一家人，安一个家</text>
<text class="muted">创建或加入家庭后，即可使用家庭衣橱。同一家人共同管理衣物，不同家庭的数据彼此独立。</text>
</view>
<button class="primary-button" :loading="!!((saving))" :disabled="!!((saving))" @tap="handlers.createFamily">创建我的家庭</button>
<view class="section-title">
<text>已有家人创建了家庭？</text>
</view>
<view class="cloud-panel">
<text class="cloud-label">粘贴家人发来的邀请码</text>
<textarea class="invite-input" maxlength="64" :value="(inviteInput)" @input="handlers.inviteInput" placeholder="邀请码">
</textarea>
<button class="secondary-wide" :loading="!!((saving))" :disabled="!!((saving || !inviteInput))" @tap="handlers.previewInvite">查看邀请</button>
<view v-if="invitePreview" class="invite-preview">
<text>邀请你加入「{{ invitePreview }}」</text>
<text class="muted">所有有效家人均可编辑、删除全部家庭衣物。</text>
<button class="primary-button" :disabled="!!((saving))" @tap="handlers.acceptInvite">确认加入家庭</button>
</view>
</view>
</template>
<template v-if="ready && family && (screen === 'wardrobe' || screen === 'trash')">
<view class="intro">
<text class="title-xl">{{ screen === 'trash' ? '留一段，反悔的时间' : '把日常，收拾得刚刚好' }}</text>
<text v-if="screen === 'trash'" class="muted">删除后保留30天，永久删除后无法恢复。</text>
</view>
<view class="member-line">
<view class="member-current">
<view class="avatar">{{ selectedMemberName?.[0] }}</view>
<text>{{ selectedMemberName }}的衣橱</text>
</view>
</view>
<view class="chip-row member-chips">
<view :class="'chip ' + (!selectedMember ? 'chip-active' : '')" :data-id="''" @tap="handlers.chooseMember">全家</view>
<template v-for="(item, index) in members" :key="item.id">
<view :class="'chip ' + (selectedMember === item?.id ? 'chip-active' : '')" :data-id="(item?.id)" @tap="handlers.chooseMember">{{ item?.name }}</view>
</template>
</view>
<view class="chip-row categories">
<view :class="'chip ' + (category === 'all' ? 'chip-active' : '')" data-category="all" @tap="handlers.filterCategory">全部</view>
<view :class="'chip ' + (category === 'onepiece' ? 'chip-active' : '')" data-category="onepiece" @tap="handlers.filterCategory">整装</view>
<view :class="'chip ' + (category === 'hat' ? 'chip-active' : '')" data-category="hat" @tap="handlers.filterCategory">帽子</view>
<view :class="'chip ' + (category === 'top' ? 'chip-active' : '')" data-category="top" @tap="handlers.filterCategory">上衣</view>
<view :class="'chip ' + (category === 'bottom' ? 'chip-active' : '')" data-category="bottom" @tap="handlers.filterCategory">裤子</view>
</view>
<view class="cloud-search">
<input class="search-input" :value="(search)" data-field="search" @input="handlers.filterInput" @confirm="handlers.applyFilters" placeholder="搜索名称、备注" confirm-type="search">
</input>
<button class="search-submit" @tap="handlers.applyFilters">搜索</button>
<text class="link" @tap="handlers.toggleFilters">筛选</text>
</view>
<view v-if="filtersOpen" class="cloud-panel cloud-form">
<view>
<text>颜色</text>
<input maxlength="40" data-field="filterColor" :value="(filterColor)" @input="handlers.filterInput" placeholder="例如：白色">
</input>
</view>
<view class="button-row">
<button class="secondary-button" @tap="handlers.clearFilters">清空条件</button>
<button class="secondary-button" @tap="handlers.applyFilters">应用筛选</button>
</view>
</view>
<view class="section-title wardrobe-heading">
<text class="wardrobe-heading-title">{{ screen === 'trash' ? '回收站衣物' : selectedMemberName + '的衣橱' }}</text>
<view v-if="screen !== 'trash'" class="wardrobe-heading-actions">
<button class="wardrobe-action wardrobe-add" :disabled="!!((saving))" @tap="handlers.openUpload">{{ batch?.length ? '继续录入（' + batch?.length + '）' : '＋ 添加衣物' }}</button>
<button class="wardrobe-action wardrobe-bulk" :disabled="!!((saving))" @tap="handlers.toggleSelecting">{{ selecting ? '完成选择' : '批量整理' }}</button>
</view>
</view>
<view v-if="selecting || screen === 'trash'" class="cloud-panel bulk-toolbar">
<text>已选 {{ selectedIds?.length }} / 20 件</text>
<view class="button-row">
<button v-if="screen !== 'trash'" class="secondary-button" :disabled="!!((!selectedIds?.length || saving))" @tap="handlers.bulkEdit">批量修改</button>
<button v-if="screen !== 'trash'" class="secondary-button danger-text" data-action="batchDelete" :disabled="!!((!selectedIds?.length || saving))" @tap="handlers.bulkAction">移入回收站</button>
<button v-if="screen === 'trash'" class="secondary-button" data-action="restore" :disabled="!!((!selectedIds?.length || saving))" @tap="handlers.bulkAction">恢复</button>
<button v-if="screen === 'trash'" class="secondary-button danger-text" data-action="purge" :disabled="!!((!selectedIds?.length || saving))" @tap="handlers.bulkAction">永久删除</button>
</view>
</view>
<view v-if="!garments?.length && !loading && !error" class="cloud-empty">
<image :src="displayPath((assets?.imgShirt))" mode="aspectFit">
</image>
<text>{{ screen === 'trash' ? '回收站空空的' : '没有符合条件的衣物' }}</text>
<text class="muted">{{ screen === 'trash' ? '已删除衣物会在这里保留30天。' : '调整筛选，或为家人添加一件衣物。' }}</text>
</view>
<view class="garment-grid">
<template v-for="(item, index) in garments" :key="item.id">
<view :class="'garment-card ' + (item?.checked ? 'garment-selected' : '')" :data-id="(item?.id)" @tap="handlers.openGarment">
<view class="garment-photo">
<image v-if="item?.image" :src="displayPath((item?.image))" mode="aspectFit">
</image>
<text v-else class="muted">照片暂不可用</text>
<text v-if="selecting || screen === 'trash'" class="selection-mark">{{ item?.checked ? '✓' : '○' }}</text>
</view>
<text class="garment-name">{{ item?.name }}</text>
<text v-if="item?.restoreLabel" class="tiny muted">可恢复至 {{ item?.restoreLabel }}</text>
</view>
</template>
</view>
<text v-if="loading" class="cloud-loading">正在读取衣橱…</text>
<button v-if="cursor" class="secondary-wide" :disabled="!!((loading))" @tap="handlers.loadMore">加载更多</button>
<view v-if="screen === 'wardrobe'" class="wardrobe-tools">
<text class="link" data-screen="trash" @tap="handlers.nav">衣橱回收站 ›</text>
</view>
</template>
<template v-if="ready && family && (screen === 'upload' || screen === 'detail')">
<view class="intro">
<text class="title-xl">{{ screen === 'upload' ? '拍张照，把衣物收进来' : '每一件，都好好照顾' }}</text>
</view>
<view v-if="screen === 'upload'" class="button-row">
<button class="secondary-button" :disabled="!!((saving || recognizingBatch || batch?.length >= 9))" @tap="handlers.chooseOne">拍照 / 选一张</button>
<button class="secondary-button" :disabled="!!((saving || recognizingBatch || batch?.length >= 9))" @tap="handlers.chooseMany">相册批量选图</button>
</view>
<scroll-view v-if="screen === 'upload' && batch?.length" scroll-x class="batch-strip">
<view class="batch-strip-inner">
<template v-for="(item, index) in batch" :key="item.id">
<view :class="'batch-thumb ' + (batchIndex === index ? 'active' : '')" :data-index="(index)" @tap="handlers.selectBatch">
<image :src="displayPath(((item?.cutout)?.applied ? (item?.cutout)?.previewPath : item?.path))" mode="aspectFill">
</image>
<text>{{ index + 1 }} · {{ item?.status === 'saved' ? '已保存' : item?.status === 'saving' ? '保存中' : item?.status === 'failed' ? '待重试' : '待填写' }}</text>
</view>
</template>
</view>
</scroll-view>
<view v-if="screen === 'upload'" class="cloud-photo">
<image v-if="imagePath" :src="displayPath((imagePath))" mode="aspectFit">
</image>
<view v-else class="cloud-photo-empty">
<image :src="displayPath((assets?.imgPlus))" mode="aspectFit">
</image>
<text>请拍摄或选择衣物照片</text>
<text class="tiny muted">仅用于衣物，不上传人物照片</text>
</view>
</view>
<view v-else class="cloud-photo" @tap="handlers.previewImage">
<image v-if="selected?.image" :src="displayPath((selected?.image))" mode="aspectFit">
</image>
<text class="tiny muted">点击查看照片</text>
</view>
<view v-if="screen === 'upload' && (batch?.[batchIndex])?.error" class="cloud-error">{{ (batch?.[batchIndex])?.error }}</view>
<text v-if="screen === 'upload' && (batch?.[batchIndex])?.submittedPatch" class="tiny muted">本张已提交，重试沿用原信息和编号。已保存项会跳过；如需修改，请打开已保存衣物。</text>
<button v-if="screen === 'upload' && (batch?.[batchIndex])?.canRestart" class="secondary-wide" :disabled="!!((saving))" @tap="handlers.replaceBatchPhoto">更换本张照片，重新录入（新请求）</button>
<view v-if="screen === 'upload' && batch?.length" class="cloud-panel recognition-status">
<text v-if="((batch?.[batchIndex])?.recognition)?.status === 'running'">正在识别名称和颜色…</text>
<text v-else-if="((batch?.[batchIndex])?.recognition)?.status === 'succeeded'">名称和颜色已识别，可直接修改后保存。</text>
<text v-else-if="((batch?.[batchIndex])?.recognition)?.status === 'unknown'" class="muted">识别结果暂未返回，可稍后查看或手动填写。</text>
<text v-else-if="((batch?.[batchIndex])?.recognition)?.error" class="muted">{{ ((batch?.[batchIndex])?.recognition)?.error }}</text>
<text v-else class="muted">照片准备完成后将自动智能识别名称和颜色，也可手动填写。</text>
<button v-if="(batch?.[batchIndex])?.recognition && (batch?.[batchIndex])?.status !== 'saved' && !(batch?.[batchIndex])?.submittedPatch && ((batch?.[batchIndex])?.recognition)?.status !== 'succeeded' && !recognizingBatch" class="secondary-wide" :disabled="!!((saving))" @tap="handlers.retryBatchRecognition">重查本张识别结果</button>
</view>
<view class="cloud-panel cloud-form">
<view>
<text>名称</text>
<input maxlength="60" placeholder="选图后自动识别，也可手动填写" :value="(form?.name)" data-field="name" @input="handlers.formInput" :disabled="!!((saving || (screen === 'upload' && (batch?.[batchIndex])?.submittedPatch)))">
</input>
</view>
<view>
<text>归属档案</text>
<picker :range="(memberNames)" :value="(form?.memberIndex)" data-field="memberIndex" @change="handlers.formPicker" :disabled="!!((saving || (screen === 'upload' && (batch?.[batchIndex])?.submittedPatch)))">
<text>{{ memberNames?.[form?.memberIndex] }} ›</text>
</picker>
</view>
<view>
<text>分类</text>
<picker :range="(categoryNames)" :value="(form?.categoryIndex)" data-field="categoryIndex" @change="handlers.formPicker" :disabled="!!((saving || (screen === 'upload' && (batch?.[batchIndex])?.submittedPatch)))">
<text>{{ categoryNames?.[form?.categoryIndex] }} ›</text>
</picker>
</view>
<view>
<text>颜色</text>
<input maxlength="40" placeholder="自动识别主颜色，也可手动修改" :value="(form?.color)" data-field="color" @input="handlers.formInput" :disabled="!!((saving || (screen === 'upload' && (batch?.[batchIndex])?.submittedPatch)))">
</input>
</view>
<view>
<text>备注</text>
<input maxlength="500" placeholder="可选" :value="(form?.notes)" data-field="notes" @input="handlers.formInput" :disabled="!!((saving || (screen === 'upload' && (batch?.[batchIndex])?.submittedPatch)))">
</input>
</view>
</view>
<text class="tiny muted">保存后，同一家庭的家人均可查看、编辑和删除。</text>
<text v-if="screen === 'upload' && batchProgress" class="cloud-loading">{{ batchProgress }}</text>
<button class="primary-button" :loading="!!((saving || (screen === 'upload' && recognizingBatch)))" :disabled="!!((saving || (screen === 'upload' && (recognizingBatch || recognitionPending))))" @tap="handlers.saveGarment">{{ saving ? '正在保存…' : screen === 'upload' && (recognizingBatch || recognitionPending) ? '正在识别名称和颜色…' : screen === 'upload' ? '保存本批 / 重试未成功项' : '确认并保存' }}</button>
<button v-if="screen === 'upload' && (batch?.[batchIndex])?.status === 'saved'" class="secondary-wide" :disabled="!!((saving))" @tap="handlers.openBatchSaved">查看已保存衣物</button>
<button v-if="screen === 'upload' && batch?.length" class="batch-clear-button" :disabled="!!((saving))" @tap="handlers.clearBatch">结束本批，清除本地暂存</button>
<template v-if="screen === 'detail'">
<button class="secondary-wide" :loading="!!((aiBusy))" :disabled="!!((aiBusy || saving))" @tap="handlers.recognizeSelected">重新智能识别这件衣物</button>
<AiResult :ai-task="aiTask" :ai-busy="aiBusy" :screen="screen" :selected="selected" :suggestion-category="suggestionCategory" :handlers="handlers" />
<view v-if="pendingAi" class="cloud-panel">
<text class="tiny muted">上次结果暂未返回，可稍后查看。</text>
<button class="secondary-wide" :disabled="!!((aiBusy))" @tap="handlers.retryAi">查看上次结果</button>
<button class="secondary-wide" :disabled="!!((aiBusy))" @tap="handlers.newAiTask">重新生成</button>
</view>
</template>
<button v-if="screen === 'detail' || (screen === 'upload' && batch?.length && !(batch?.[batchIndex])?.submittedPatch && (batch?.[batchIndex])?.status !== 'saved')" class="secondary-wide" :loading="!!((saving))" :disabled="!!((saving || recognizingBatch))" @tap="handlers.cutoutSelected">智能去背景·预览透明PNG</button>
<view v-if="cutoutPath" class="cloud-panel">
<image class="cutout-preview" :src="displayPath((cutoutPath))" mode="aspectFit" @tap="handlers.previewCutout">
</image>
<button class="secondary-wide" :loading="!!((saving))" :disabled="!!((saving || !cutoutRequestId))" @tap="handlers.replaceOriginal">替换原图</button>
</view>
<button v-if="screen === 'detail'" class="cloud-danger" :disabled="!!((saving))" @tap="handlers.deleteGarment">移入衣橱回收站</button>
</template>
<template v-if="ready && family && screen === 'outfits'">
<view class="intro">
<text class="title-xl">今天，也好好穿</text>
<text class="muted">从真实衣物中组合，收藏全家的日常灵感。</text>
</view>
<view class="chip-row member-chips">
<view :class="'chip ' + (!selectedMember ? 'chip-active' : '')" :data-id="''" @tap="handlers.chooseMember">全家</view>
<template v-for="(item, index) in members" :key="item.id">
<view :class="'chip ' + (selectedMember === item?.id ? 'chip-active' : '')" :data-id="(item?.id)" @tap="handlers.chooseMember">{{ item?.name }}</view>
</template>
</view>
<view class="button-row">
<button class="secondary-button" @tap="handlers.newOutfit">手动创建搭配</button>
<button class="secondary-button" @tap="handlers.openAi">智能 搭配助手</button>
</view>
<text class="tiny muted">收藏即保存到本页，全家都可查看、修改。</text>
<view v-if="!outfits?.length && !loading" class="cloud-empty">还没有收藏搭配，先选几件喜欢的衣物吧。</view>
<template v-for="(item, index) in outfits" :key="item.id">
<view class="cloud-panel outfit-card" :data-id="(item?.id)" @tap="handlers.openOutfit">
<view class="outfit-photos">
<template v-for="(garment, index) in item.garments" :key="garment.id">
<view>
<image v-if="garment?.image" :src="displayPath((garment?.image))" mode="aspectFit">
</image>
<text v-else class="tiny muted">照片不可用</text>
</view>
</template>
</view>
<text class="section-title-text">{{ item?.name }}{{ item?.partial ? ' · 局部搭配' : '' }}</text>
<text class="muted">{{ item?.occasion || '日常' }} · {{ item?.reason || '点开查看、替换或编辑' }}</text>
<text v-if="!item?.valid" class="cloud-warning">部分衣物已改变或不可用，保留原组合供查看</text>
</view>
</template>
<text v-if="loading" class="cloud-loading">正在读取搭配…</text>
<button v-if="outfitCursor" class="secondary-wide" :disabled="!!((loading))" @tap="handlers.moreOutfits">更多搭配</button>
</template>
<template v-if="ready && family && screen === 'outfitEdit'">
<view class="intro">
<text class="title-xl">把喜欢，搭在一起</text>
<text class="muted">完整搭配需整装，或上衣与裤子，可加帽子。每类一件。</text>
</view>
<view class="cloud-panel cloud-form">
<view>
<text>搭配名称</text>
<input maxlength="60" :value="(outfitForm?.name)" data-field="name" @input="handlers.outfitInput" placeholder="例如：周末散步">
</input>
</view>
<view>
<text>归属成员</text>
<picker :range="(memberNames)" @change="handlers.outfitMember">
<text>{{ outfitMemberName || '选择成员' }} ›</text>
</picker>
</view>
<view>
<text>场景</text>
<input maxlength="100" :value="(outfitForm?.occasion)" data-field="occasion" @input="handlers.outfitInput" placeholder="例如：通勤、运动">
</input>
</view>
<view>
<text>搭配说明</text>
<input maxlength="500" :value="(outfitForm?.reason)" data-field="reason" @input="handlers.outfitInput" placeholder="可选">
</input>
</view>
<view>
<text>局部搭配（允许缺件）</text>
<switch color="#7d926e" :checked="!!((outfitForm?.partial))" @change="handlers.outfitPartial">
</switch>
</view>
</view>
<template v-for="(item, index) in outfitPicked" :key="item.id">
<view class="cloud-panel picked-garment">
<image v-if="item?.image" :src="displayPath((item?.image))" mode="aspectFit">
</image>
<view>
<text>{{ item?.name }}</text>
<text v-if="item?.available === false || (item?.currentVersion && item?.currentVersion !== item?.version)" class="cloud-warning">衣物已改变或不可用，请重新选择</text>
</view>
<text class="link" :data-id="(item?.id)" @tap="handlers.removeOutfitItem">移除</text>
</view>
</template>
<button class="secondary-wide" :disabled="!!((saving))" @tap="handlers.openOutfitPicker">挑选 / 替换真实衣物</button>
<button class="primary-button" :disabled="!!((saving))" :loading="!!((saving))" @tap="handlers.saveOutfit">{{ outfitForm?.id ? '保存搭配修改' : '收藏这套搭配' }}</button>
<button v-if="outfitForm?.id" class="cloud-danger" :disabled="!!((saving))" @tap="handlers.deleteOutfit">删除收藏搭配</button>
</template>
<template v-if="ready && family && screen === 'picker'">
<view class="intro">
<text class="title-xl">选几件，喜欢的衣物</text>
<text class="muted">仅当前成员的衣物。点同类新品可替换，再点可移除。</text>
</view>
<text class="tiny muted">已选 {{ pickedIds?.length }} / 3 件</text>
<view class="garment-grid">
<template v-for="(item, index) in outfitCandidates" :key="item.id">
<view :class="'garment-card ' + (item?.checked ? 'garment-selected' : '')" :data-id="(item?.id)" @tap="handlers.toggleCandidate">
<view class="garment-photo">
<image :src="displayPath((item?.image))" mode="aspectFit">
</image>
<text class="selection-mark">{{ item?.checked ? '✓' : '○' }}</text>
</view>
<text class="garment-name">{{ item?.name }}</text>
<text class="tiny muted">{{ item?.categoryLabel }}</text>
</view>
</template>
</view>
<text v-if="!outfitCandidates?.length && !loading" class="cloud-empty">这位成员还没有衣物。</text>
<button v-if="candidateCursor" class="secondary-wide" :disabled="!!((loading))" @tap="handlers.moreCandidates">加载更多衣物</button>
<button class="primary-button" :disabled="!!((loading))" @tap="handlers.finishPicker">确认所选衣物</button>
</template>
<template v-if="ready && family && screen === 'ai'">
<view class="intro">
<text class="title-xl">一点灵感，来自你的衣橱</text>
<text class="muted">只提供真实衣物建议，不提供人物或真人试穿。</text>
</view>
<text v-if="aiStatus && !aiStatus?.configured" class="muted">智能搭配暂不可用，请稍后再试。</text>
<view class="cloud-panel cloud-form">
<view>
<text>成员</text>
<picker :range="(memberNames)" :value="(aiMemberIndex)" @change="handlers.aiMember">
<text>{{ memberNames?.[aiMemberIndex] || '请选择' }} ›</text>
</picker>
</view>
<view>
<text>场景</text>
<input maxlength="100" placeholder="例如：通勤、周末出游" :value="(aiOccasion)" data-field="aiOccasion" @input="handlers.aiInput">
</input>
</view>
<view>
<text>季节</text>
<input maxlength="40" placeholder="例如：秋季" :value="(aiSeason)" data-field="aiSeason" @input="handlers.aiInput">
</input>
</view>
<view>
<text>固定单品</text>
<text class="link" @tap="handlers.openLockPicker">{{ lockedNames || '选择真实衣物' }} ›</text>
</view>
</view>
<button class="primary-button" :disabled="!!((aiBusy || !aiStatus?.configured))" :loading="!!((aiBusy))" @tap="handlers.generateRecommendations">生成最多3套搭配（需确认）</button>
<view v-if="pendingAi" class="cloud-panel">
<text class="muted">上次结果暂未返回，可稍后查看。</text>
<button class="secondary-wide" :disabled="!!((aiBusy))" @tap="handlers.retryAi">查看上次结果</button>
<button class="secondary-wide" :disabled="!!((aiBusy))" @tap="handlers.newAiTask">重新生成</button>
</view>
<AiResult :ai-task="aiTask" :ai-busy="aiBusy" :screen="screen" :selected="selected" :suggestion-category="suggestionCategory" :handlers="handlers" />
<template v-for="(item, index) in recommendations" :key="item.index">
<view class="cloud-panel">
<view class="outfit-photos">
<template v-for="(garment, index) in item.garments" :key="garment.id">
<view>
<image :src="displayPath((garment?.image))" mode="aspectFit">
</image>
<text class="tiny">{{ garment?.name }}</text>
</view>
</template>
</view>
<text>{{ item?.reason }}</text>
<text v-if="item?.missing" class="cloud-warning">部分衣物已不可用，请手动替换。</text>
<button class="secondary-wide" :data-index="(index)" @tap="handlers.useRecommendation">查看 / 手动替换后收藏</button>
</view>
</template>
<view class="section-title">
<text>智能 任务历史</text>
<text class="link" @tap="handlers.refreshAiHistory">刷新</text>
</view>
<view class="cloud-panel">
<template v-for="(item, index) in aiHistory" :key="item.id">
<view class="cloud-list-row" :data-id="(item?.id)" @tap="handlers.openAiTask">
<text>{{ item?.type === 'recognize' ? '衣物识别' : '搭配推荐' }}</text>
<text class="muted">{{ item?.status === 'succeeded' ? '已完成' : item?.status === 'running' ? '处理中' : item?.status === 'unknown' ? '结果未知' : '未成功' }} ›</text>
</view>
</template>
<text v-if="!aiHistory?.length" class="muted">还没有任务记录</text>
</view>
<button v-if="aiCursor" class="secondary-wide" :disabled="!!((aiBusy))" @tap="handlers.moreAiHistory">更多历史</button>
</template>
<template v-if="ready && family && screen === 'locations'">
<view class="intro">
<text class="title-xl">让每一件，有固定归处</text>
<text class="muted">全家共享两级收纳位置。点位置可改名、移动或删除。</text>
</view>
<button class="primary-button" :disabled="!!((saving))" @tap="handlers.createLocation">新增一级位置</button>
<view class="cloud-panel">
<template v-for="(item, index) in locations" :key="item.id">
<view :class="'cloud-list-row ' + (item?.parentId ? 'location-child' : '')">
<text class="location-name" :data-id="(item?.id)" @tap="handlers.editLocation">{{ item?.parentId ? '↳ ' : '' }}{{ item?.name }} ›</text>
<text v-if="!item?.parentId" class="link" :data-parent="(item?.id)" @tap="handlers.createLocation">＋ 二级</text>
</view>
</template>
<text v-if="!locations?.length" class="muted">还没有收纳位置，先加一个衣柜吧。</text>
</view>
</template>
<template v-if="ready && family && screen === 'account'">
<view class="intro">
<text class="title-xl">一家人的日常，一起照顾</text>
</view>
<view class="home-card">
<view class="home-card-info">
<text class="section-title-text">{{ family?.name }}</text>
</view>
<text v-if="family?.role === 'owner'" class="link" @tap="handlers.renameFamily">改名</text>
</view>
<view class="section-title">
<text>家庭成员档案</text>
<text class="link" @tap="handlers.addMember">＋ 新增</text>
</view>
<view class="cloud-panel">
<template v-for="(item, index) in members" :key="item.id">
<view class="cloud-list-row" :data-id="(item?.id)" @tap="handlers.renameMember">
<view class="avatar small">{{ (item?.name)?.[0] }}</view>
<text>{{ item?.name }}</text>
<text class="link">改名 ›</text>
</view>
</template>
</view>
</template>
<view class="cloud-help">
<text class="link" @tap="handlers.viewPrivacy">隐私保护指引</text>
</view>
</view>
<view v-if="screen === 'account' && ready" class="account-access"><AppUpdatePanel manual /></view></scroll-view>
<AppUpdatePanel v-if="screen !== 'account' || !ready" />
<view class="bottom-nav cloud-nav">
<view class="nav-item" @tap="handlers.goHome">
<image :src="displayPath((assets?.imgSprout))" mode="aspectFit">
</image>
<text>首页</text>
</view>
<view :class="'nav-item ' + (screen === 'account' ? 'active' : '') + ' ' + (!ready && loading ? 'nav-pending' : '')" :aria-disabled="(!ready && loading)" data-screen="account" @tap="handlers.nav">
<image :src="displayPath((assets?.imgUserRound))" mode="aspectFit">
</image>
<text>我的家庭</text>
</view>
</view>
<view v-if="showPrivacy" class="privacy-mask">
<view class="privacy-dialog">
<text class="section-title-text">上传衣物照片前，请阅读</text>
<text class="muted">为保存衣物并与同一家庭共享，需要使用你选择或拍摄的照片。未保存照片会暂存本机以便继续录入，退出家庭时清除。选图后将自动智能识别名称和颜色。你可以拒绝并继续浏览。</text>
<text class="link" @tap="handlers.viewPrivacy">{{ privacyContractName }}</text>
<button v-if="isWechat" class="primary-button" id="agree-privacy" open-type="agreePrivacyAuthorization" @agreeprivacyauthorization="handlers.agreePrivacy">同意并继续选图</button>
<button v-else class="primary-button" @tap="handlers.agreePrivacy">同意并继续选图</button>
<button class="secondary-wide" @tap="handlers.declinePrivacy">暂不使用</button>
</view>
</view>
</view></template>
<style>
@import "../../styles/base.css";
.loading-preview > text { display: block; margin-bottom: 18rpx; }
.loading-members { display: flex; gap: 16rpx; margin: 28rpx 0; }
.loading-members > view { width: 105rpx; height: 54rpx; border-radius: 28rpx; background: #e9ede3; }
.loading-card { padding: 16rpx; border-radius: 22rpx; background: #fffefa; }
.loading-photo { height: 280rpx; border-radius: 16rpx; background: #ecefe6; }
.loading-line { width: 65%; height: 24rpx; margin: 20rpx 0 10rpx; border-radius: 8rpx; background: #e5e9de; }
.cloud-shell { height: 100vh; min-height: 0; display: flex; flex-direction: column; box-sizing: border-box; }
.cloud-shell .cloud-header { flex-shrink: 0; }
.cloud-header { height: 100rpx; display: flex; align-items: center; gap: 16rpx; padding: 0 36rpx; font-size: 30rpx; font-weight: 600; }
.cloud-header > image { width: 40rpx; height: 40rpx; }
.cloud-header-tag { font-size: 20rpx; color: #6c7963; font-weight: 400; }
.cloud-scroll { flex: 1; height: 0; }
.cloud-error { background: #faeee8; color: #9b4d38; padding: 24rpx; border-radius: 16rpx; margin-bottom: 24rpx; font-size: 25rpx; }
.cloud-error text { display: block; }
.cloud-error .link { margin-top: 12rpx; }
.cloud-welcome,.cloud-empty { display: flex; flex-direction: column; align-items: center; gap: 24rpx; text-align: center; padding: 60rpx 24rpx; }
.cloud-welcome > image { width: 90rpx; height: 90rpx; margin-bottom: 15rpx; }
.cloud-welcome > text:first-of-type { font-size: 32rpx; }
.cloud-empty > image { width: 86rpx; height: 86rpx; opacity: .45; }
.cloud-panel { background: #fffefa; border: 1rpx solid #e5e7da; border-radius: 22rpx; padding: 28rpx; margin-bottom: 20rpx; }
.cloud-panel > text { display: block; line-height: 1.8; font-size: 26rpx; }
.cloud-label { font-size: 26rpx; margin-bottom: 16rpx; }
.invite-input { width: 100%; height: 130rpx; font-size: 25rpx; word-break: break-all; padding: 16rpx 0; }
.invite-preview { border-top: 1rpx solid #e5e7da; margin-top: 25rpx; padding-top: 25rpx; }
.invite-preview > text { display: block; margin-bottom: 15rpx; }
.invite-code { word-break: break-all; font-family: monospace; font-size: 23rpx; margin: 20rpx 0; user-select: text; }
.cloud-photo { min-height: 390rpx; border: 1rpx solid #e5e7da; border-radius: 28rpx; background: #f0f1e8; display: flex; flex-direction: column; justify-content: center; align-items: center; margin-bottom: 26rpx; padding: 20rpx; }
.cloud-photo > image { width: 100%; height: 420rpx; }
.cloud-photo-empty { display: flex; flex-direction: column; align-items: center; gap: 20rpx; }
.cloud-photo-empty > image { width: 54rpx; height: 54rpx; }
.cloud-form > view { display: flex; justify-content: space-between; align-items: center; min-height: 90rpx; gap: 24rpx; border-bottom: 1rpx solid #eef0e5; }
.cloud-form > view:last-child { border-bottom: none; }
.cloud-form > view > text { font-size: 26rpx; color: #7b8274; flex-shrink: 0; }
.cloud-form input { font-size: 26rpx; text-align: right; flex: 1; }
.cloud-form picker { flex: 1; text-align: right; font-size: 26rpx; }
.cloud-list-row { display: flex; gap: 16rpx; align-items: center; min-height: 85rpx; font-size: 27rpx; border-bottom: 1rpx solid #eef0e5; }
.cloud-list-row:last-child { border-bottom: none; }
.cloud-list-row > text:last-child { margin-left: auto; }
.wardrobe-tools { display: flex; justify-content: flex-end; margin: 32rpx 0 12rpx; font-size: 24rpx; }
.cloud-loading { display: block; text-align: center; padding: 25rpx; color: #7b8274; font-size: 24rpx; }
.cloud-danger { background: transparent; color: #a64538; font-size: 27rpx; margin: 28rpx 0; }
button.batch-clear-button { display: flex; align-items: center; justify-content: center; width: 100%; height: 82rpx; margin: 20rpx 0 0; padding: 0 20rpx; border: 1rpx solid #e4beb4; border-radius: 22rpx; background: #faece7; color: #a64538; font-size: 26rpx; font-weight: 600; white-space: nowrap; }
.cloud-help { display: flex; justify-content: center; gap: 40rpx; margin: 38rpx 0; font-size: 24rpx; }
.privacy-mask { position: fixed; inset: 0; z-index: 100; background: rgba(25, 37, 28, .45); display: flex; align-items: center; justify-content: center; padding: 40rpx; }
.privacy-dialog { background: #fffefa; padding: 40rpx; border-radius: 28rpx; width: 100%; }
.privacy-dialog > text { display: block; margin-bottom: 24rpx; line-height: 1.7; }
.cloud-nav { position: relative; flex-shrink: 0; padding-bottom: env(safe-area-inset-bottom); height: 106rpx; }
.cloud-nav .nav-item { flex: 1; }
.cloud-nav .nav-pending { opacity: .45; }
button { box-sizing: border-box; line-height: 1.4; font-family: inherit; }
button::after { border: none; }
button.primary-button { width: 100%; margin: 26rpx 0; font-size: 28rpx; }
button.secondary-wide { font-size: 26rpx; width: 100%; margin-top: 20rpx; }
button.secondary-button { font-size: 24rpx; flex: 1; }
button[disabled] { opacity: .55; }
button.secondary-wide[disabled] { background: #e8ebe1; color: #6e7965; opacity: .8; }
.cloud-shell .home-card { gap: 22rpx; }
.cloud-shell .home-card-info { flex: 1; min-width: 0; }
.cloud-shell .home-card-info > text { display: block; }
.cloud-shell .garment-photo > text.muted { font-size: 22rpx; padding: 20rpx; }
.cloud-shell .title-xl { line-height: 1.5; }
.cloud-search { display: flex; gap: 12rpx; align-items: center; background: #fffefa; border: 1rpx solid #e5e7da; border-radius: 18rpx; padding: 8rpx 12rpx; margin: 20rpx 0; }
.cloud-search input { width: 0; min-width: 0; flex: 1; height: 64rpx; font-size: 25rpx; }
.cloud-search .search-submit { flex: none; width: 104rpx; min-width: 0; height: 64rpx; display: flex; align-items: center; justify-content: center; background: #e8eddf; color: #526848; border-radius: 12rpx; font-size: 24rpx; line-height: 1; padding: 0; margin: 0; }
.cloud-search .link { flex: none; font-size: 24rpx; white-space: nowrap; padding: 18rpx 0; }
.wardrobe-heading { gap: 16rpx; }
.wardrobe-heading-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wardrobe-heading-actions { display: flex; flex: none; align-items: center; gap: 18rpx; }
.wardrobe-heading-actions .wardrobe-action { flex: none; width: auto; min-width: 168rpx; min-height: 68rpx; display: flex; align-items: center; justify-content: center; padding: 0 18rpx; margin: 0; border-radius: 14rpx; background: #456b53; color: #fff; font-size: 25rpx; font-weight: 600; white-space: nowrap; }
.cloud-shell .chip-row { flex-wrap: wrap; }
.garment-card { box-sizing: border-box; border: 3rpx solid transparent; }
.garment-card.garment-selected { border-color: #7d926e; }
.selection-mark { position: absolute; top: 15rpx; left: 15rpx; background: #fffefa; color: #60794e; border: 1rpx solid #c5cfba; width: 38rpx; height: 38rpx; border-radius: 50%; text-align: center; line-height: 38rpx; z-index: 2; font-size: 26rpx; }
.bulk-toolbar .button-row { margin-top: 18rpx; }
.danger-text { color: #a64538 !important; }
.cloud-warning { display: block; color: #a26d35; font-size: 24rpx; line-height: 1.7; margin: 12rpx 0; }
.batch-strip { margin: 24rpx 0; width: 100%; white-space: nowrap; }
.batch-strip-inner { display: flex; gap: 14rpx; padding: 4rpx; }
.batch-thumb { width: 145rpx; flex-shrink: 0; border: 3rpx solid transparent; border-radius: 16rpx; overflow: hidden; background: #f0f1e8; }
.batch-thumb.active { border-color: #7d926e; }
.batch-thumb image { width: 145rpx; height: 145rpx; display: block; }
.batch-thumb text { display: block; text-align: center; font-size: 21rpx; padding: 12rpx 0; }
.cloud-shell .button-row { display: flex; gap: 16rpx; margin: 20rpx 0; }
.outfit-card { margin-top: 24rpx; }
.outfit-photos { display: flex; gap: 12rpx; margin-bottom: 20rpx; }
.outfit-photos > view { flex: 1; min-width: 0; border-radius: 16rpx; background: #f0f1e8; text-align: center; overflow: hidden; }
.outfit-photos image { display: block; width: 100%; height: 220rpx; }
.outfit-photos text { display: block; padding: 8rpx; font-size: 22rpx; }
.picked-garment { display: flex; align-items: center; gap: 20rpx; }
.picked-garment > image { width: 110rpx; height: 130rpx; border-radius: 12rpx; background: #f0f1e8; flex-shrink: 0; }
.picked-garment > view { flex: 1; min-width: 0; }
.picked-garment text { display: block; font-size: 26rpx; }
.suggestions > text { display: block; font-size: 24rpx; margin-top: 20rpx; }
.suggestion-row { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; padding: 14rpx 0; border-bottom: 1rpx solid #eef0e5; }
.suggestion-row > text { flex: 1; min-width: 0; font-size: 25rpx; }
.suggestion-row button { font-size: 23rpx; background: #e8eddf; color: #526848; margin: 0; padding: 12rpx 20rpx; flex-shrink: 0; }
.ai-result { margin-top: 24rpx; }
.cloud-list-row.location-child { padding-left: 36rpx; }
.location-name { flex: 1; min-width: 0; }
.cutout-preview { width: 100%; height: 420rpx; background: repeating-conic-gradient(#e8e9df 0% 25%, #fffefa 0% 50%) 50% / 28rpx 28rpx; }

.account-access{padding:24rpx 36rpx;}
</style>
