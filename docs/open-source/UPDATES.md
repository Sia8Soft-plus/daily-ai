# 应用更新 / Application updates

Daily AI 的 Windows x64 正式版支持检查更新。点击右上角版本号，选择“检查更新”。启动后及运行期间也会检查元信息；**不会未经确认下载或安装**。

1. 检查官网 HTTPS 更新接口；服务端重新查询 SFTP 稳定发布目录，按数字版本选择最新版本。
2. 只有严格高于当前版本才建议升级，不降级，不循环安装同版本。
3. 用户点击“下载新版”，客户端下载并显示进度，可取消；验证总长度、SHA-256、ZIP 目录结构、逐文件清单及哈希。
4. 下载完成后显示“退出并安装新版”。用户可稍后安装；有生成任务、迁移或其他操作时阻止安装。
5. 独立更新进程等旧应用退出，备份受管理的程序文件，再替换程序；新版在数据库和界面初始化成功后回执。
6. 收到回执后删除旧程序备份和下载临时文件；失败恢复旧版。安装中断后，下次启动尝试恢复事务。

登录凭据、API Key、SQLite、HTML、自定义路径、收藏和回收站均不属于更新清单。安装路径保持不变，因此现有快捷方式、任务栏标识和高分辨率图标继续使用。用户自存的未知文件不清理。升级不会人为登出账号，但服务端会话正常到期/吊销仍需登录。

保护措施：禁止 ZIP 路径穿越与链接、未知程序条目、重复条目和超过 2 GB 的展开内容；拒绝程序替换路径与实际数据路径重叠。安装路径必须可写且不通过链接；需要提升权限的目录不会静默提权。更新状态/事务元信息位于系统 userData/updates，仅备份程序文件，不复制或迁移用户文档。

服务接口 `https://www.ai4indus.com/daily-ai/api/update/windows-x64` 提供 version、bytes、sha256、downloadPath。下载通过服务器代理 SFTP；桌面和公开源码不含 SFTP 密码。发布方只需提供 ZIP（包含 `.daily-ai-release.json` 程序清单），不再需要额外 `.sha256` 文件；服务端自动计算下载摘要。网络超时、版本变化、校验失败都不触发退出安装。

当前版本仍为 **0.2.12**。同号旧包需手动替换/安装一次才能获得此功能；后续更高版本才会触发升级建议。开发态及 Ubuntu 暂不自动替换应用文件；可使用官网手动下载已发布的对应包。

## Developer contract

- `main/updater.js`: metadata lookup, explicit download consent, progress/cancellation, integrity checking and helper handoff.
- `main/updater-helper.ps1`: Windows package extraction, protected-path validation, program-file transaction, restart acknowledgement and rollback.
- `main/update-package.js`: semantic version comparison, managed-file rules and release manifest generation.
- `renderer/updater.js` / `preload.js`: bilingual update UI and narrow IPC methods. No renderer-provided installation path or executable command is accepted.
- The native standalone installer and remote-DSA stay private. The desktop's in-app updater belongs to the public client source.

Public commands: `npm test` covers version and metadata/data safety. On Windows, `node scripts/updater-native-smoke.js` exercises replacement, rollback, interrupted recovery, tamper detection and user-asset preservation using isolated fixture programs. `npm run test:updater-ui` verifies separate download/install confirmations and language/theme behavior.

A release must retain the stable app ID and userData naming. Changes to database schemas must remain compatible with rollback or include a separate migration/backup design; this updater does not authorize destructive user-data migrations. Automatic updates are Windows x64 only for this release.

## 0.2.13 本地修复补充
启动后立即检查更新，运行期间每 6 小时复查。有新版或待安装更新时自动打开更新弹窗，同一次运行同一版本只提示一次，重启后重新提示；不会自动下载或安装。网络不可用不阻塞应用启动。
安装和用户数据根目录先解析迁移产生的 Junction 真实路径，目录内部链接防护保留。Windows 更新助手通过隐藏的 Start-Process 启动，校验进程 PID/token 握手后主应用才退出；启动日志保存在更新任务目录。
