# 云端接口与部署

仅使用已绑定小程序的文档数据库环境 `wardrobe-dev-cloude-d5bv128b6099`，旧 PG 环境不参与。函数运行时 Nodejs20.19 Event，入口 index.main，超时30秒，无 HTTP 网关。客户端使用 wx.cloud.callFunction。新增cutout事件函数接腾讯云数据万象。

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

业务函数还检查可信AppID、openid和小程序来源，不接收客户端身份/角色；不得添加Web/HTTP/定时入口。处理结束后清理实例内微信身份字段，防止复用残留。清理任务是独立函数。

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
- 生成和读取结果前后fresh家庭/衣物鉴权。撤权、删除、换图的迟到结果不返回；付费结果已提交后的临时响应失败保留结果供重查。原图不覆盖，私有派生文件生命周期清理。
- CI可能在PNG的IEND后附加数据，按完整PNG块边界截取并执行CRC验证再重编码；失败原图保留。通过官方COS SDK生成签名，CI请求不自动重试、不跟随重定向。

选图录入后直接逐张自动填写名称、颜色，不再二次弹窗或要求点击启动；页面说明及既有照片隐私提示说明DeepSeek处理和用量。手工修改过的字段不再被晚到结果覆盖。照片任务以规范化图像哈希和成员作为幂等输入，换图/换成员复用旧编号会冲突；本机只保存请求编号、任务状态及编辑字段，不保存Base64。任务仍running时需等候或重查原任务后保存，失败/unknown可手工填写。录入及详情表单已去掉季节、材质、共享位置和自由文本位置，保存时省略这些键以保留旧数据。所有页面用户可见称呼统一为“智能”，内部接口名称保留。
