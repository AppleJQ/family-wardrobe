# 云端接口与部署

仅使用已绑定小程序的文档数据库环境 `wardrobe-dev-cloude-d5bv128b6099`，旧 PG 环境不参与。函数运行时 Nodejs20.19 Event，入口 index.main，超时30秒。原业务函数继续只接受 wx.cloud.callFunction；四端账号登录只通过新增 `multiPlatformApi` 的 HTTP 访问服务，微信账号绑定仍调用该函数的 Event 入口。新增cutout事件函数接腾讯云数据万象。

运行 `npm run build:cloud`，通过微信开发者工具或 CloudBase MCP 按需部署 `.cloudbuild/` 下的函数目录，开启依赖安装。新增的 `ai` 独立部署；仅改 AI 代码时不重新部署既有六个函数。可维护源码在 cloud/src。图片处理为纯 JavaScript，无原生图片库依赖。

| 函数 | action | 参数 |
| --- | --- | --- |
| bootstrapUser | bootstrap | 无，身份取可信微信上下文 |
| families | create / get / rename | create: name, memberName；rename: name |
| families | remove / transfer / leave | remove/transfer: userId，仅管理员操作他人 |
| familyInvites | create / revoke | revoke: inviteId |
| familyInvites | preview / accept | token；accept另需confirmed=true |
| members | list / create / rename | create: name；rename: memberId, name, version |
| garments | beginUpload | memberId, name, category；可选requestId/status/location/locationId/notes/color/season/material |
| garments | upload | garmentId, base64，仅草稿原上传者 |
| garments | save | 新录入单次保存：beginUpload同一表单参数、requestId、base64，可选transparent；返回衣物视图，沿用同编号幂等 |
| garments | list | 与wardrobe.list共用搜索/组合筛选与分页契约，见V0.2说明 |
| garments | get / image | garmentId，服务端映射实际文件ID |
| garments | update / delete | garmentId, version；update另需patch |
| cleanupUploads | 内部清理 | 无客户端入口，每小时补偿过期草稿、孤立文件、purging和30天回收站到期图片 |
| wardrobe | V0.2领域接口 | 搜索、批量整理、回收站、收纳位置、云端搭配、导出分页，见下文 |

返回 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`。常用错误为 UNAUTHENTICATED、NO_FAMILY、FORBIDDEN、NOT_FOUND、HAS_FAMILY、INVITE_INVALID、RATE_LIMITED、CONFLICT、UPLOAD_INVALID、INVALID_IMAGE。未知错误只返回固定消息，不输出环境变量、身份上下文、原始事件或凭据。

## 数据与权限

基础集合：users、families、family_memberships、family_members、garments、family_invites。AI增加ai_tasks，V0.2增加locations、outfits。用户和membership使用确定性_id。邀请令牌随机生成，数据库只存SHA-256摘要，24小时有效、单次使用，可撤销；预览/接受限每用户每分钟10次。

衣物档案不授予登录权限，每个账号只允许一个有效家庭。创建/加入/移出/移交使用事务；所有写操作检查当前家庭关系，并写membership作为撤权并发保护。衣物和档案携带version，避免覆盖家人刚保存的修改。

garments.status是生命周期（uploading/active/deleted/purging/expired/discarded），wearStatus是可穿/待洗/收纳/淘汰。正式列表仅返回active，V0.2默认隐藏淘汰；删除后保留30天恢复期。purging/expired不能恢复，文件删除成功后置discarded。

所有集合（包括ai_tasks、locations、outfits）禁止客户端直读写：

```json
{"read":false,"write":false,"create":false,"update":false,"delete":false}
```

存储桶仅服务端读写：

```json
{"read":false,"write":false}
```

环境函数规则：

```json
{
  "*":{"invoke":"auth.loginType != 'ANONYMOUS' && auth != null"},
  "cleanupUploads":{"invoke":false}
}
```

原业务函数仍检查可信AppID、openid和小程序来源，不接收客户端身份/角色，不得给原函数添加Web/HTTP/定时入口。共享领域服务额外接受 `multiPlatformApi` 在校验会话后创建的进程内可信身份，不接受 JSON 中的身份对象。处理结束后清理实例内微信身份字段，防止复用残留。清理任务是独立函数。新增网关部署规则见下文，不能改成全函数匿名调用。

索引覆盖membership的userId+status、familyId+status；档案的familyId+status+sortOrder及列表排序；衣物familyId/memberId/category/status与createdAt/_id组合；草稿status+uploadExpiresAt；邀请tokenHash唯一及expiresAt。列表按createdAt/_id倒序游标分页。档案和登录家人列表首版最多100条。

## 私有图片与补偿

客户端一次选一张，必要时压缩到512 KiB。服务端仅接受JPG/PNG，先校验512 KiB和400万像素上限，再解码、修正EXIF方向、缩到最长1600px并重新编码JPEG。透明像素合成白底，不保留原EXIF/GPS。

路径为families/{familyId}/garments/{garmentId}/{random}.jpg。上传前创建一小时草稿，落库时再次事务校验权限和原上传者。失败不进入列表；清理函数按已核实的环境存储桶和cloudPath补偿孤立文件，删除失败保留重试状态，完成后置discarded。

cleanupUploads的timer为 `0 0 * * * * *`（每小时），客户端调用被拒绝。每次对purging、30天到期deleted、expired和过期uploading各扫描最多50件，事务重新核对当前状态，先认领不可恢复状态再删图片；失败保留补偿状态供后续重试。读取只接收garmentId，经家庭鉴权后为实际文件签发请求期限300秒的链接。退出/移出后停止新访问；已经签发或下载的照片可能保留。

## 验证范围

本地覆盖家庭A/B/C隔离、家人编辑删除、邀请撤销/过期/单次消费/幂等、移出及晚到上传、版本冲突、孩子档案、分页、图片格式与EXIF。真实开发环境验证记录在知识库MP-001记录中。第二个微信账号同家庭互看及真机拍照仍待验收，未发布小程序。

## V0.2 衣橱领域契约

新增独立Event Function `wardrobe`，继续只信任微信上下文，返回原有`{ok,data}`/`{ok:false,error}`。每个写事务都写membership撤权围栏。新增集合与索引、函数权限仍需在部署阶段配置；本地构建不创建云端资源。

| action | 请求 | data |
| --- | --- | --- |
| status | 无 | version、batchLimit=20、trashRetentionDays=30、capabilities |
| home | 同list的可选筛选与分页 | `{userId,family,members,accounts,garments:{items,cursor},locations}`；合并首屏读取，独立查询并行，图片签名后统一重新校验家庭权限 |
| list | 可选search、memberId、category、color、season、location、locationId、status、limit、cursor | `{items,cursor}`；status指wearStatus，`all`显式包括淘汰 |
| batchUpdate | items、patch | `{items}`，patch支持name/memberId/category/color/season/material/location/locationId/notes/status |
| batchDelete | items | `{items}`，转入回收站 |
| trash | 同list的筛选与分页 | `{items,cursor}`，仅deleted，返回deletedAt/restoreUntil |
| restore | items | `{items}`，仅30天内deleted可恢复 |
| purge | items | `{success:true,purged,pending}`，仅deleted可永久删除，失败项保留purging等待timer |
| locations.list | 无 | `{items:[{id,name,parentId,version}]}` |
| locations.create | name，可选parentId（空表示根位置） | `{id,name,parentId,version}` |
| locations.update | id、version，可选name、parentId | 同上 |
| locations.delete | id、version | `{success:true}`，有下级时先报LOCATION_HAS_CHILDREN |
| outfits.list | 可选memberId、limit、cursor | `{items,cursor}` |
| outfits.get | id | 搭配视图 |
| outfits.create | requestId、memberId、name、garments，可选partial/occasion/reason | 搭配视图 |
| outfits.update | id、version、memberId、name、garments，可选partial/occasion/reason | 搭配视图；完整替换组合元数据与快照 |
| outfits.delete | id、version | `{success:true}`，不删除衣物 |
| exportPage | 可选memberId、limit、cursor | `{items,cursor,exportedAt,imageExpiresAt,manifest}` |

`items`批量输入为1～20个不重复`{id,version}`；整组先校验家庭、生命周期和版本，再在同一事务提交，任一失败整组回滚。20件同时变更成员与位置最多47次文档操作，低于100次预算。衣物视图的`status`是wearStatus，其他属性为id/memberId/name/category/color/season/material/location/locationId/notes/version/image/createdAt/updatedAt/deletedAt/restoreUntil；createdAt普通视图保持旧版日期字符串。所有图片链接在返回前后检查家庭权限，不返回imageFileId/cloudPath。

名称和备注搜索是转义后的不区分大小写字面子串；与成员、分类、颜色、季节、位置、状态合并后再按createdAt/_id倒序稳定游标分页。limit默认20、最大50，空cursor表示最后一页，调用方换筛选必须清空cursor。适配器在数据库侧应用搜索与筛选；旧Repository实现由服务端继续扫描补齐，不把“先取前100件再筛选”当全量结果。索引需包含garments的familyId/status/createdAt/_id，以及按memberId、category、wearStatus、color、season、locationId使用的组合；搜索OR正则可能扫描家庭匹配记录，1000件本地用例证明结果完整，不代表线上延迟已测。

`beginUpload.requestId`为可选8～80位字母、数字、下划线或横线，家庭+发起账号+编号确定唯一衣物ID，规范化输入指纹检测编号冲突（REQUEST_CONFLICT）。上传完成后的同一请求返回原ID；过期、删除或清理后不复活旧记录，客户端重新发起时用新编号。未传requestId保留旧版单图行为。

启动使用`bootstrapUser.home`：完成可信微信身份及必要的幂等用户初始化后返回同一home契约，无家庭时返回空分页及位置。最近10分钟内的有效账号不重复写lastLoginAt，每次仍实时读账号状态与家庭权限；不存在跨请求权限缓存。旧bootstrap动作保留原响应。默认衣物查询取limit+1条（20件页面为21条），旧仓储无筛选能力时继续扫描补齐。

客户端首屏由原3次串行云调用改为1次home调用；首次请求仅home设置15秒前台等待上限，迟到响应不回填，写入/上传及付费模型调用沿用原机制。衣物列表仅有最多6个、30秒、按家庭与筛选隔离的内存缓存，切页不延长时间，修改/撤权即清空。没有在身份验证前读取持久化的家庭照片列表。缓存内容显示时仍后台请求最新权限和数据。

位置为家庭共享两级树；结构变更使用父级childCount/structureFence避免并发增删造成第三层或孤儿节点。删除位置只标记该位置失效，已有衣物保留locationId和自由文本location，兼容旧数据；新指派位置必须仍有效。修改/批量指派写位置围栏，与删除冲突。

搭配garments为1～3个`{id,version}`。所有衣物必须属于当前家庭同一成员且可穿，类别不能重复，整装不能与上衣或裤子混用。完整组合需整装，或上衣加裤子，可加帽子；缺件组合必须显式partial=true。创建requestId必填，规则同上传；相同编号+不同输入报REQUEST_CONFLICT。保存事务写每件衣物的aiFence，与家人同时编辑/删除冲突重试，不增加用户可见版本。修改和删除校验搭配version。

搭配视图包含id/memberId/name/occasion/reason/partial/version/createdAt/updatedAt/garmentIds/garments/valid/issues。garments保留不可变创建或编辑快照（id/memberId/name/category/status/color/season/material/location/locationId/notes/version），读取时另算image/available/currentVersion。衣物删除、改归属、不可穿或版本变化分别返回GARMENT_MISSING/MEMBER_CHANGED/NOT_WEARABLE/GARMENT_CHANGED；保留快照且不自动替换。已删除照片不再签发新链接。outfits索引为familyId/status/createdAt/_id，另加memberId组合；locations为familyId/status/createdAt/_id。

导出对当前家庭active衣物游标分页，包括淘汰，默认不导出回收站/草稿/失败项。没有100或1000件总量截断。每页items提供全部衣物属性、毫秒createdAt/updatedAt、familyId、lifecycle及重新签发的300秒image链接。manifest含schemaVersion、家庭id/name、成员id/name/version和有效位置；不包含微信登录标识、供应商凭据或底层fileID。导出是逐页当前状态读取，期间家人修改可能反映在后续页，调用方应保留exportedAt与图片过期时间。搭配通过outfits.list单独分页取得。

## DeepSeek 开发接入

`ai` 为独立 Nodejs20.19 Event Function，30秒超时；使用官方 `https://api.deepseek.com/chat/completions`、`deepseek-flash`、非思考模式和 JSON Output。上游请求20秒超时，最多1600个输出token，不自动重试付费请求。不提供任意提示词代理或任意图片URL转发。

只在 `ai` 的服务端环境变量中配置：

| 变量 | 用途 |
| --- | --- |
| DEEPSEEK_API_KEY | 官方API密钥，不进入源码、小程序、生成物或日志 |
| AI_DAILY_LIMIT | 每账号每北京时间自然日的新任务上限，默认30，最高100；相同请求重查不重复计数 |

客户端使用 `miniprogram/services/ai.ts`，仍经可信微信身份与家庭关系校验：

| action | 参数与行为 |
| --- | --- |
| status | 返回是否已配置、能力及每日任务上限，不返回密钥、余额或服务端配置 |
| recognize | `garmentId, requestId`；从服务端解析衣物照片，返回名称/分类/颜色/季节建议，不修改衣物 |
| recognizePhoto | `memberId, requestId, base64`；保存前识别衣物照片，复用JPG/PNG大小/像素校验与EXIF清理；返回photoRequestId和建议，不创建衣物、不将照片存储到云端或任务正文 |
| recommend | `memberId, requestId`；可选`occasion, season, lockedGarmentIds`。按四类各取最多10件真实可穿候选，另补最多3件固定衣物，返回最多3套有效组合 |
| get | `taskId`；查询原任务，网络失败后优先重查，不自动换requestId重付费 |
| list | 可选cursor和limit（默认10、最多20）；返回当前家庭任务摘要，无结果正文，点开get后重新验权/验衣物版本 |

`requestId` 为8～80位字母、数字、下划线或横线；客户端应在一次用户操作开始时创建并持久化。家庭/发起账号/requestId共同确定任务，重复请求复用结果，复用编号但更换输入会冲突。运行超过45秒且没有结果的任务查询显示`unknown`，不自动再次提交。`unknown`可能已发生费用，需核账。

新增服务端集合 `ai_tasks`，客户端读写规则全部拒绝；索引为familyId/createdAt/_id。记录任务状态、衣物输入版本、经过校验的结果、供应商请求编号与token用量；不存密钥、原始提示词、人像或图片Base64。`users`增加可选`aiDay/aiCalls`计数，`garments`增加familyId/memberId/category/status/wearStatus/createdAt/_id候选索引。

结果中的 `billingState` 为`not_submitted/rejected/reported/unknown`。`reported`表示有供应商返回，不是费用为零；`usage`记录输入、输出与命中缓存token，实际人民币扣费以DeepSeek账单为准。新任务失败也消耗当日任务额度。

推荐服务端拒绝未知衣物、跨成员、非可穿、槽位冲突、缺失固定单品及重复组合；整装可单独成套或加帽子，上衣必须配裤子。请求完成后重新检查家庭权限和衣物版本，数据已变则不给过期结果。没有完整搭配所需衣物时在调用前拒绝。

衣物验证事务同时递增内部`aiFence`字段，与家人同时编辑/删除形成写冲突；不改变用户可见的衣物版本及编辑信息。最大43个候选为事务预留身份和任务操作预算，单事务不超过100次文档操作。

V0.2页面已接入智能识别/推荐。status同时返回发起账号今日全家庭任务计数、本人在当前家庭今日输入/输出/缓存token用量。真人试穿与去背景不是DeepSeek接口的能力；去背景另接腾讯云数据万象，见下。现有多微信/真机与真实样本质量验收缺口独立保留。

## 腾讯云数据万象去背景

- cutout：get/process/apply，参数garmentId、mode（goods/common），process另需requestId；apply需预览返回的requestId及衣物version，返回最新version。仅可信微信身份、当前有效家庭与未删除衣物。客户端不提供图片URL，服务端取得原图短期链接，CI输出私有缓存，返回不含对象键的PNG Base64。
- 桶family-wardrobe-cutout-1306311302，上海，私有读写。执行角色临时凭据签名，不配置新增长期Key。临时对象仅wardrobe-cutouts/v1/，生命周期1天；成功任务6小时有效，PNG重新编码去元数据、缩小至512KB内以适配微信函数返回。
- garments.cutouts按原图/模式记录任务，事务领取避免并发重复费用；不改变衣物用户版本。users.cutoutDay/cutoutCalls每日最多30次，未知/运行不会自动重提交，显式restart新编号才重开。缓存临时读取失败只重查，已过期/确认对象缺失可显式再生成。
- apply复用已完成且未过期的同一预览任务，在私有云存储持久化PNG并保留透明通道；事务核对源照片、任务及version后切换imageFileId/cloudPath并递增version，不调用生成接口、不增加处理次数。appliedCutout识别已应用请求，响应丢失可重试；retainedImagePaths记录原图及上传前登记的候选路径，永久清理/过期补偿会一并删除，晚到上传重新进入补偿队列。客户端按钮为“替换原图”，只更新照片与版本，不覆盖未保存表单。
- 保存前照片：cutout.processPhoto（requestId、base64）及getPhoto（requestId），仅当前微信账号及其有效家庭访问。服务端校验并规范化原图后放入相同临时私有桶，以60秒签名链接交给通用抠图，完成后移除临时源图；结果6小时可查询，临时对象生命周期仍1天。users.photoCutouts内部记录最多60个、保留24小时，请求新建限6小时内，沿用同一每日30次计数；已运行/未知只查询，不静默重做。接口不创建衣物、不返回对象键或签名链接。
- garments.upload增加可选transparent=true：服务端仍核对草稿、上传者、家庭及期限，验证PNG签名/CRC/尺寸/512KB并去除元数据，以.png路径保存透明图；普通图片继续原JPEG规范化。客户端只有采用保存前抠图时发送此项，保存成功前仍是本机批次。
- save将建草稿与上传认领合入同一事务，存储完成后第二次事务核对权限/成员/代次并激活；active同编号重试不再上传，不同表单仍拒绝。旧beginUpload/upload保留。adapter对事务内部请求排队，事务外读取仍并行，避免CloudBase TransactionBusy。
- list/trash保留开始及图片URL签发后的两次鉴权，删除重复入口/签名前读取；home契约不变。runtime/wardrobe-runtime显式__measure=true返回数字performance耗时/计数，普通响应无此字段，不记录身份、表单、图片或链接。
- 普通JPEG需完整解码验证；基线三通道、方向正常且不超过1600边长时，直接移除APP/COM和尾随数据，避免重新有损编码。旋转、尺寸超限、Adobe/特殊JPEG以及PNG继续原规范化，透明PNG沿用专门上传流程。
- 生成和读取结果前后fresh家庭/衣物鉴权。撤权、删除、换图的迟到结果不返回；付费结果已提交后的临时响应失败保留结果供重查。原图不覆盖，私有派生文件生命周期清理。
- CI可能在PNG的IEND后附加数据，按完整PNG块边界截取并执行CRC验证再重编码；失败原图保留。通过官方COS SDK生成签名，CI请求不自动重试、不跟随重定向。

选图录入后直接逐张自动填写名称、颜色，不再二次弹窗或要求点击启动；页面说明及既有照片隐私提示说明DeepSeek处理和用量。手工修改过的字段不再被晚到结果覆盖。照片任务以规范化图像哈希和成员作为幂等输入，换图/换成员复用旧编号会冲突；本机只保存请求编号、任务状态及编辑字段，不保存Base64。任务仍running时需等候或重查原任务后保存，失败/unknown可手工填写。录入及详情表单已去掉季节、材质、共享位置和自由文本位置，保存时省略这些键以保留旧数据。所有页面用户可见称呼统一为“智能”，内部接口名称保留。

## MP-001 四端统一账号与 HTTP 网关

`multiPlatformApi` 是唯一新增的 HTTP 入口。微信小程序保持原 `wx80f51573314b7bd2` AppID、可信 `wx_client/wx_devtools` 上下文和所有原业务函数；H5、Android、鸿蒙 使用同一组业务领域服务和文档数据库。微信 userId 仍为 `SHA256(wx/{appid}/{openid})` 前40位，已有家庭、成员、衣物、邀请、智能任务和每日额度不迁移。新注册账号取得独立随机 userId；用户应先在原微信账号中绑定，随后在其他端登录，才能继续看到旧家庭。

HTTP 请求为 POST `Content-Type: application/json`，正文固定 `{ "group": "families", "action": "get", "data": {} }`。私有请求添加 `Authorization: Bearer <token>`；不使用 Cookie。响应正文沿用 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`，HTTP 状态码可能为400、401、403、413、429、500，客户端须在非2xx时仍解析错误正文。HTTP只开放显式列出的业务组 `bootstrapUser/families/familyInvites/members/garments/wardrobe/ai/cutout` 及其已有动作，拒绝清理、任意函数或未知动作。`data` 不得携带openid/appid/source/role/identity/principal等身份字段；`userId`只在家庭管理员remove/transfer中表示目标账号，不能替换调用者身份。

| group.action | 请求data | 成功data |
| --- | --- | --- |
| auth.register | username、password | token、expiresAt（毫秒）、userId、username |
| auth.login | username、password | 同register |
| auth.me | 无；HTTP需Bearer | userId、username；微信尚未绑定时username为空字符串 |
| auth.logout | 无；HTTP需Bearer | `{success:true}`，只撤销当前会话 |
| auth.bind | username、password；仅可信微信Event上下文 | userId、username，保留微信原userId |
| garments.photoBase64 | garmentId；HTTP需Bearer或原微信garments函数 | `{base64,mimeType}`；私有照片服务端下载，省去浏览器跨域读取存储桶 |

微信绑定调用示例：`wx.cloud.callFunction({name:'multiPlatformApi',data:{group:'auth',action:'bind',data:{username:'family_owner',password:'用户自行输入的密码'}}})`。同样的Event格式可以调用auth.me。绑定前需正常bootstrapUser初始化用户；HTTP绑定、会话身份绑定、重复绑定或绑定已占用账号均拒绝，绝不自动合并不同账号、转移家庭或覆盖密码。没有短信、付费认证、默认密码或密码重置入口。

账号规范为3至32位ASCII字母/数字/点/下划线/横线，首位只能字母数字；去除账号首尾空格并转小写。密码为10至128个字符，不裁剪空格。密码使用每账号16随机字节盐、scrypt（N=32768,r=8,p=1,64字节结果）保存；验证使用恒定时间比较，未知账号也执行相同KDF。不存在账号、错误密码、停用账号及账号冲突使用相同的AUTH_FAILED消息，不返回账号是否存在。

会话令牌为32个随机字节的base64url文本，默认7天有效。数据库只保存SHA-256摘要，原令牌仅成功注册/登录时返回；每次私有HTTP请求实时核对会话、撤销时间、有效期、账号和用户状态。服务端使用私有WeakMap创建领域身份，JSON复制、客户端传userId/source或伪造session对象都不能取得信任。家庭权限、成员/衣物版本、上传者检查、撤权事务围栏和智能额度仍由原领域服务执行。logout仅撤销当前令牌；客户端退出还应清除本地会话和业务缓存。

持久限频集合在密码计算之前事务记录尝试，失败也保留计数，跨函数实例/重建服务有效。15分钟内同账号（登录/注册/绑定合计）最多10次；同来源IP注册最多20次、登录最多100次；全环境注册最多300次、登录最多2000次。微信绑定按可信微信userId计来源。HTTP优先读取云函数注入的 `TCB_SOURCE_IP`，兼容网关 `requestContext.sourceIp`，不信任客户端X-Forwarded-For；无法识别IP时所有未知来源共用保守限额。可在网关另配环境QPS限制；不要把共享限额当作逐IP识别已获真机验证。

照片导出只接受garmentId；服务器自行解析私有fileID并通过CloudBase SDK下载，不接收URL/fileID。下载前后检查家庭权限和active生命周期，换图时拒绝迟到响应，只返回JPEG或PNG，原始字节上限2 MiB。`mimeType`为image/jpeg或image/png。已签发URL仍遵守原300秒有效期。

### 新增集合、索引与权限

先创建 `auth_accounts`、`auth_sessions`、`auth_throttles` 三个文档集合，全部使用与其他服务端集合相同的拒绝客户端读写规则：

```json
{"read":false,"write":false,"create":false,"update":false,"delete":false}
```

- `auth_accounts`：`_id`为规范账号名SHA-256派生值，内置_id唯一索引负责并发账号唯一性；另建`userId`唯一升序索引作一人一账号的额外约束。user文档增加可选username；绑定时同一事务写user和account，保留原_openid及所有业务字段。
- `auth_sessions`：`_id`和tokenHash均为令牌SHA-256，不含明文令牌。增加`userId ASC, createdAt DESC`及`expiresAt ASC`普通索引，便于运维审计及清理。expiresAt为毫秒数，鉴权显式检查到期，不能依赖后台删除及时性。
- `auth_throttles`：`_id`为限频键摘要，不存原IP/明文账号，增加`expiresAt ASC`普通索引供运维清理。过期桶下次尝试会原地重置。不要把毫秒数字直接配置成要求Date类型的TTL索引。

会话和限频记录可由受控服务端维护流程清理；本次不开放客户端清理动作，不修改原衣物补偿任务。过期/撤销会话即使尚未物理删除也不能登录。

### 构建与部署顺序

1. 运行 `npm run check:cloud` 和 `npm run build:cloud`。构建得到10个独立函数包；新增 `.cloudbuild/multiPlatformApi` 包含所有业务服务、身份模块、私有认证和网关，以及微信SDK、图片处理和COS依赖。其他9个包都包含各自领域服务需要的identity.js，原入口不变。
2. 建立上述集合/索引/拒绝规则。部署 `multiPlatformApi` 为Nodejs20.19 Event、index.main、30秒，建议512 MiB内存（scrypt并发需要内存）。保留原微信函数，无需为其开HTTP。需要photoBase64的原微信garments函数及共享身份改动的包按此次生成物更新；只部署新增网关不能更新旧函数里的新增动作。
3. 为 `multiPlatformApi` 单独配置HTTPS访问服务路由，使用标准HTTP事件体和集成响应，不做任意函数转发。网关允许未携带CloudBase SDK登录态的HTTP请求到达此函数，由应用的Bearer会话鉴权。原9个函数继续沿用原调用规则，cleanupUploads保持禁止客户端调用。不要全局把`*`函数规则改为匿名允许。
4. `multiPlatformApi`服务端配置 `CLOUD_API_ALLOWED_ORIGINS` 为逗号分隔的**完整精确Origin**，例如 `https://wardrobe.example.com,http://localhost:5173`，禁止`*`、路径、尾部斜线、通配子域或null。未配置时所有带Origin的浏览器请求拒绝；原生端无Origin仍可使用Bearer会话。只对匹配来源回复CORS头，不启用Access-Control-Allow-Credentials。OPTIONS仅允许POST和Content-Type/Authorization。
5. 在新增网关函数配置与原ai函数一致的 `DEEPSEEK_API_KEY`、`AI_DAILY_LIMIT`；去背景复用原私有桶和执行角色临时凭据，不创建长期密钥。给网关执行角色同等数据库、CloudBase存储和CI最小权限。不要把这些环境变量写入前端、文档或日志。
6. H5构建填写网关HTTPS地址；Android/鸿蒙构建使用同地址。微信保持原合法域名/小程序环境绑定。此源码和本地构建不创建路由、集合、规则或线上配置。

HTTP事件/集成响应遵循 [CloudBase HTTP访问云函数](https://docs.cloudbase.net/service/access-cloud-function) 和 [函数输出](https://docs.cloudbase.net/cbrf/how-to-writing-functions-code)；可信IP说明参考 [Node端getClientIP](https://docs.cloudbase.net/api-reference/webv3-pg/authentication) 与 [网关源IP规则](https://docs.cloudbase.net/service/custom-domain)。线上路由、真实CORS、双微信账号、真机安装与付费供应商调用须分别验收；本地内存仓储测试不替代云端事务和权限验收。

### Android APK 版本发布

`multiPlatformApi` 新增唯一的匿名只读检查操作：

```json
{"group":"updates","action":"check","data":{"platform":"android","versionCode":301}}
```

只接受android和正整数原生APK版本号，不允许客户端修改版本信息。业务组继续使用Bearer鉴权；微信Event入口依旧只允许auth.bind/me。版本元数据由服务端环境变量 `ANDROID_UPDATE_RELEASE` 控制，不放数据库写入口。未设置/清空返回 `{ "ok": true, "data": { "release": null } }`，无已发布更新。错误配置返回明确错误，不诱导安装。

发布新版本：

1. 提高manifest的versionName/versionCode，用与已安装旧包相同的证书生成完整签名APK；0.3.1/301是首次包含更新能力的源码版本，仍需先手动安装一次。
2. 将已核验APK上传到由维护者管理的长期HTTPS下载位置，使用不可变文件名；避免过期下载签名、账号登录页、覆盖旧版本文件。不改变家庭照片等私有存储规则。
3. 在仓库根目录运行 `node scripts/prepare-android-update.cjs --apk <实际APK绝对路径> --url <HTTPS下载地址> --notes <UTF8说明文件>`。脚本从实际APK二进制manifest读取包名和版本，计算字节数与SHA256，输出 `.tmp/app-releases/android-<versionCode>.json`，不上传、不发布。
4. 核对签名与旧版一致、下载所得文件哈希与JSON一致、已通过真机测试；将JSON全文配置到multiPlatformApi环境变量 `ANDROID_UPDATE_RELEASE`。只更新此变量，保留已有CORS、模型等变量；客户端下次冷启动/手动检查即可发现新版。清空此变量可撤回后续检查的推荐，已下载包仍可在离线时由用户选择安装。

契约为platform、packageName、versionCode、versionName、url、sha256、size、notes。包名固定com.applejq.familyhome；URL只接受HTTPS APK、无凭据/片段；SHA256为64位小写十六进制；APK最大256MiB、说明最多1200字符、JSON最多4096字节。客户端同样校验契约，只向高于当前原生APK版本号更新。

2026-10-28开发网关代码已更新，真实匿名检查返回200/release:null，匿名家庭读取仍401；尚未设置发布元数据、上传APK或发布更新。用户要求先完成代码，APK打包已由用户取消，Android原生Kotlin编译和真机安装仍待后续。

## MP-001 家庭记事

2026-11-03 已随 Android 0.3.9（309）部署到现有环境：7个记事集合及索引、notebook、notebookCleanup、notebookReminders 和 multiPlatformApi；集合权限 ADMINONLY，定时函数禁止客户端调用。notebookCleanup 每5分钟运行，已有持久扫描记录。notebookReminders 未配置timer，微信提醒及Android推送保持未开通。16项云端合成数据流程已通过，临时业务数据与账号已清理；真实AI调用、微信投递和安卓真机覆盖升级尚未验收。

新增独立 `notebook` 微信 Event Function，以及 HTTP `multiPlatformApi` 的 `notebook` 业务组；复用可信微信身份、私有 Bearer 会话及家庭权限。双方家庭账号同权，笔记所属成员与日程参与人均可使用 `family_members` 档案 ID。2026-11-03 表单修复新增可选 `participantMemberIds`：允许未绑定账号的成员参加日程；服务端校验成员属于当前家庭，从其当前有效绑定计算 `participantUserIds`，不能把档案 ID 当作提醒账号。旧客户端只传 `participantUserIds` 时仍校验有效家庭账号；旧记录无需批量迁移。账户显示名优先取绑定档案名，再取 username，最后回退家人编号；不会随查看者交换身份。此增量已随 Android 0.3.10（310）更新 notebook、multiPlatformApi、notebookReminders 和 notebookCleanup；线上7项合成验证通过，未绑定成员保存、有效账号派生及旧格式编辑正常，临时家庭与账号已定向清理。4个函数代码下载后与本地产物逐文件摘要一致，原配置及触发器保留，提醒通道仍未开通。APK签名、匿名完整下载摘要和公开更新接口核对通过；安卓真机覆盖升级仍待验收。发布记录见 `.tmp/app-releases/release-310-state.json`。

公开无平台依赖契约见 `cloud/src/notebook-model.ts`。HTTP 正文为 `{group:"notebook",action,data}`；微信调用 `notebook` 时传 `{action,...data}`。成功包装均为 `{ok:true,data}`，失败沿用业务错误包装。
清单可选 `category` 仅允许“购物／出行／办事／其他”，创建省略默认“其他”，编辑省略保留原值，复制保留；笔记和日程仅允许省略或空字符串，兼容旧记录。

| action | data | 成功 data |
| --- | --- | --- |
| home | 可选 limit、cursor | userId/familyId/familyName/members/accounts/entries/cursor/capabilities |
| list | status=active/deleted，可选 kind/cursor/limit | `{items,cursor}`，默认50、上限100；满页提供下一页游标，无总量截断 |
| get | entryId | NotebookEntry |
| create | requestId、entry | NotebookEntry；entry.kind=event/list/note |
| update | entryId、version、patch | NotebookEntry；不能切换 kind |
| delete / restore / purge | entryId、version | NotebookEntry；软删除、30天内恢复、永久清理 |
| toggle | entryId、version、itemId、done | NotebookEntry；服务端记录实际完成者和时间 |
| copy | entryId、version、requestId | 新清单，重置勾选和完成者，保留原清单 |
| images.upload | requestId、photoBase64 | `{id,url}`；JPG/PNG复用512KiB/400万像素校验与去元数据 |
| images.get | imageIds | `{id,url}[]`；每次重新校验家庭、图片状态并签发300秒链接 |
| profile.link | memberId、version | `{memberId}`；只能认领未绑定/已绑定本人的档案，已绑定另一档案时明确拒绝 |
| ai.parse / ai.query | requestId、text | NotebookAiResult；不会直接创建日程 |
| ai.get | requestId | 重查当前账号在当前家庭的原请求，unknown不自动重提交 |
| reminders.subscribe | entryId、version | `{enabled,message}`；仅当前参与账号登记自己的微信提醒，不接收openid/收件人 |

创建/修改图片只接收 `imageIds`，客户端不能写 URL/fileID。笔记创建必须选择有效成员档案；历史未归属笔记仍可读。日程只做单次安排，日期和参与人必填，开始时间可留空（时间待定），结束时间必须晚于开始时间；跨天请分成独立安排。提醒字段保存业务意图；微信提醒另需下述完整配置与本人订阅登记，默认关闭。

日程可通过 listId/noteId 关联当前家庭的有效清单/笔记。软删关联内容不会删除日程，客户端展示关联不可用；恢复保留勾选和完成者。purge 保留无正文的幂等 tombstone，清理图片引用并逐条断开日程关联；不会删除日程。存储清理失败返回 `CLEANUP_PENDING`，持久保留待清理 asset IDs，重复原操作可继续，不能把失败当成功。旧版本/不同内容复用请求编号分别报 CONFLICT/REQUEST_CONFLICT。所有写操作使用事务及 membership 写栅栏；读操作在签名图片后再次核实权限。

### 新增集合与索引

以下集合必须全部拒绝客户端直接读写：`{"read":false,"write":false,"create":false,"update":false,"delete":false}`。图片所在私有 CloudBase 存储同样禁止匿名读取，不能配置为公共桶。

- `notebook_entries`：统一 event/list/note；索引 `familyId ASC,status ASC,createdAt DESC,_id DESC`，及 `familyId ASC,status ASC,kind ASC,createdAt DESC,_id DESC`；永久清理关联扫描另需 `familyId ASC,kind ASC,createdAt DESC,_id DESC`。内置 `_id` 唯一索引承担创建/复制 requestId 幂等。
- `notebook_assets`：私有图片元数据，含 familyId、状态、refCount、请求指纹和底层 fileID。内置 `_id` 唯一索引负责上传幂等；维护清理可增 `status ASC,updatedAt ASC`。底层 ID/path 永不返回前端。未经引用的上传图片及中断上传任务需要受控服务端清理，本次没有新增客户端批量删除接口。
- `notebook_ai_requests`：索引 `familyId ASC,createdAt DESC,_id DESC`。记录请求指纹、状态、已校验结果、providerRequestId、token 用量和随机 fence；不保存密钥、原始用户请求文本或原始模型提示词。`users` 新增可选 notebookAiDay/notebookAiCalls 额度计数和 notebookFence 档案认领栅栏，不影响旧衣橱智能额度。
- `notebook_reminder_subscriptions`：日程+用户确定性 `_id`；保存本人登记的日程版本、提醒计划指纹和模板，不保存客户端openid，不将登记视为微信额度证明。指纹包含家庭、日程、日期、开始时间、提前量和排序去重后的参与成员（旧记录仍使用参与账号）；缺指纹的旧登记需本人重新订阅。成员绑定在登记及投递时重新解析，只向有效绑定且本人订阅的账号发送；解绑或家庭权限失效后不会按缓存账号继续通知。
- `notebook_reminder_deliveries`：日程+提醒计划指纹+用户+wechat 确定性 `_id`，独立投递去重账本。内容升版不改变投递身份。索引可加 `status ASC,updatedAt ASC` 供运维查未知结果；不开放客户端读取。
- `notebook_reminder_scans`：按北京时间日期保存扫描游标；内置 `_id` 索引。定时扫描另需 `notebook_entries` 的 `kind ASC,status ASC,date ASC,createdAt DESC,_id DESC` 组合索引，不带家庭条件的查询只存在服务端timer。

### 智能配置与实际部署条件

`notebook` 和 `multiPlatformApi` 各自使用服务端 `DEEPSEEK_API_KEY`，复用已有 `createDeepSeekClient` 及其20秒超时、JSON输出和不自动重试行为；`NOTEBOOK_AI_DAILY_LIMIT` 默认每账号每北京时间自然日30个新请求，上限100。新请求事务计额；同编号重查不扣额。持续运行45秒后只显示 unknown，不重新收费提交。没有配置 key 时手工记事仍可用，能力显示 ai=false。

解析结合服务端北京时间、明确日期和真实家庭成员。成员档案可在未绑定账号时进入AI草稿和查询；用户明确说出姓名时只匹配这些成员，只有未指定姓名的“一起”才使用全部成员。缺少明确日期或参与人时补问，模型返回草稿后由用户确认调用 create。查询先分页读取全部相关真实日程，候选超过120条时要求缩小范围；模型只筛选最多20个真实白名单 ID，答案由服务端按保存的时间/标题/参与人生成，避免模型自由编造安排。模型不修改数据库日程，也不把无记录解释为确定有空。

`npm run check:cloud`、`npm run build:cloud` 生成13个独立函数包，其中 `.cloudbuild/notebook` 包含 notebook-runtime/service/model/ai/reminders 和 DeepSeek 依赖；`.cloudbuild/multiPlatformApi` 同步包含记事服务；`.cloudbuild/notebookReminders`、`.cloudbuild/notebookCleanup` 为独立定时函数。部署前需创建上述集合、索引及拒绝规则，再更新 HTTP 网关和新增 notebook 为 Nodejs20.19 Event、index.main、30秒，并分别配置服务端环境变量及最小数据库/私有存储权限。本地构建不创建云资源、不部署函数、不发真实 AI 请求。双账号云端事务、微信订阅消息真实投递及 Android 后台提醒另行验收。

### 微信提醒配置与投递边界

`notebook`、`multiPlatformApi`、`notebookReminders` 使用一致的服务端配置；任何缺失/非法配置都返回 capability `wechatReminder=false`，前端不会得到可用模板ID。旧 `NOTEBOOK_WECHAT_REMINDER_ENABLED` 不再启用能力。

| 环境变量 | 规则 |
| --- | --- |
| NOTEBOOK_WECHAT_ENABLED | 只有字符串 `1` 开启；默认关闭，确认worker、权限、模板和来源验收后再开启 |
| NOTEBOOK_WECHAT_TEMPLATE_ID | 微信公众平台当前小程序实际可用模板，不能编造或借用其他小程序模板 |
| NOTEBOOK_WECHAT_TEMPLATE_FIELDS | JSON：真实模板关键词名映射到 `title` / `dateTime` / `place` / `participants`；必须含标题和日期时间。时间映射只允许实际time/date字段，文字使用实际thing/character_string字段，最多5项。字段名必须按实际模板填写，源码没有默认关键词 |
| NOTEBOOK_WECHAT_STATE | `developer` / `trial` / `formal`，默认formal；须与实际验收环境一致 |

用户主动点击后调用 `wx.requestSubscribeMessage`，仅模板结果为accept才请求 `reminders.subscribe{entryId,version}`。登记入口仍校验当前版本；服务端从可信当前账号及已有绑定 `users._openid` 解析收件人，登记覆盖当前提醒计划。改日期、开始时间、提前量或参与账号后需本人重新订阅；取消或删除日程停止发送。只改标题、地点、备注或清单/笔记关联不使登记失效，已经投递的相同计划也不会因内容升版或再次登记而重发。客户端即使伪造登记也不能制造微信真实额度，实际发送失败不算送达。开启登记返回enabled=true只表示已登记，仍受本人微信授权和剩余额度限制。

独立 `notebookReminders` timer 计划每分钟运行（`0 * * * * * *`）；生成的config.json声明timer及 `subscribeMessage.send` 云调用权限，部署工具须确认实际应用。函数权限单独设 `{"invoke":false}`，不得开HTTP或匿名客户端入口。[CloudBase内置环境变量](https://docs.cloudbase.net/cloud-function/function-configuration/env)明确规定定时触发注入 `TRIGGER_SRC=timer`，代码只从这个受信环境变量映射timer身份，同时要求无微信openid和 `event.Type=Timer`。不使用SDK的SOURCE/TCB_SOURCE替代此检查，也不接受正文中的trigger_src/TRIGGER_SRC自证身份；调用结束清理该变量，防止暖实例残留。部署验收仍应验证真实触发和客户端伪造Timer被拒绝，不能仅依据event.Type放行。

worker按北京时间当前日、次日及5分钟迟到窗口起点所在日去重后完整分页扫描active日程，覆盖午夜后仍在窗口内的前一天安排。首版微信通道支持0～1440分钟提前量；无具体时间/超过一天的提醒明确不登记，不把它们伪装成可用提醒。到期允许5分钟迟到窗口，老提醒不补发；每轮最多扫描300条、尝试约50个收件人，持久游标让剩余页面后续继续，超大数据量仍需监控扫描周期是否低于迟到窗口。每个日程的参与人会完整处理，因此一次可能略超过50个目标。

领取与发送前两次事务重新核对最新日程状态、提醒计划指纹、当前参与人、有效家庭/账号/membership和本人登记；对日程referenceFence及membership/user写栅栏，避免仅凭旧列表快照发送。账本先claim并租约60秒，发送前持久标为sending；仅尚未开始发送的过期claim可重领。接口明确返回errCode=0记为accepted（微信接受请求，非用户已读/已收）；43101等明确拒收记为rejected。网络超时/未知返回记unknown，不自动重发；发送中进程中断保留sending，同样不重发。数据库事务和微信外部调用无法原子提交，最后一次校验后已在途的消息无法保证撤回。

官方接口：[客户端订阅](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)、[服务端发送](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html)。

### 安卓个推与双端渠道选择

客户端通过 uni-push 1.0 获取本设备 CID，申请通知权限后，使用登录会话登记设备。服务端只保存安装密钥的摘要，并在发送前重查会话、账号、家庭、参与人和日程；退出登录会阻止该设备后续发送。通知仅显示通用文字，点击后按本机账号权限打开日程。微信和Android使用独立开关，可同时启用；开启或关闭其中一端不会改变另一端。`reminders.preference`以`{channel:'wechat'|'android',enabled:boolean}`只修改指定开关；`reminders.status`返回`wechatEnabled`和`androidEnabled`，`channel`为兼容摘要（`both`表示双开）。旧312客户端的`channel:'none'`仅关闭Android。微信成功登记仅开启微信；旧单channel记录读取时保持原状态，不批量替用户开启另一端。

需要新建服务端集合 `notebook_push_devices`、`notebook_reminder_preferences`、`notebook_android_deliveries`，全部设置 `ADMINONLY`。设备查询需要 `userId ASC, familyId ASC, status ASC, createdAt DESC, _id DESC` 复合索引。提醒定时函数和两个接口函数均需取得有效服务端配置：`NOTEBOOK_ANDROID_ENABLED=1`、`GETUI_APP_ID`、`GETUI_APP_KEY`、`GETUI_MASTER_SECRET`；密钥只配置云函数环境变量，禁止写进仓库和客户端。Android在线消息采用uni-push 1.0专用`{title,content,payload}`透传结构，由SDK在线时展示通知栏消息。厂商离线通道按实际注册并核实的厂商配置逗号分隔的`GETUI_ANDROID_OFFLINE_CHANNELS`，取值`XM,HW,HO,OP,VV,MZ,FCM`；小米`XM`还需`GETUI_XIAOMI_CHANNEL_ID`。配置变量不能代替DCloud/厂商平台开通凭据及打包配置。未开通相应厂商渠道时，应用后台或锁屏后可能无法收到。

`notebookReminders` 需要每分钟 timer，权限限制为客户端不可调用；同时保留微信订阅消息 OpenAPI 授权。微信配置 `NOTEBOOK_WECHAT_ENABLED`、`NOTEBOOK_WECHAT_TEMPLATE_ID`、`NOTEBOOK_WECHAT_TEMPLATE_FIELDS` 和 `NOTEBOOK_WECHAT_STATE`。模板、服务端配置、客户端授权和真实设备验证都齐备后才可确认提醒实际可用。个推接口接受请求不等于手机收到；未开通对应品牌的厂商离线通道时，应用进入后台/锁屏后的送达无法保证。

微信定时发送必须额外在微信开发者工具对`notebookReminders/config.json`执行“上传触发器”（或在微信云开发控制台保存规则），由官方工具登记定时云调用系统票据。普通CloudBase创建timer只提供调度，CLI上传函数仅登记OpenAPI白名单，两者均不能替代票据登记。不能输出或手动填充票据；出现`Invalid wxCloudApiToken`需通过微信工具修复登记。runtime保留平台`TRIGGER_SRC/WX_CONTEXT_KEYS`，只清用户身份，避免温实例丢失票据选择信息。账本保留安全数字错误码；代码/接口成功不代表用户已收消息。

### 记事生命周期与私有图片定时补偿

新增 `notebookCleanup` 为受控 timer，不接 HTTP、微信客户端动作或任意客户端参数。生成包声明每5分钟触发 `0 */5 * * * * *`，部署为 Nodejs20.19 Event、index.main、30秒，函数权限必须单独设为 `{"invoke":false}`。runtime仅从官方内置环境变量 `TRIGGER_SRC=timer` 映射可信source，并与领域入口一起复用 `assertNotebookTimer`：必须同时满足可信运行时 source=timer、没有openid、event.Type=Timer；伪造正文Type/trigger_src和SOURCE/TCB_SOURCE均不能获得清理权限。调用结束清理TRIGGER_SRC，依据同上[官方环境变量表](https://docs.cloudbase.net/cloud-function/function-configuration/env)。

公开服务端 API 为 `createNotebookCleanup(repo, storage, {now?, scanLimit?, batchSize?}).run(event, {source, openid})`；options仅用于服务端及本地验证，运行入口不会读取event中的扫描大小或身份。返回busy/scanned/expired/assetsDeleted/linksDetached/failed统计；failed大于零表示留有补偿，不能报告全部完成。

- 已软删满30天的条目，事务中擦除正文、标题、成员归属、日历内容、清单及图片关联，只保留身份/时间/版本/幂等指纹等轻量tombstone。事务撤销每张图片refCount；仅无引用图标记待清理。未到30天的内容及其图片保持可恢复。
- 孤立active图片达到24小时、未完成uploading达到1小时、failed、deleted和显式purge残留都会重试。每张图片先在事务内复核refCount=0并claim status=deleted，之后才能调用私有存储删除；并发新增引用必须读取active并写同一资产，因此会冲突或拒绝。refCount仍为正的图片不会删除。
- 物理删除成功后只清该资产自己持有且本轮成功删除的fileId/cleanupFileIds。确认无其他待删句柄后清cloudPath/fingerprint。删除失败/数据库响应丢失保留句柄，后续timer重试。过期uploading尚无fileId时保留路径和指纹；晚到上传被deleted状态拒绝，服务端把返回的文件句柄追加到cleanupFileIds，不把已claim的资产重新激活。若供应商上传响应始终未返回文件句柄，仅凭路径无法证明物理对象状态，该信息会保留供受控运维核对，不宣称已删。
- 独立event扫描只断开指向purged条目的listId/noteId并递增日程版本，不删除日程。软删目标的关联保留，恢复后继续使用。

新增 `notebook_cleanup_scans` 集合，使用与其余服务端集合相同的全拒绝客户端读写规则；内置_id索引，单条maintenance-v1保存55秒租约和entries/assets/events三条持久游标。每轮每条扫描线默认最多50条，每页25条、每处理一条持久checkpoint；完整扫描后回卷。新产生的前页不会阻止旧游标继续，单条失败也保留补偿并前移、下个完整周期重试，不存在固定总量截断。单条purged记录的历史图片补偿每轮最多处理10个并旋转剩余项，避免一个永久失败对象挡住后续图片。若进程中断，最多重复尚未checkpoint的幂等操作；租约阻止正常重叠任务抢占进度。

全局entries/assets分页需 `createdAt DESC,_id DESC` 索引；全局event扫描另建 `kind ASC,createdAt DESC,_id DESC`。本轮仅本地仓储、假存储与打包验证，未创建集合/索引、未部署timer、未删除云端图片。

## 经期管理（2026-11-03，本地实现待部署）

在 `notebook` 微信事件函数和既有 HTTP `notebook` 业务组内增加经期操作，两端共享 `cycle-model.ts`，事件与HTTP返回沿用 `{ok,data}`。`expectedFamilyId`由当前页面快照提供，服务端再次验证有效家庭和经期档案共享名单；家庭后来新增账号不会自动取得访问权。首期一个家庭一份经期档案，成员归属与共享账号分开，最多两个有效账号且包含操作者。常规记事内容权限保持原规则。

- `cycle.home`：读取当前授权档案、北京时间today、最近6个完整周期/已结束经期统计、预测与原因和AI可用状态。未启用返回profile=null；无共享权限返回FORBIDDEN，不当成空档案。
- `cycle.setup`：requestId、memberId、accessUserIds、settings（cycleLength为15–60整数或null，periodLength为1–20整数或null，predictionPaused为boolean），可选period `{start,end}`。未知设置保持null，不编造默认值。
- `cycle.settings.update`：version、requestId、settings、accessUserIds；记录对象memberId固定，双方可维护设置与共享名单。
- `cycle.period.save`：version、requestId、period `{id?,start,end}`。`end=''`表示未结束；禁止未来、非法或重叠实际日期，未结束经期仅能位于最后。
- `cycle.period.delete/restore`：version、requestId、periodId。`cycle.daily.save`：version、requestId、daily `{date,flow,symptoms,mood,intimacy,ovulationTest}`。`cycle.daily.delete/restore`：version、requestId、date。每日与起止独立，不互相连带删除；删后30天内恢复，过期隐藏并在后续写入裁除，不承诺当前已有定时物理删除。
- 所有写返回完整CycleHome。整体version防双端覆盖；持久cycle_mutations回执按家庭/账号/requestId去重，payload指纹匹配返回当前档案，同ID异内容拒绝。成功回执与档案在同一事务保存。
- `cycle.ai.analyze`：version、requestId；`cycle.ai.get`：本人原requestId；`cycle.ai.latest`：授权双方最近一份成功报告。服务端固定快照并用现有DeepSeek适配，结果带数据范围、确定统计、生成时间、源版本和stale。模型从与资料匹配的受控建议代码中选择，服务端校验代码与统计后渲染解读，模型自由文本不直接展示或写入真实记录。
- 新AI任务默认每账号北京时间每日30次，复用已有NOTEBOOK_AI_DAILY_LIMIT配置；独立cycleAiDay/cycleAiCalls计数。相同请求不再调用供应商；未知提交只查原任务。失败由用户主动选择新任务，不自动重发付费请求。供应商已返回的用量按任务fence保存，发起者后续失权不会抹除账，返回客户端时仍重新鉴权。

新增集合全部设为ADMINONLY，禁止客户端直接读写：`cycle_profiles`（确定性_id，一家庭一档案）、`cycle_mutations`（确定性_id幂等回执，只存指纹和审计）、`cycle_ai_requests`（任务状态、校验后结果、费用确定性/用量，原始prompt和密钥不保存）。AI最新结果查询需要索引 `familyId ASC,status ASC,createdAt DESC,_id DESC`；其余主要按_id读取。档案含最多120次保留经期与1500天每日记录，超限明确报错，不静默截断。

预测与完整统计分开计算：保留所有实际记录和统计，在最近6个完整周期中选取15–60天的间隔取平均；已结束经期中选取1–20天的持续记录估算结束日期。缺少可参考样本时分别使用手填参考值，不编造默认值。部分间隔未参与估算、跨度超过7天、样本少于3个时继续给出初步估算，并通过predictionReason说明来源、排除数量及不确定性；这些范围仅为当前算法的估算边界，不作健康分类。主动暂停、缺少实际开始日期或可参考天数、预测与实际记录重叠时不生成日期。过期估算不自动顺延，排卵/易孕期仅按日历法估算，不用于避孕；AI只做按需解读，不覆盖日期。

部署本功能需先创建上述3个集合、权限和AI索引，然后更新 `notebook` 与 `multiPlatformApi`（构建会携带cycle-model/core/service/ai）。无需新增函数或通知timer，不改旧提醒配置。当前仅完成本地实现和合成联调，尚未创建云端集合、部署、调用真实健康AI或发布新版APK。
