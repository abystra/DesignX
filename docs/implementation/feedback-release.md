# G7：反馈受理与关键业务事件

本批补齐个人海报的应用内反馈、用户处理记录、受控运营查询和最小事实报告。普通账号无需邮件或手机号，不引入公开管理后台、第三方埋点或付费 AI。发布、测试、真实旅程与限制以同目录 `feedback-evidence-2026-11-18.json` 为准。

## 用户与运营流程

首页侧栏、Editor、Studio 提供“反馈与帮助”；失败任务提供关联反馈入口。用户填写类型、标题、描述，可移除作品/任务关联。任务浮层通过页面级 portal 呈现，320px 下不会被侧栏遮住；有独立滚动、加载/失败重试、Escape 关闭及焦点恢复。接口校验关联资源属于当前空间且作品未删除，不自动附带作品、图片、错误日志、密码、令牌或提示词。用户自行输入的反馈文本属于受理数据，界面提示不要填写秘密。

- `已收到`：反馈已在数据库持久化，不代表人工已读；`处理中/已解决/已关闭` 由运营明确写入，附可查看的处理回复。没有虚构回复时限、未读红点或邮件通知。
- 创建必须携带 UUID 幂等键。每空间 10 分钟最多 5 条，数据库锁串行判定，已受理请求的重试不占新额度。请求结果不明时保留原正文及键，关闭、刷新后仍可核对重试；明确校验失败允许修改。用户可清除本机草稿，说明这不会撤回已受理反馈。
- 草稿存于当前标签会话的 sessionStorage，以账号/空间隔离；重新打开时清理超过 30 天的记录，关闭标签会话通常会清除。浏览器存储不可用时告知用户保留窗口。此机制不承诺跨设备恢复或清除浏览器数据后的找回。
- 我的反馈以稳定游标分页，最多每页 50 条；错误与空列表分开，处理状态手动刷新或再次打开时读取。详情只显示安全的关联任务编号、种类、状态及时间，不回传任务 payload。
- 运营修改仅从授权 SSH/服务器服务凭据调用 CLI；没有浏览器管理角色或 HTTP 更新接口。更新要求当前 revision，冲突先读取再处理；回复历史按 revision 保留，运营标签留在服务端审计行，不暴露给用户。

## 运营命令

在当前 Codex 工作区使用已保存接入。`support.py` 通过 `access.py` 固定主机身份连接 aws-1，在服务器使用当前部署的不可变镜像与 root 私有 env；不把凭据复制到报告。`--workspace` 必须是明确 UUID。命令输出可能含用户反馈，只在授权工作区查看，不贴到公开工单。

```sh
python3 scripts/cloud/support.py list --workspace <UUID> --status received --limit 20
python3 scripts/cloud/support.py show --workspace <UUID> --id <反馈UUID>
# 回复文本先写到本机文件；脚本经 SSH stdin 传入，不拼接为 shell 命令。
python3 scripts/cloud/support.py update --workspace <UUID> --id <反馈UUID> --revision 1 --status triaged --actor <运营标签> --reply-file /tmp/reply.txt
python3 scripts/cloud/support.py report --workspace <UUID> --days 30
python3 scripts/cloud/support.py report --all --days 30
python3 scripts/cloud/support.py exclude --workspace <验收空间UUID> --excluded true --reason '专用验收夹具'
python3 scripts/cloud/support.py retention --all
# 先核对上一个命令列出的数量，再显式执行。
python3 scripts/cloud/support.py retention --all --apply
```

本机/隔离测试使用 `corepack pnpm ops:product list|show|update|exclude|retention ...` 与 `corepack pnpm ops:report --workspace <UUID>|--all --days 30`。没有 scope 会拒绝，避免旧版 `ops:report` 以普通生产角色查询 FORCE RLS 表时把零行误认作全局无任务。新报告从授权连接枚举空间，再逐空间 `tenantTransaction` 查询；队列、provider calls、已知成本、配额 hold 和租约统计保留。

## 事件字典与去重

所有事件只有固定字段：工作区、事件枚举、主体编号、去重键、可选项目/文档编号、revision、格式、服务端时间。没有任意 JSON payload，也不使用客户端传来的“成功”事件。旧通用 SSE events 继续负责产品实时状态，不作为本批分析表使用。

| 事件 | 可确认的含义 | 写入与去重 |
| --- | --- | --- |
| registration_completed | 普通账号、个人空间及会话事务已提交 | 注册同事务，每空间一次；旧账号不补造注册事件 |
| project_created | 项目及其创建事务成功 | 项目插入触发器，每项目一次；后续校验失败事务一并回滚 |
| first_effective_edit | 开始采集后，该项目首次提交与旧 JSON 不同的 artboard 内容 | 文档 revision 更新触发器及永久精简 milestone；重命名/相同内容保存不算；不是“历史首次人工创作”的推断 |
| save_succeeded | 一个新的 artboard revision 已提交 | 文档/ revision 唯一；内容无变化但确实提交 revision 仍是保存，重复请求不新增 |
| export_completed | render.export 任务由服务端完成 | 任务状态转 succeeded 的触发器，每任务一次；缩略图、失败、取消不算 |
| download_requested | 已鉴权的导出 GET 成功读出对象字节，准备返回 | 每导出任务首次 GET；HEAD、越权、不就绪不计。不能证明客户端完整收到或保存到设备 |
| project_opened | 开始采集后第一次收到有权限的界面访问请求 | 每项目一个 milestone；客户端持久化 history visit UUID，刷新/重试复用 |
| project_reopened | 后续新的有权限的界面访问请求 | 每 visit UUID 一次，保留期内去重；不是像素可见或真人停留证明 |

旧 `/open` 空请求继续更新最近打开时间，不产生新分析事件。新版统一从 App 的已加载项目发送 visit；网络/服务故障以同键重试，不阻塞编辑。每项目每分钟最多记录 60 个新 visit，整体 API 限流继续有效。保留期外的旧 visit 请求可能成为新的 reopen；首次编辑/打开/下载 milestone 不因明细清理而重建。

## 指标口径与限制

报告窗口为生成时刻往前 1–90 天，固定起止时间。默认 30 天。

- 注册 cohort 分母：窗口内有真实 `registration_completed` milestone 的未排除工作区。首作数是其中至少创建过一个 Editor 项目的空间数；首次海报导出率是其中截至窗口结束至少完成一次 Editor 项目导出的空间数 / 分母。观察时长随注册时间不同；分母为零返回 null。旧账号没有历史注册事实，不补记为新用户。
- 导出失败率：窗口内创建的 Editor 导出任务中，当前 failed 数 / 当前 failed+succeeded 数。queued/running/cancelled 独立展示；重试成功会改变当前状态，因此不是逐尝试故障率，也不是请求错误率。
- 事件明细计数包含 Editor 与兼容 Studio；首作/导出指标限定 `workspace_mode=editor`。用户资源硬删除/空间清理会级联清理关联事实，历史数不是不可变财务账本；软删除作品仍保留已发生事实。
- 显式排除的验收空间不进入汇总转化和事件指标；其任务故障仍保留在运营明细，避免隐藏故障。验收报告只证明统计合同，不把夹具转化率写成真实用户经营结果。
- 此批仅部署后采集；服务升级前事件不回填。下载率不能用来承诺“用户已保存到设备”。不记录广告归因、跨站行为或用户作品正文。

## 保留、备份与回退

`product-cli retention` 默认 dry-run。逐空间处理超过 180 天的事件明细，以及已解决/关闭且最后更新超过 365 天的反馈及其回复。活跃反馈保留；精简 milestone 和分析排除设置随项目/空间生命周期保留，防止重新制造首次行为。通用幂等表只保存反馈 receipt 和请求 hash，不留下原正文的副本。原有 SSE/任务日志生命周期未在本批改成同一规则。

服务器 `designx-product-retention.timer` 每日 06:00 UTC，随机延迟最多 15 分钟，调用当前部署代码；操作状态写 root 私有 `retention.json`，既有五分钟健康检查检测失败或超过 48 小时无完成。此处没有外部联系人通知。自然次日触发必须与安装及手动运行证据分开记录。

G2 完整数据库 dump 自动包含反馈、回复、设置、milestone 和事件表；素材归档规则不变。备份按既有 7 日/4 周保留，删除的反馈可能在保留期内的备份中存在。恢复先校验原快照计数，再对 UUID 独立恢复库应用当前已提交迁移，避免旧归档缺新表；不向生产库写回。仅有基础表数量校验不能单独证明反馈恢复，相关实测单列证据。

迁移 `0019` 增加表及数据库事实触发器。退回 G6 应用时保留这些表/触发器可继续记录创建、文档提交和导出；G6 没有注册、访问、下载采集与反馈 UI，报告必须标明采集中断。若回退到缺 `product-cli` 的镜像，先暂停产品保留 timer；恢复旧脚本前保留已有数据，不能直接 drop 表。优先前向修复。
