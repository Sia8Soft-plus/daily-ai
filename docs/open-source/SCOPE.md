# 公开代码范围 / Public scope

本库完整包含 Daily AI 桌面应用、local-DSA 与搜索／模型公共核心；不包含 remote-DSA 或安装程序实现。许可证待所有者确认。

| 内容 | 状态 |
| --- | --- |
| 主进程、渲染层、preload、主题／文档／调度／本地存储 | 包含 |
| 多厂商模型调用、主题规划、搜索路由、核验、提炼、翻译、去重 | 包含 |
| local-DSA 启动、回环认证、流式进度与取消传输 | 包含 |
| 登录、订阅、分享的客户端接口与 UI | 包含；连接服务可选 |
| 自有图标、文档、客户端与本地测试 | 包含 |
| 远程用户验证、管理员、套餐计费、队列及部署实现 | 不包含 |
| 安装引导软件及下载凭据配置 | 不包含 |
| 用户报告、数据库、密钥、会话、日志及内部历史 | 不包含 |

独立目录：dsa/local 保存本地入口与 RPC；shared/html-sanitizer.js 保存客户端共用清洗；界面测试采用 scripts/subscription-fixture.js 的独立模拟契约。这些文件不依赖私有 server 目录。

客户端与 local-DSA 可独立安装、测试及构建。本库不授予托管服务额度、商标或安装器源码权利。第三方依赖遵循各自许可证，见根目录 THIRD_PARTY_NOTICES.md。

English: Includes the complete desktop client, local-DSA and shared search/model core. Excludes remote server/admin/billing/deployment and installer implementations. No credentials, personal data or internal history are included. The client can independently build and use local API keys. Licensing awaits the owner’s decision.
