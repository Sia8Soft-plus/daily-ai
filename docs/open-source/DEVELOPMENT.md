# 开发指南 / Development

本库包含 Daily AI、local-DSA 及公共核心。无需 remote-DSA、安装器或独立数据库服务。

推荐 Node.js 22.14+（22.x）、npm；Electron 固定为 41.0.0。依赖版本由 package-lock.json 固定。

```bash
npm ci
npm start
npm run check
npm test
npm run audit:public
```

Windows 完整回归：`npm run verify:win`。UI 检查采用隔离测试档案，不使用个人数据库或密钥。跨平台单元测试由 CI 验证；Ubuntu 桌面完整体验仍需单独验收。

```bash
npm run dist:win
# 在 Linux 构建机执行：
npm run dist:linux
```

Windows 中间包在 work/build/win-unpacked，最终 ZIP 在本库 dist 下，含唯一顶层目录。构建不包含私有服务、部署或安装器。不要从内部历史包补文件。

| 路径 | 职责 |
| --- | --- |
| main | Electron 生命周期、数据库、调度、文档与客户端服务连接 |
| renderer、preload.js | 页面、样式、语言及受限 IPC |
| shared | 公共契约、模型发现、HTML 清洗、远程连接地址 |
| dsa/core | 搜索、规划、核验、提炼、翻译与模型调用 |
| dsa/client | 本地启动、任务上下文与 RPC 客户端 |
| dsa/local | 回环地址上的本地入口与认证传输 |
| scripts、tests | 构建工具、独立模拟数据与回归 |

默认可选的托管服务地址在 shared/remote-endpoint.js，通过 DAILY_AI_REMOTE_URL 覆盖；本地 API Key 模式无需登录。首次启动可在“生成方式”选择本地 Key。账户、订阅、分享的客户端代码保留；服务端权益校验不在本库实现。

图标源为 assets/icon.svg，已提供高分辨率 PNG 和 ICO。可选生成工具 scripts/generate-icons.py 需要 Python 和 Pillow，日常构建不需要重绘图标。

English: Install with npm ci, launch with npm start, test with npm test and verify the full Windows UI with npm run verify:win. Build with npm run dist:win (or dist:linux on Linux). The public tree has no private-service source dependency. Configure local API keys in Generation mode; remote account/share clients remain optional.

## Electron 下载网络问题

默认 npm ci 从 Electron 官方分发位置下载运行时。如果网络连接中断，可在当前终端临时设置可访问的可信镜像；本次 Windows 验证使用以下重试方式，未关闭 TLS 或校验和验证：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm ci
Remove-Item Env:\ELECTRON_MIRROR
```

不要把本机 node_modules 复制进公开库。脚本与依赖锁文件均已随库提供。
