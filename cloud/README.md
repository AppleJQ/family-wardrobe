# 云端接口与部署

仅使用已绑定小程序的文档数据库环境 `wardrobe-dev-cloude-d5bv128b6099`，旧 PG 环境不参与。函数运行时 Nodejs20.19 Event，入口 index.main，超时30秒，无 HTTP 网关。客户端使用 wx.cloud.callFunction。

运行 `npm run build:cloud`，通过微信开发者工具或 CloudBase MCP 部署 `.cloudbuild/` 下六个目录，开启依赖安装。可维护源码在 cloud/src。图片处理为纯 JavaScript，无原生图片库依赖。

| 函数 | action | 参数 |
| --- | --- | --- |
| bootstrapUser | bootstrap | 无，身份取可信微信上下文 |
| families | create / get / rename | create: name, memberName；rename: name |
| families | remove / transfer / leave | remove/transfer: userId，仅管理员操作他人 |
| familyInvites | create / revoke | revoke: inviteId |
| familyInvites | preview / accept | token；accept另需confirmed=true |
| members | list / create / rename | create: name；rename: memberId, name, version |
| garments | beginUpload | memberId, name, category；可选status/location/notes/color/season/material |
| garments | upload | garmentId, base64，仅草稿原上传者 |
| garments | list | 可选memberId, category, cursor, limit（默认20，上限50） |
| garments | get / image | garmentId，服务端映射实际文件ID |
| garments | update / delete | garmentId, version；update另需patch |
| cleanupUploads | 内部清理 | 无客户端入口，每小时补偿过期草稿和孤立文件 |

返回 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`。常用错误为 UNAUTHENTICATED、NO_FAMILY、FORBIDDEN、NOT_FOUND、HAS_FAMILY、INVITE_INVALID、RATE_LIMITED、CONFLICT、UPLOAD_INVALID、INVALID_IMAGE。未知错误只返回固定消息，不输出环境变量、身份上下文、原始事件或凭据。

## 数据与权限

六集合：users、families、family_memberships、family_members、garments、family_invites。用户和membership使用确定性_id。邀请令牌随机生成，数据库只存SHA-256摘要，24小时有效、单次使用，可撤销；预览/接受限每用户每分钟10次。

衣物档案不授予登录权限，每个账号只允许一个有效家庭。创建/加入/移出/移交使用事务；所有写操作检查当前家庭关系，并写membership作为撤权并发保护。衣物和档案携带version，避免覆盖家人刚保存的修改。

garments.status是生命周期（uploading/active/deleted/expired/discarded），wearStatus是可穿/待洗/收纳/淘汰。正式列表仅返回active。删除为软删除，MVP不开放永久删除/恢复。

六个集合禁止客户端直读写：

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

cleanupUploads的timer为 `0 0 * * * * *`（每小时），客户端调用被拒绝。读取只接收garmentId，经家庭鉴权后为实际文件签发请求期限300秒的链接。退出/移出后停止新访问；已经签发或下载的照片可能保留。

## 验证范围

本地覆盖家庭A/B/C隔离、家人编辑删除、邀请撤销/过期/单次消费/幂等、移出及晚到上传、版本冲突、孩子档案、分页、图片格式与EXIF。真实开发环境验证记录在知识库MP-001记录中。第二个微信账号同家庭互看及真机拍照仍待验收，未发布小程序。
