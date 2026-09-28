# 数据与隐私 / Data and privacy

Daily AI 本地优先，但不是离线应用。以下说明数据流，不替代将来托管服务正式的隐私政策。

| 数据 | 保存／发送位置 |
| --- | --- |
| 主题、设置、文档索引 | 本地 SQLite |
| 日报与汇聚正文 | 本地 HTML |
| API Key、远端会话 | 主进程使用系统安全存储加密 |
| 搜索问题和查询词 | 所用搜索服务 |
| 主题、候选材料、生成提示 | 所选模型厂商 |
| 远程计划必要配置与去重指纹 | 使用远程模式时发送服务端 |
| 普通待领取结果 | 远端短期保存，领取确认后删除，最长保存按服务策略 |
| 主动分享的 HTML | 上传远端供链接访问，直到撤销分享 |

设计中的远程普通待领取保留上限为 7 天；主动分享与普通结果不同。第三方模型和搜索服务可能按其政策处理输入，用户应核对适用条款。

本地报告与 SQLite 并非全盘加密。系统凭据加密通常绑定当前用户／系统，迁移到其他机器后可能需重新输入 Key。程序不应记录密码；“记住账号”只保存用户名。

不要在主题描述中填写客户秘密、凭据或不适合发送给模型的信息。分享前检查全文；任何拿到公开链接的人可能保存副本，撤销不能收回已下载的内容。

提交故障时仅提供必要脱敏日志。删除回收站、撤销分享和退出账号是不同操作；退出不等于删除本地文档。

English: Local-first does not mean offline. Search queries go to search services; generation material goes to your model provider. Reports and metadata remain local unless remote processing or explicit sharing is used. Credentials use OS protection, while report files are not encrypted by default. Remembered usernames do not include passwords. Shared links may be copied; revocation cannot recall downloaded copies.
