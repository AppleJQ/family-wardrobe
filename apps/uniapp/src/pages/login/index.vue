<script setup lang="ts">
import {ref,computed} from 'vue';import {onLoad} from '@dcloudio/uni-app';
import {authCall} from '../../services/cloud';import {setSession,type Session} from '../../services/session';import {isWechat} from '../../platform/runtime';
import AppUpdatePanel from '../../components/AppUpdatePanel.vue';
const mode=ref<'login'|'register'|'bind'>('login'),username=ref(''),password=ref(''),confirmation=ref(''),busy=ref(false),error=ref(''),returnTo=ref('/pages/home/index'),agreed=ref(false);
const title=computed(()=>mode.value==='bind'?'让同一个家，跨设备相见':mode.value==='register'?'给一家人的日常，安个家':'欢迎回到我们的家');
onLoad(options=>{mode.value=options?.mode==='bind'&&isWechat?'bind':'login';const target=options?.returnTo?decodeURIComponent(options.returnTo):'';if(/^\/pages\/(home|cloud)\/index(\?section=(account|wardrobe))?$/.test(target))returnTo.value=target;});
function switchMode(){mode.value=mode.value==='login'?'register':'login';password.value='';confirmation.value='';error.value='';}
function privacy(){uni.navigateTo({url:'/pages/privacy/index'});}
async function submit(){
  if(busy.value)return;error.value='';
  if(!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username.value.trim().toLowerCase())){error.value='账号用3～32位英文字母、数字、下划线、点或短横线';return;}
  if(password.value.length<10||password.value.length>128){error.value='密码需为10～128位';return;}
  if(mode.value!=='login'&&password.value!==confirmation.value){error.value='两次输入的密码不一致';return;}
  if(!agreed.value){error.value='请先阅读并同意隐私保护指引';return;}
  busy.value=true;
  try{
    const result=await authCall<Session>(mode.value,{username:username.value.trim().toLowerCase(),password:password.value});
    password.value='';confirmation.value='';
    if(mode.value==='bind'){uni.showToast({title:'账号已绑定',icon:'success'});uni.reLaunch({url:'/pages/home/index'});}
    else{setSession(result);uni.reLaunch({url:returnTo.value});}
  }catch(e){error.value=e instanceof Error?e.message:'暂时无法登录，请稍后重试';}finally{busy.value=false;}
}
</script>
<template><view class="login-page"><text class="login-brand">小猪猪的家</text><text class="login-title">{{title}}</text><text class="login-note">{{mode==='bind'?'绑定后，使用这个账号登录其他设备，家庭和衣物都会保留。':mode==='register'?'已有微信衣橱？请先在微信小程序绑定账号，再回到这里登录。':'使用绑定的账号，和家人一起照顾日常。'}}</text><view class="login-form"><text>账号</text><input v-model="username" maxlength="32" placeholder="英文字母、数字，至少3位" :disabled="busy"/><text>密码</text><input v-model="password" :password="true" maxlength="128" placeholder="至少10位，请妥善保存" :disabled="busy"/><template v-if="mode!=='login'"><text>确认密码</text><input v-model="confirmation" :password="true" maxlength="128" placeholder="再输入一次密码" :disabled="busy"/></template><view class="privacy-consent" @tap="agreed=!agreed"><text>{{agreed?'☑':'□'}} 我已阅读并同意</text><text class="privacy-link" @tap.stop="privacy">隐私保护指引</text></view><text v-if="error" class="login-error">{{error}}</text><button class="login-submit" :loading="busy" :disabled="busy" @tap="submit">{{mode==='bind'?'绑定当前微信账号':mode==='register'?'创建账号':'登录'}}</button><button v-if="mode!=='bind'" class="login-switch" :disabled="busy" @tap="switchMode">{{mode==='login'?'还没有账号？创建一个':'已有账号？去登录'}}</button></view></view><AppUpdatePanel /></template>
<style scoped>.login-page{max-width:540px;margin:0 auto;padding:80rpx 42rpx;}.login-brand{display:block;color:#70816e;letter-spacing:4rpx;font-size:26rpx;}.login-title{display:block;font-size:48rpx;font-weight:700;line-height:1.5;margin:40rpx 0 24rpx;}.login-note{display:block;color:#788274;font-size:25rpx;line-height:1.8;}.login-form{margin-top:44rpx;padding:32rpx;background:#fffefa;border-radius:24rpx;}.login-form>text{display:block;margin:20rpx 0 12rpx;}.login-form input{padding:20rpx;border:1px solid #e2e7da;border-radius:14rpx;height:92rpx;font-size:28rpx;}.privacy-consent{display:flex;flex-wrap:wrap;gap:8rpx;margin:28rpx 0;font-size:23rpx;color:#75826b;}.privacy-link{color:#48623e;}.login-submit{background:#7d926e;color:white;border-radius:18rpx;font-size:29rpx;}.login-switch{background:transparent;color:#617759;font-size:25rpx;margin-top:16rpx;}.login-form .login-error{color:#a34e38;font-size:24rpx;line-height:1.6;}</style>
