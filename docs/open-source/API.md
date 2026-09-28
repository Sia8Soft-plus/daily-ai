# 公共接口约定

本文用于解释客户端与本地执行层，不是远程服务自部署指南。准确参数以 preload.js、main/account-service.js、dsa/client 和 dsa/local/rpc.js 为准；未发布稳定版本的内部接口可能变更。

## 渲染层 → 主进程

通过 preload 的受限方法调用，主进程统一验证参数、资源存在性与当前任务状态。不要从页面任意调用 IPC 通道，不把凭据返回到普通页面状态。

| 通道族 | 用途 | 约束 |
| --- | --- | --- |
| account:state / login / logout | 账户会话与状态 | 返回脱敏状态，登录会话由主进程保存 |
| account:mode | 切换本地／订阅 | 运行中不可切换；远程权益服务端核验 |
| account:preview / order / cancel | 报价、确认订阅与取消续订 | 先预览后确认，价格与状态以远端为准 |
| share:state / create / revoke | 单文档分享 | create 需要明确同意，校验文档与大小 |
| 本地文档／主题／计划接口 | 管理桌面数据 | ID、日期范围、路径和启用状态均需验证 |

## 本地 RPC

主进程启动子进程后获取端口与随机凭据。请求只走回环地址，Authorization: Bearer 使用运行期秘密；禁止将其写进配置、示例或日志。

POST /rpc 请求逻辑结构：

```json
{
  "operation": "summarize",
  "args": [],
  "callbackMethods": []
}
```

args 随操作而变，实际编码由 dsa/client 提供；不要将本示例当作完整生成参数。允许操作包括 model、search、plan、refine、summarize、translate。服务端按允许名单分派，不能指定任意 JS 模块或函数。

响应为 NDJSON 事件流，类型包括 progress、usage、status、heartbeat、callback、result、error。客户端按行解析，处理拆包、空行、断流及错误终态；收到 result 才能视为成功，连接关闭不等于成功。回调经 POST /rpc/callback/:uuid 回传，并绑定请求归属。

当前实现具有输入大小、并发、执行时限和流大小约束；心跳约 10 秒。取消应中断请求并触发执行层 AbortSignal。UI 必须将同一任务 ID 的状态关联起来，防止旧任务事件覆盖新任务。

## 远程集成契约

| 接口 | 作用 |
| --- | --- |
| POST /v1/auth/login、/register | 接入用户系统 |
| GET /v1/me | 当前用户、禁用状态等 |
| GET /v1/subscription | 套餐目录、当前权益与待生效变更 |
| POST /v1/subscription/preview | 服务端计算方案与生效时间 |
| POST /v1/subscription/order | 确认方案，不信任客户端价格 |
| POST /v1/subscription/cancel | 取消续订，既有本期权益按服务端规则保留 |
| DELETE /v1/subscription/pending | 撤销待生效套餐变更 |
| GET /v1/me/usage | 当前用户用量 |
| PUT /DELETE /v1/schedule | 同步或停用远端计划 |
| /v1/shares 系列 | 创建、查看、撤销文档分享 |

JSON 包装为成功 {ok:true,data:...}，失败 {ok:false,error:{code,message}}。客户端按错误码处理未登录、无订阅、禁用、服务不可用、支付不可用等，不能把 HTTP 成功直接当作业务成功。

公开示例不包含真实服务地址或账号。订阅模型、价格、周期均从响应读取；生产认证、限流与账单校验是远端责任，客户端本地改值不能获取服务权限。
