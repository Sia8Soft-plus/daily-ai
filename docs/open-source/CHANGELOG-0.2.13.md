# 0.2.13

- 修复下载超时被误报为取消，改善中断响应。
- 修复无法解密的密钥导致流程中断；防止保存新密钥时覆盖损坏的凭据文件。
- 同步最新主应用与 local-DSA，维护者 zkccpro，MIT 许可证。
- 官网下载：https://www.ai4indus.com/daily-ai/ 。安全报告：zkcc20164020@126.com。

Windows 发布与更新沿用同一 appId 和数据目录，保留账号和本地资料。独立安装器与 remote-DSA 的修复不属于本公开代码库。

Download timeouts are now reported as failures rather than user cancellation. Credential read failures no longer crash the flow, and damaged vaults cannot be silently overwritten. Existing user data and application identity are preserved. Maintainer: zkccpro. License: MIT.

安全依赖更新：sanitize-html 2.17.7、Electron 41.10.7、electron-builder 26.15.3；保留原有应用标识和用户数据路径。
