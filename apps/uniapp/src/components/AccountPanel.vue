<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue';
import {authCall} from '../services/cloud';
import {isWechat} from '../platform/runtime';
import {clearSession,getSession} from '../services/session';
const username=ref(getSession()?.username||'');const busy=ref(false);const error=ref('');
const bindingReady=ref(!isWechat);
const accountId=getSession()?.userId||'';let disposed=false;
const sameAccount=()=>!disposed&&(getSession()?.userId||'')===accountId;
onUnmounted(()=>{disposed=true;});
onMounted(async()=>{
  if(!isWechat)return;
  try{
    const me=await authCall<{username:string}>('me');
    if(sameAccount()){username.value=me.username;bindingReady.value=true;}
  }catch{if(sameAccount())error.value='暂时无法读取账号绑定状态';}
});
function bind(){if(isWechat&&bindingReady.value&&!username.value&&sameAccount())uni.navigateTo({url:'/pages/login/index?mode=bind'});}
async function logout(){
  if(isWechat||busy.value||!accountId||!sameAccount())return;
  busy.value=true;error.value='';let dispatchedToken='';
  try{
    const confirmation=await uni.showModal({title:'退出登录？',content:'已保存的家庭衣物会保留。未保存的照片草稿只留在本机。'});
    if(!confirmation.confirm||!sameAccount())return;
    const session=getSession();if(!session||session.userId!==accountId)return;
    dispatchedToken=session.token;
    await authCall('logout');
    if(!sameAccount()||getSession()?.token!==dispatchedToken)return;
    busy.value=false;clearSession();uni.reLaunch({url:'/pages/login/index'});
  }catch(e){if(sameAccount()&&(!dispatchedToken||getSession()?.token===dispatchedToken))error.value=e instanceof Error?e.message:'退出失败';}
  finally{if(sameAccount())busy.value=false;}
}
</script>
<template>
  <view v-if="bindingReady || error" class="account-panel">
    <template v-if="bindingReady">
      <text class="account-title">{{username?'账号：'+username:'多设备使用'}}</text>
      <text v-if="isWechat&&!username" class="account-note">为当前微信绑定一个账号，即可在网页、安卓和鸿蒙中打开同一个家。</text>
      <button v-if="isWechat&&!username" class="account-button" @tap="bind">绑定登录账号</button>
      <button v-if="!isWechat" class="account-button" :disabled="busy" @tap="logout">退出登录</button>
    </template>
    <text v-if="error" class="account-error">{{error}}</text>
  </view>
</template>
<style scoped>.account-panel{padding:26rpx;border-radius:22rpx;background:#fffefa;}.account-title,.account-note,.account-error{display:block;}.account-title{font-size:26rpx;font-weight:600;}.account-note{margin-top:14rpx;font-size:23rpx;line-height:1.8;color:#788274;}.account-button{margin-top:20rpx;background:#edf1e7;color:#445d3b;font-size:25rpx;border-radius:16rpx;}.account-error{margin-top:12rpx;font-size:23rpx;color:#9b4d38;}</style>
