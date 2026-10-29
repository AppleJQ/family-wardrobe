# 小猪猪的家 · uni-app 四端

Vue 3 + TypeScript 共用家庭首页、家庭设置与衣橱页面，输出微信小程序、H5、Android 和 HarmonyOS NEXT 应用资源。原生微信工程保留在仓库的 miniprogram/，方便比较和回退。

## 本机运行

前端编译器要求 Node.js >=22.12；已有云函数仍运行 Nodejs20.19。首次使用：

```sh
npm ci
cd apps/uniapp
npm ci
cp .env.example .env.local
npm run dev:h5
```

根目录的 `npm run check:uni` 检查 Vue 和 TypeScript；`npm run build:uni` 顺序构建四个目标并核对成功标记及实际输出。也可单独运行 `build:uni:h5`、`build:uni:weixin`、`build:uni:android`、`build:uni:harmony`。

开发 H5 默认地址为 http://127.0.0.1:5178/。部署其他 H5 域名或更换开发端口时，需要把其完整 Origin 加入后端 `CLOUD_API_ALLOWED_ORIGINS`；客户端只配置公开 HTTPS 网关地址，不放任何云密钥。

## 账号和数据

微信继续使用可信微信身份。微信端“绑定登录账号”把一个新的用户名和密码绑定到原有业务用户；其他三端使用该账号登录，就能访问原家庭和衣物。绑定不创建第二份家庭，不修改原衣物归属，也不自动合并两个已存在的账号。

第一次从网页注册得到独立账号，可创建家庭或凭邀请码加入。已有微信衣橱的用户应先在微信端绑定，再登录其他端。当前没有忘记密码或短信找回流程，密码由用户妥善保管。

微信端仍调用原事件函数，绑定/查询账号调用 `multiPlatformApi`；H5 和两种 App 通过 HTTPS Bearer 会话调用同一领域服务。家庭权限、成员与账号的区别、版本冲突、回收站和图片授权保持原有规则。详细接口与部署见 ../../cloud/README.md。

## 照片与本机文件

- H5：IndexedDB 保存照片草稿，渲染使用本地 Blob URL；大图通过 Canvas 按比例缩小并编码 JPEG。
- 微信：使用微信私有文件系统和压缩接口。
- Android：使用应用私有文件与 Android 二进制写入桥接。
- 鸿蒙：使用 uni-app 鸿蒙文件系统。
- 小型透明 PNG 保留透明度；去背景预览单独保存，替换及正式上传沿用服务端校验。选图之后自动识别，异常可手动填写，不自动重复付费任务。
- 导出读取受鉴权照片字节、完整分页并生成 ZIP；浏览器下载、微信分享、Android/鸿蒙调用系统文件保存对话框。原生插件源码在 src/uni_modules/family-file-export/。

## 运行和发行产物

| 目标 | 资源目录 | 下一步 |
|---|---|---|
| H5 | dist/build/h5 | 静态服务器部署，配置精确 Origin |
| 微信 | dist/build/mp-weixin | 微信开发者工具打开该目录；预览、真机与提审分别验收 |
| Android | dist/build/app | HBuilderX 关联有效 DCloud AppID，选择 Android SDK/签名后生成 APK |
| 鸿蒙 | dist/build/app-harmony | HBuilderX + DevEco/HarmonyOS SDK，配置 bundleName 与签名后生成鸿蒙 APP 包 |

**资源编译与原生安装分别验证。** 2026-10-28 已关联 DCloud AppID，使用 HBuilderX 5.33 自带的 HarmonyLauncher 和 DevEco Studio 26.0.0.851 完成鸿蒙原生编译，包含文件导出插件的 ArkTS 编译；未签名 HAP 已安装到本机 HarmonyOS 6.0.1/API21 的 x86_64 模拟器，登录页显示正常。首次启动出现生命周期超时，重新启动后正常。安装包保存在 dist/release/hap/family-home-0.3.0-emulator-unsigned.hap，仅用于模拟器；鸿蒙真机仍需包含设备 UDID 的调试签名，登录后业务、拍照、系统选图和保存尚未在鸿蒙验收。本轮未验证 Android 安装包或真机。

默认包标识为 com.applejq.familyhome；正式上架前按用户开发者账号配置，并核对平台隐私与权限材料。当前代码不自动发布微信或应用商店。

## Android 应用更新

0.3.1/301 源码起包含 APK 更新功能：每次冷启动检查一次，“我的家庭”也可手动检查；用户选择下载或稍后，下载显示进度并可取消。下载完成校验大小、SHA256、APK实际包名/版本和与当前应用相同的签名，用户同意后打开系统安装界面。安装来源授权由用户在系统设置完成。取消或失败可重试，不卸载旧应用，不做静默安装或资源热更。

入口仅在 Android 显示，H5、微信和鸿蒙不触发 APK 更新。首次必须手动安装一次含此功能的 APK；旧0.3.0包不会自动获得检查能力。用户取消本轮云打包并要求先完成代码，因此尚未生成0.3.1 APK或完成Android真机安装验证。

版本来自现有 CloudBase 网关 `updates.check`，不要求登录，也不发送账号令牌。服务端读取 multiPlatformApi 环境变量 `ANDROID_UPDATE_RELEASE`；未配置或清空时返回 `release:null`。发行步骤见 ../../cloud/README.md 的“Android APK 版本发布”。

在仓库根目录执行以下命令，从实际 APK 读取包名/版本并计算大小及SHA256，生成发布JSON：

```sh
node scripts/prepare-android-update.cjs --apk /path/family-home.apk --url https://your-download-domain/releases/family-home-302.apk --notes /path/release-notes.txt
```

命令只生成本地 JSON，不上传或宣布发布。下载地址应长期可用并提供与本地完全一致的APK，签名必须与旧版相同；不要用过期临时链接或覆盖同版本文件。Google Play等商店渠道另按对应更新政策适配。

## 代码边界

controllers/ 保留现有业务流程及并发保护，每次页面创建独立实例；platform/page-state.ts 将原页面状态更新接到 Vue 响应式系统。platform/ 集中处理请求之外的设备差异，services/ 使用统一云契约。页面模板为 Vue SFC，运行时不解析 WXML，也不内嵌旧小程序页面。

测试和合成联调文件只留在仓库 .tmp/，不提交；dist/、node_modules/、.env.local、证书和签名文件也不提交。
