# 0.2.12 — 版本入口、GitHub 与完整发布产物

- Daily AI 右上角显示应用实际版本，来自 Electron app.getVersion()；点击打开关于弹窗和 GitHub 发布记录。
- remote-DSA 右上角及侧栏版本来自 /health 接口；接口不可用时显示未知，不冒充最新版本。
- 两端右上角加入 GitHub 图标及 Star / Fork 链接，指向 https://github.com/Sia8Soft-plus/daily-ai 。支持亮暗模式、键盘焦点和窄窗口布局。
- 主工程 npm run dist:win / release:win 自动准备对应版本 Windows ZIP、完整源码 ZIP、安装引导 EXE。安装器编译失败会使发布失败。安装源版本及 SHA256 从刚生成的 ZIP 自动生成并内嵌，不依赖外部 JSON。
- 当前安装器通过指定 SFTP 发布目录下载最新稳定版；约 3 MB 的引导程序不包含完整应用，需要联网安装。
- 开源仓库仍只包含 Daily AI 与 local-DSA；remote-DSA 和安装器保持私有，公开构建不会包含私有安装器。

版本展示的是实际运行版本；发布记录链接不等同于自动更新检查，不会把旧版软件标成新版。

## 同版本安装器修订
安装器现通过 SFTP 获取云端最新稳定版，不再要求用户准备本地 ZIP。下载完成后校验和安装，EXE 仍约 3 MB，主应用及云端服务版本保持 0.2.12。
