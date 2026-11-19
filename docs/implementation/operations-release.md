# G2：备份、恢复与故障定位

本批在 Codex 云环境实现。发布与生产演练结果见本文件末尾和配套证据；实施中的命令不能提前视为验收完成。复用 aws-1、现有私有 R2，不接邮件服务。

## 备份合同

- `scripts/cloud/operations.py backup` 由 aws-1 root 执行。以 PostgreSQL repeatable-read 导出快照，在同一快照收集数据库计数和持久素材地址，再执行 `pg_dump --snapshot`。备份包含账号/密码哈希、项目、文档历史、权限、配置在库中的记录；文件按 SHA-256 校验并保留 MIME。
- 文件覆盖不可变 `asset_versions` 原图/缩略图、ready 旧素材和存储迁移的历史引用。正在上传的临时文件、未发布的任务产物和可重新生成的导出文件不在持久素材恢复承诺中。任何已引用文件缺失或摘要错误会使本次备份失败，不发布一个伪完整恢复点。
- 私有目录 `/var/backups/designx`（0700）保存完整压缩包和收据；同一压缩包上传私有 R2 `_designx_backups/v1/<run>/snapshot.tar.gz`，完整读取校验后才记录成功。归档文件 0600，含用户数据，禁止放入代码库或公开下载。
- 保留最近 7 个有成功备份的自然日，并保留最近 4 个有备份的自然周各一个恢复点；同日多次成功只保留最新点。仅处理严格路径和 `purpose=designx-backup-v1` 注册的备份对象，遇到不符合登记的同名对象立即停止。原始用户对象不属于保留清理范围。
- 同机副本可覆盖在线对象意外删除；私有 R2 副本可覆盖 aws-1 丢失。同一 R2 账号与 aws-1 同时丢失/凭据被盗的风险未由第三份独立账户副本覆盖，不能称为完整跨供应商容灾。
- `/etc/designx/app.env`、SSH 身份、R2 密钥和 TLS 私钥不进入数据归档；新主机需从已有秘密管理渠道重新配置。恢复需要 PostgreSQL 兼容版本、`designx_app` 登录角色及 `designx_tenant` NOLOGIN 角色和成员关系。归档保留表权限和 RLS，不以超级用户绕开应用租户检查。

## 调度和故障可见性

已提交版本部署后执行：

```sh
python3 scripts/cloud/access.py ssh 'sudo -n python3 /srv/designx/current/scripts/cloud/operations.py backup'
python3 scripts/cloud/access.py ssh 'sudo -n python3 /srv/designx/current/scripts/cloud/operations.py install'
python3 scripts/cloud/access.py ssh 'sudo -n python3 /srv/designx/current/scripts/cloud/operations.py health'
```

备份每天 04:30 UTC，随机延迟最多 15 分钟，停机后补跑。目标 RPO 为 24 小时 15 分钟以内；超过 30 小时无成功点或最近备份失败即呈异常。RTO 初始目标为 2 小时，包括重新部署/配置；演练的实际耗时单独记录，不把少量数据恢复时间扩大为任意规模承诺。

健康任务每 5 分钟检查 API HTTP、三个容器、排队超过 10 分钟/运行超过 30 分钟的业务任务、最近 24 小时失败任务和备份年龄。结果在 root 私有 `health.json`/`status.json`，异常任务返回非零退出码并记录 systemd journal。`systemctl status designx-backup.service designx-health.service`、`journalctl -u designx-backup -u designx-health` 定位到阶段；业务任务可用既有 `ops:report` 继续查找。未配置外部通知接收端；这不是已送达的告警，也不接入邮件替代。

安装器拒绝覆盖同名非 DesignX 管理的 systemd 单元。服务始终从 `/srv/designx/current` 执行；回退到不包含运维脚本的旧版本前先停止两个 timer，数据归档保留。应用表结构本批无迁移。

## 安全恢复演练

```sh
# 使用成功收据中的 runId；只生成新 UUID 数据库/对象前缀，没有覆盖生产的参数。
python3 scripts/cloud/access.py ssh 'sudo -n python3 /srv/designx/current/scripts/cloud/restore.py --run RUN_ID'
```

恢复从 **R2 副本** 下载并验摘要，拒绝目录穿越/链接/未知归档路径；在 `_designx_restore/<UUID>/` 空前缀恢复文件，验证所有文件后再创建全新 `designx_restore_<UUID>` 库。通过逻辑桶别名隔离历史与新增对象，生产对象不被改名或覆盖。数据库单事务恢复为 `designx_app` 所有，核对聚合计数；只在恢复库撤销历史登录 session、取消历史队列任务，防止启动重复执行旧任务。

恢复目录下 `restore.env`（0600）只供本次 API/Renderer 进程使用，API 回环端口 33101，AI 关闭。不要直接用生产 compose 启动恢复库；需独立命名容器/进程，只启验收需要的 API 和 Renderer。选择专用验收账号登录，检查它的文档版本和素材文件，另一个账号应收到 404；真实浏览器打开并导出，核对输出尺寸和内容。在新主机上先恢复角色/部署文件，再执行同样流程；禁止自动切换正式域名。

完成后停止本次进程，先列出清理清单，再显式应用：

```sh
python3 scripts/cloud/access.py ssh 'sudo -n python3 /srv/designx/current/scripts/cloud/restore.py --cleanup /var/backups/designx/restore-UUID'
python3 scripts/cloud/access.py ssh 'sudo -n python3 /srv/designx/current/scripts/cloud/restore.py --cleanup /var/backups/designx/restore-UUID --apply'
```

清理核对目录、数据库、对象 UUID 一致，存在数据库连接时拒绝执行；只删除该演练前缀、该空库派生的数据库和临时恢复文件。保留脱敏收据和清单。生产 GC 仍默认 dry-run、检查登记/年龄/引用，未在生产运行全量清理。

## 开发进程

`start.mjs` 先检查 5173/3001，占用时退出；启动的应用获得独立进程组，退出发送信号给本次组并有界等待，避免 corepack/pnpm 孙进程遗留。测试验证其他监听进程不受影响。已有健康会话继续复用，E2B 默认 chisel。

## 当前验收

- 工作区类型、结构、构建通过；106 单元、100 API 通过（包含真实 S3 备份下载/源文件丢失后恢复、摘要损坏拒绝、非空前缀拒绝、保留清理登记保护、既有 GC 引用保护）。
- 独立 PostgreSQL 自定义格式备份恢复成功，公开及非公开 schema 已有对象均拒绝覆盖；开发重复启动及独立进程组清理通过。
- 完整浏览器回归、正式站发布、定时器安装及真实恢复作品验收进行中，完成后写入实际提交与运行证据。
