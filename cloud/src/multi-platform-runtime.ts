import cloud from 'wx-server-sdk';
import { createRepository, createStorage } from './adapter';
import { createAuthService } from './auth-service';
import { createGateway, configuredOrigins } from './gateway';
import { createService } from './service';
import { createAiService } from './ai-service';
import { createDeepSeekClient } from './deepseek';
import { createCiCutout } from './ci-cutout';
import { createCutoutService } from './cutout-service';
import { createPhotoCutoutService } from './photo-cutout-service';
import { Input } from './model';
import { checkAndroidUpdate } from './app-update';

cloud.init({ env: 'wardrobe-dev-cloude-d5bv128b6099' });
const repo = createRepository(), storage = createStorage(), business = createService(repo, storage);
const ai = createAiService(repo, createDeepSeekClient({ apiKey: process.env.DEEPSEEK_API_KEY }), async fileID => {
  const result = await cloud.downloadFile({ fileID }); return result.fileContent;
}, { dailyLimit: Number(process.env.AI_DAILY_LIMIT || 30) });
const provider = createCiCutout({ bucket: 'family-wardrobe-cutout-1306311302', region: 'ap-shanghai', credentials: () => ({
  secretId: process.env.TENCENTCLOUD_SECRETID || '', secretKey: process.env.TENCENTCLOUD_SECRETKEY || '', token: process.env.TENCENTCLOUD_SESSIONTOKEN,
}) });
const cutout = createCutoutService(repo, provider, async fileId => {
  const urls = await storage.urls([fileId]); if (!urls[fileId]) throw new Error('IMAGE_UNAVAILABLE'); return urls[fileId];
}, { storage });
const photoCutout = createPhotoCutoutService(repo, provider);
const gateway = createGateway({
  updates: data => checkAndroidUpdate(data, process.env.ANDROID_UPDATE_RELEASE || ''),
  auth: createAuthService(repo), allowedOrigins: configuredOrigins(process.env.CLOUD_API_ALLOWED_ORIGINS || ''),
  clientIp: () => process.env.TCB_SOURCE_IP || '',
  wxIdentity: () => {
    const context = cloud.getWXContext();
    return { openid: context.OPENID || '', appid: context.APPID || '', source: context.SOURCE || '' };
  },
  dispatch: (group, input, identity) => {
    if (group === 'ai') return ai(input, identity);
    if (group === 'cutout') return (['getPhoto', 'processPhoto'].includes(String(input.action)) ? photoCutout : cutout)(input, identity);
    return business(group, input, identity);
  },
});
export async function invokeMultiPlatform(event: Input) {
  try { return await gateway(event); }
  finally {
    for (const key of ['WX_OPENID', 'WX_APPID', 'WX_UNIONID', 'OPENID', 'APPID', 'UNIONID', 'WX_CONTEXT_KEYS', 'TCB_SOURCE', 'TCB_SOURCE_IP']) delete process.env[key];
  }
}
