# 0.2.13 发布检查 / Release readiness

本库包含最新 Daily AI 桌面应用、local-DSA 和共享搜索/模型调用核心。remote-DSA、安装引导、私有部署及用户数据不在本库中。维护者为 zkccpro，MIT 许可证保留远程初始仓库 Sia8Soft-plus 的版权署名。

## 本轮同步

- 更新助手启动交接、Junction 迁移路径兼容及取消/超时处理。
- 启动立即检查，之后每 6 小时检查；有新版自动提示，下载和安装须用户确认。
- HTML、凭据、数据库和用户目录保护，更新失败回滚。
- 中英文 README、使用与开发指南、架构、贡献规范、安全报告渠道和第三方许可。

## 验证与边界

独立目录执行 npm ci，运行时代码逐文件核对，公开范围和敏感信息检查；89 项单元测试、完整 Windows UI 回归、8 项更新/回滚场景通过；依赖审计 0 个已知漏洞，文档本地链接无断链。CI 提供 Windows/Ubuntu 单元检查及 Windows UI 回归。

Linux 完整桌面体验、真实生产注册/支付和长时间稳定性仍需独立验收。本次未使用真实用户 API Key 执行收费模型调用。GitHub 源码推送不表示线上服务或下载包已更新。

Security reports: zkcc20164020@126.com。官网：https://www.ai4indus.com/daily-ai/。

English: This is the independent 0.2.13 desktop/local-DSA source tree. Private services, installer code and user data are excluded. Dependency installation, source synchronization, public-scope checks and automated regression are performed before publication. Full Linux desktop acceptance and live production registration/payment require separate validation. Publishing this repository does not deploy the hosted service or replace release binaries.
