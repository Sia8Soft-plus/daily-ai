# 发布流程

本库已按公开范围独立整理。维护者 zkccpro 已确认 MIT 许可证及公开仓库；安全私密报告邮箱为 zkcc20164020@126.com，详见 SECURITY.md。

1. 保留 MIT LICENSE（Copyright (c) 2026 zkccpro），确保 package.json 与锁文件的项目 license 均为 MIT。
2. 核对 README 官网下载链接，并核对 SECURITY 中的私密报告渠道。
3. 审核 THIRD_PARTY_NOTICES.md 与第三方许可文件，保留发行所需声明。
4. 在干净目录 npm ci，运行 npm run verify:win、npm run audit:public。
5. npm run dist:win；检查 app.asar 无私有服务、安装器、凭据或用户数据，保持高分辨率图标。
6. 检查源码 ZIP 无 node_modules、work、构建结果、私有历史；唯一根目录。
7. 确认仓库地址后在本目录初始化新的 Git 历史，不推送内部工程历史。
8. 记录版本、测试平台、SHA256 与限制后发布。

本库的 dist 用于从公开源码生成的应用包；不要将外部内部归档整体移入。公开导出包只使用名字含 public 的归档。Linux 必须单独验证，不能复用 Windows 通过结论。
