# Design X · 灵感设计室

保留现有高仿真 UI 的创作系统：账户与个人空间、模板、tldraw Board、精细编辑器、项目/版本、素材与品牌、AI 可编辑设计、真实后台处理和导出。业务数据在 PostgreSQL，文件在 S3 兼容对象存储，任务由独立 Worker / Renderer 执行。

AI 实现采用 **E2B 官方 SDK → 指定 Codex 模板内 Harness → Codex SDK → DeepSeek**，包含参考图创作、可编辑画板、修改提案预览/应用、取消和持久化回合。历史浏览器与模型验收见 [AI 创作实现](docs/implementation/ai-creation.md)、[ADR-0001](docs/adr/0001-codex-e2b.md)。2026-11-18 正式站点的 Agent 与图片生成均未启用，历史实现记录不代表当前线上开放状态。

当前产品完成度和下一阶段实施以 [C 端产品审计](docs/implementation/product-readiness-audit.md) 为准。该报告区分真实链路、静态预设、线上未开放能力和缺失功能，记录了线上复现问题、改造顺序与验收标准。项目已能独立部署，仍需完成面向普通用户的产品闭环。

页面、组件及交互开发遵循 [UI 开发规范](docs/ui-standards.md) 和 [AGENTS.md](AGENTS.md) 中的必守摘要，包含统一色系、字体/布局尺度、组件状态、真实业务反馈、作品渲染与响应式验收。规范是后续开发目标，现有样式按组件逐步迁移。

基础链路提交为 `44fcd0e`、`ead7d15`、`2bcc3f0`。本轮分三步交付：Board 便签/分区 `5f7a263`，持久化项目导入 `2291383`，最后汇总验收与文档。架构目录描述的长期目标不等于全部实现，具体完成度见 [阶段进度](docs/implementation/progress.md)。

## 本地启动

已验证环境：Node.js 22.22.3、pnpm 10.20.0、Docker。数据库与存储只绑定本机地址，使用专门的开发卷，不覆盖其他项目。

```bash
corepack enable
pnpm install --frozen-lockfile
if [ ! -f .env ]; then cp .env.example .env; fi
docker compose -f infra/compose/docker-compose.dev.yml up -d --wait --wait-timeout 60
pnpm db:migrate
pnpm exec playwright install chromium
pnpm dev:all
```

打开 [Design X](http://127.0.0.1:5173/)，使用已有用户名/密码登录，无预置通用密码。公开注册默认关闭（`REGISTRATION_ENABLED=false`），登录页不显示创建账户入口，注册 API 返回 403；只有经明确授权配置服务器 `REGISTRATION_ENABLED=true` 并重启 API 才能重新开放。隔离测试自行开启注册以创建夹具，不更改正式站。已有邮箱账号继续登录；侧栏“账户设置”支持资料修改、改密与退出设备。端口：Web 5173、API 3001、PostgreSQL 55432、S3 58333。迁移需要数据库建表/角色权限；上述 `--wait` 等待 PostgreSQL healthy，SeaweedFS 只检查容器运行状态。应用启动后应看到 `Design-X media worker ready` 和 `Design-X renderer ready`；首次上传/导出验证存储与处理链路。

使用 `127.0.0.1:5173` 与示例 `WEB_ORIGIN` 保持一致。改主机名或端口时，需要同步调整 `.env` 和 Vite 配置中的代理/端口。`/api/health` 返回 `status: ok` 只证明 API 可达；`aiEnabled` 反映配置开关，不代表模型或后台处理全部健康。

启用 AI：在 Git 忽略、权限 0600 的 `.env.ai.local` 配置 `AI_ENABLED=true`、`E2B_API_KEY`、`DEEPSEEK_API_KEY`、`E2B_TEMPLATE_ID=u1yrkaokyjzef8qchho5`、`DEEPSEEK_MODEL=deepseek-flash`。开发进程按“外部进程环境 → `.env.ai.local` → `.env`”取值，生产仅从外部环境注入；不要把真实密钥填进示例文件、前端变量或代码。修改配置后重启 API/Worker。

各进程也可单独运行：`pnpm dev:web`、`pnpm dev:api`、`pnpm dev:worker`、`pnpm dev:renderer`。仅运行原有 `pnpm dev` 会启动前端，其他进程仍须运行。

停止应用使用 Ctrl+C；`pnpm infra:down` 停止基础设施并保留数据卷。不要用 `down -v`，除非有意删除本项目开发数据。

## Codex 云端开发

应用运行在 Codex 工作区，PostgreSQL 和 Redis 使用 aws-1，文件使用已配置的 R2 designx 私有桶。环境变量绑定与本地、Claude 远端开发的区别见 AGENTS.md。

    python3 scripts/cloud/dev.py setup
    python3 scripts/cloud/dev.py start

初始化会准备依赖、Chromium、数据库租户角色和迁移，并验证云端连接。启动会运行 Web、API、各 Worker 与 Renderer，并默认建立 chisel 反向隧道。云开发环境主动连接 E2B 内的 chisel 服务端，E2B 随后可访问 http://127.0.0.1:5173 及 http://127.0.0.1:3001。连接信息写入 Git 忽略的 .env.cloud-tunnel.local。专用隧道沙箱随开发进程续期和清理，已有沙箱可通过 DESIGNX_TUNNEL_SANDBOX_ID 指定。

cloudflared 通过 setup/start 的 --tunnel-provider cloudflared 参数显式选择。该备用模式输出临时 HTTPS URL，R2 浏览器直传需匹配对应 Origin 的 CORS。基础开发默认 AI_ENABLED=false，启用 AI 时使用该环境明确配置的模型和模板。

## 部署到 aws-1

在当前环境完成开发并提交代码，再部署当前提交。

    python3 scripts/cloud/deploy.py

部署入口为 https://designx.velax.cn。Web 构建文件、API、Worker 和 Renderer 均在 aws-1 上运行，Nginx 提供静态页面并将 /api/ 转发到服务器本机 3100。部署目录、运行配置、回退步骤和开发环境区别见 AGENTS.md 的“开发与服务器部署”。

## 可用旅程

以下描述仓库中的实现路径。正式站点以服务端能力状态为准；创作参考复用、品牌 Logo、导入大小和入口一致性等已知问题见上述产品审计。

1. 模板灵感 → 预览模板 → 使用模板 → 修改文字/图片/图层 → 自动或手动保存 → 刷新重开。
2. 开始创作 → Board → 添加画板、模板、素材或便签 → 创建分区并管理成员 → 平移缩放、多选、对齐、复制/移除、撤销重做 → 精细编辑 → 返回原画布。移动分区带动成员，删除分区保留内容；成员通过明确加入/移出改变归属。
3. 资产库 → 上传真实图片 → 后台校验/缩略图 → 素材引用；管理收藏、创作参考、品牌色、字体和 Logo。
4. 项目 → 文件夹、重命名、移动、最近打开、回收站和恢复。注销后重登仍保留。
5. 编辑器 → 命名版本 / 恢复 → 导出 PNG、JPEG、WebP、单页 PDF、原生 `.dxproj`；右上角创作动态查看后台状态、重试和下载。SVG 另有 API 导出，采用含 DOM 的 `foreignObject`，不作为通用矢量编辑器交换格式承诺。
6. Board → 项目包下载 → 另一账户“我的项目”导入 → 后台重建新项目、文档及私有素材 → 打开继续编辑。关闭导入弹窗后已接收的任务仍继续，可从创作动态打开结果。
7. Agent → 添加参考素材和需求 → 生成 1–3 个可编辑方案 → 精细编辑/导出；选中画板“继续修改” → 预览提案 → 检查版本后应用。期间移动/便签改动与新增结果合并，撤销不误删服务端 AI 成果。

素材上限每张 10 MiB，PNG/JPEG/WebP/GIF；GIF 摄取首帧。被设计、历史版本或品牌/参考引用的素材不能删除。导出绑定提交时的版本，后续编辑不改变已排队文件。断网时已打开编辑器的未同步改动缓存在 IndexedDB，恢复网络后可重试；冲突提供保留副本或使用最新版本。

原生项目包为 JSON v1（不是 ZIP）：源文件最多 40 MiB，内嵌素材解码后合计 30 MiB、单图 10 MiB，最多 100 张画板、200 个素材、10,000 个图层；未知版本拒绝。图片实际解码并保存为新空间的私有文件。失败源包保留供任务重试，尚未提供长期失败文件的定时清理。完整限制及实测范围见 [Board 与导入说明](docs/implementation/board-import.md)。

Board 默认使用 tldraw 5.6.0 的原生框选、拖动、缩放与相机，保留原高仿真界面、业务历史和真实文档预览。视口外保留轻量 SDK shape，卸载重内容；全选、分区成员和组织历史覆盖完整数据。显式比较入口为 `/?boardEngine=legacy#studio/项目ID`。本轮实现、原生交互专项和 200 画板生产性能三轮见 [tldraw 接入验收](docs/implementation/tldraw-board.md)；此前性能基线见 [Board 性能验证](docs/implementation/board-performance.md)。项目包的 100 画板预算保持不变。

## 验证

```bash
pnpm typecheck
pnpm check
pnpm test:unit
pnpm build
# 本地 PostgreSQL + S3；测试自动创建临时库和桶，并启动自己的 worker/renderer。
pnpm test:api

# 隔离环境中的个人海报完整旅程 + 渲染一致性（自动启动 Web/API/Worker/Renderer）
pnpm test:poster
# 重新启动 pnpm dev:all 后运行浏览器旅程。
python3 -m pip install -r tests/e2e/requirements.txt
pnpm test:e2e
pnpm test:editor
pnpm test:render
pnpm test:board
pnpm test:import
# 下列命令显式调用真实收费沙箱和模型，不属于普通单测：
pnpm verify:ai-runtime
python3 tests/e2e/ai_creation.py --allow-paid-ai
```

`test:unit`、`test:api` 和 `test:poster` 不读取开发者的 `.env` / `.env.ai.local`，并替换继承的云存储、E2B 和模型凭据。API 每轮使用唯一数据库及素材、暂存、旧存储测试桶，结束只清理本轮资源，不使用现有项目或其存储桶。默认连接本机 PostgreSQL `55432`，并从已有的 `chrislusf/seaweedfs:3.85` 镜像启动临时 S3 容器，使用随机 loopback 端口、独立容器数据并在结束时移除；不会构建或拉取镜像。unit 不需要 Docker。

可通过 `TEST_DATABASE_URL` 调整本地 PostgreSQL，数据库用户需可创建数据库。显式设置 `TEST_S3_ENDPOINT` 时使用指定本地 S3 服务，不启动容器；另支持 `TEST_S3_REGION`、`TEST_S3_ACCESS_KEY_ID`、`TEST_S3_SECRET_ACCESS_KEY`。只接受本地地址；可选 `TEST_S3_BUCKET` / `TEST_S3_STAGING_BUCKET` 必须是尚不存在的桶名。单文件回归使用 `pnpm test:api --file v2-storage.integration.test.ts`；显式 `verify:*` 真实服务验收不受此隔离影响。

`pnpm check` 包含页面结构检查以及保留的原型规则/会话测试夹具；这些夹具不参与产品执行，也不能代替真实服务验收。完整浏览器步骤、实际结果与限制见 [验收指南](docs/implementation/verification.md)、[执行记录](docs/implementation/verification-results.md)、[阶段进度](docs/implementation/progress.md)。

## 工程边界

- `src/`：现有前端渐进迁移，保留原 CSS、页面和交互；`apps/web` 是工作区入口。
- `apps/api`、`apps/worker`、`apps/renderer`：HTTP/SSE、媒体工作进程、Chromium 导出进程。
- `apps/harness`、`packages/ai-runtime`：E2B 内 SDK 工具执行；控制面生命周期、事件与文件成果校验。
- `packages/doc-core`、`doc-render`：版本化文档校验、正向/反向操作、统一 DOM/SVG 渲染。
- `packages/server-domain`、`server-infra`：领域业务、RLS、事务、队列和 S3。
- `db/migrations`、`infra/compose`：可重放 SQL 迁移、本地 PostgreSQL / SeaweedFS。

当前支持本地联调与 aws-1 部署，部署验证范围以实际运行结果为准。`pnpm build` 只构建 Web 静态文件；aws-1 的 API、Worker、Renderer 镜像、进程管理和 Nginx 配置由 scripts/cloud/deploy.py 部署，自动 CI/CD 流水线仍需另行配置。首版按普通用户名/密码账号交付，邮件服务不是依赖。自助找回、账户删除、OTP、通用自动冲突解决、定时素材 GC、多人实时协作、独立图片/视频模型、完整配方与计费未实现。低倍率仍渲染真实图层，无缩略图 LOD。生产需独立配置数据库角色、存储凭证、HTTPS、备份与 tldraw 许可，不能使用示例开发密码。

个人海报首版的实施顺序、审计整改和验收见 [个人海报首版计划](docs/implementation/personal-poster-release.md)，项目/素材分页及服务端搜索见 [B1 资料库实施记录](docs/implementation/library-search-release.md)。普通账号与会话管理见 [B2 账户实施记录](docs/implementation/account-release.md)。`pnpm test:poster` 同时覆盖普通账号全流程和超过 1000 条数据的资料库浏览器旅程。
