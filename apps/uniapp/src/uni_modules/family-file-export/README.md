# 系统文件导出

仅用于导出本应用沙盒中生成的 `wardrobe-<时间戳>.zip`。导出不会开放公共文件读取，不请求公共存储权限，不提供任意URL下载或文件查看器入口。

- Android：通过 `ACTION_CREATE_DOCUMENT`、`CATEGORY_OPENABLE` 和 `EXTRA_TITLE` 显示系统保存窗口，只处理本插件请求编号的结果。成功后使用系统授予的content URI写入原始ZIP字节并关闭流；取消、写入失败、无Activity或重复操作分别返回错误。
- 鸿蒙：通过 `UTSHarmony.getUIAbilityContext()` 和 CoreFileKit `DocumentViewPicker.save` 显示系统保存窗口，使用 `newFileNames` 提议名称。只从本应用filesDir读取导出包，将原始文件描述符复制到用户选择的目标文件描述符，并在所有成功/失败路径关闭已打开的文件。
- 成功回调只表示文件已写入并关闭。用户取消返回 `code: CANCELLED`；业务层转换成带相同code的 `AbortError`。插件不返回用户目标URI、不保存持久授权、不自动创建公共目录。

该插件针对传统 uni-app Vue3，通过 `@/uni_modules/family-file-export` 导入。`utssdk/interface.uts`声明原生接口，`index.d.ts`仅提供前端TypeScript类型。Android二进制复制使用DCloud支持的Kotlin混编。

官方依据：

- [Android文档Intent](https://developer.android.com/guide/components/intents-common)：ACTION_CREATE_DOCUMENT及返回content URI。
- [DCloud UTSAndroid](https://doc.dcloud.net.cn/uni-app-x/uts/utsandroid.html)：getUniActivity、onAppActivityResult及只移除当前回调的offAppActivityResult，支持传统uni-app的UTS插件。
- [DCloud Kotlin混编](https://uniapp.dcloud.net.cn/plugin/uts-plugin-hybrid.html)：在app-android中放置Kotlin源文件。
- [DCloud UTSHarmony](https://doc.dcloud.net.cn/uni-app-x/uts/utsharmony.html)：传统uni-app鸿蒙插件4.31起支持getUIAbilityContext。
- [鸿蒙DocumentViewPicker](https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V13/js-apis-file-picker-V13)：save、DocumentSaveOptions和newFileNames。
- [鸿蒙文件IO](https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V13/js-apis-file-fs-V13)：通过文件描述符copyFileSync、openSync和closeSync。

CLI资源编译需要与uni-app版本完全一致的 `@dcloudio/uni-uts-v1`。资源编译及本地桥接测试不能替代Kotlin/ArkTS原生编译和真机验证；最终打包仍需要HBuilderX、对应Android/鸿蒙SDK、应用标识及签名。验收应保存含非ASCII名称的ZIP、取消保存、磁盘写入失败，并比较导出前后ZIP字节/校验和与可解压性。
