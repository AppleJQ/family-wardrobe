<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { initFiles } from './platform/files';
import { CLOUD_ENV } from './config/cloud';
import {watchSessionChanges} from './services/session';
import { checkStartupUpdate } from './services/app-update';
onLaunch(() => {
  // #ifdef MP-WEIXIN
  wx.cloud.init({env:CLOUD_ENV});
  // #endif
  void initFiles().catch(()=>{});
  watchSessionChanges();
  checkStartupUpdate();
});
</script>
<style>
page { background:#f8f7f2; color:#29372f; font-family:'PingFang SC','Microsoft YaHei',sans-serif; font-size:28rpx; }
button::after { border:0; }
view,text,image { box-sizing:border-box; }
button { cursor:pointer; }
</style>
