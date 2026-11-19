# Design X 开发规范与环境接入

每次会话先确认命令实际运行的位置、现有环境变量和网络路径，再选择对应的开发方式。仓库路径会随机器变化，本文中的命令均从仓库根目录执行。

## 视觉与 UI 开发规范

修改页面、CSS、交互组件、Board、Editor 或作品 Renderer 前，必须阅读 [视觉、组件与交互规范](docs/ui-standards.md) 及相关 [产品审计条目](docs/implementation/product-readiness-audit.md)。以下是开发必守摘要，完整 token、组件状态、断点、渲染和验收要求以视觉规范为准。旧的 docs/design-spec.md 是原型历史，不作为当前功能状态、字号、上传限制或演示行为的实施依据。

### 视觉方向与色系

延续暖灰底、白色面板、深墨文字、珊瑚色强调的创作工作室风格，摄影和作品承担主视觉；工作区控制简洁。不要在单个页面引入另一套主题、无业务意义的渐变/玻璃效果或过多装饰卡片。鼠尾草绿、米棕为有限辅助，不与主操作争夺注意。

| 用途 | 标准值 |
| --- | --- |
| 页面 / 面板 / 次级底色 | `#F8F8F6` / `#FFFFFF` / `#F1F2EE` |
| 主要 / 次级 / 元信息文字 | `#292B2E` / `#5F655E` / `#6B7068` |
| 装饰分隔线 / 可辨识控件边界 | `#E9E9E5` / `#858A81` |
| 品牌强调 / 选中背景 | `#EF644D` / `#FFF0EA` |
| 白字主操作 / hover / pressed | `#BF452F` / `#AA3927` / `#923020` |
| 成功 / 警告 / 错误 / 信息前景 | `#346447` / `#8A5700` / `#B83232` / `#315F8A` |
| 键盘焦点 / Board 组织选择 | `#AA3927` / `#526C43` |

原品牌珊瑚色配白字对比度约 3.18:1，不用于普通字号白字按钮；深珊瑚主操作约 5.11:1。普通文本至少 4.5:1，必要的控件边界/焦点至少 3:1；状态还必须有图标或文字。禁止用过淡颜色、小字号或单纯降低透明度表达关键说明。

新增样式使用规范中的 `--dx-*` 语义 token，不再散落硬编码近似色。统一 token 已定义在 `src/styles/tokens.css` 并全局接入；首页和创作目录已开始使用，旧页面仍需分批迁移。旧变量按语义逐步适配，用户作品和品牌自定义颜色单独保留。

### 排版、布局与组件

- UI 使用随包的 Noto Sans SC Variable 及系统回退；正文/按钮/标签默认 14px，元信息不小于 12px，手机输入内容至少 16px。页面标题 24–28px，区块标题 20px；首页主标题可 28–44px。旧 CSS 的 7–11px 业务文字不继续复制。
- 间距使用 `4/8/12/16/20/24/32/40/48/64px`。控件圆角 8px、卡片 12px、面板 16px、弹窗 20px；卡片靠细边框分层，浮层才使用明显阴影。
- 默认按钮/输入高 40px，触屏命中区至少 44×44px；图标用现有 Lucide 体系，尺寸 16/20/24px，提供可访问名称。一个操作区只有一个最高强调动作。
- 响应式按 600/850/1100/1450px 基础断点和真实容器宽度组织；手机使用单主视图、抽屉/底部面板，不挤压桌面三栏。输入软键盘与 safe-area 下操作仍可达；禁止全局隐藏横向溢出掩盖问题。
- 先复用已有组件，逐步将基础组件归入 `src/components/ui/`。按钮、字段、卡片、弹窗、菜单、反馈组件必须定义适用的 default/hover/pressed/focus/disabled/loading/selected/empty/error/success 状态及长内容行为；不要为每页另造一套。
- 弹窗有标题、焦点限制/恢复和背景隔离；按钮用 button，导航用 link，标签不以 placeholder 代替。关键操作支持键盘和触控，不能只在 hover 显示。错误消息不使用成功勾号。

### 交互与状态真实性

- 首页、搜索、目录、Studio 的能力门禁一致，依据 `/api/capabilities` 和资源权限；未开放项在创建项目或发生消耗之前处理。不能用可点击卡片承诺未实现的工具。
- 保存、上传、生成、取消、导出必须展示真实服务端状态。已保存以持久化确认/revision 为准；上传完成与素材 ready 分开；关闭弹窗不等于取消任务；unknown/部分成功不能伪装成成功或自动重发。
- 失败、切换面板和刷新恢复保留合理草稿；冲突不静默覆盖；重复点击和重试配合幂等。已完成保存后的列表刷新失败不能提示保存失败。
- 首页多行需求 `Ctrl/Cmd+Enter` 提交；Studio Enter 发送、Shift+Enter 换行。检查 IME composition，中文候选确认不能触发提交。全局快捷键不能劫持输入框的文本编辑。
- 内置示例、用户素材、AI 产物、可编辑文档有明确来源和类型。不要虚构项目、额度、未读红点、最近时间、进度或“已成功”消息。
- 动效以短暂颜色/opacity/transform 反馈为主，约 120–220ms，遵守 reduced-motion。必要状态不能只靠动画或颜色表达。

### 作品渲染与验收

- 产品 UI token 不覆盖用户画板的字体、颜色、坐标或尺寸。作品使用 packages/doc-render 的共享 ArtboardRenderer/NodeContent，Board、Editor、缩略图与服务端 Renderer 保持相同文档语义。
- 真实作品预览保留比例，不静默替换成示例图；缺素材/字体必须显式处理。图片和字体就绪后才截图/导出，选择框、焦点、保存提示等辅助 UI 不进入文件。
- 模板预览与可编辑文档逐步统一到同一版本来源；新增字体/效果必须同时验证编辑器和真实导出。不要另写一套近似版式 Renderer，不通过全局 CSS 修复局部问题。
- UI 修改按范围在真实浏览器核对 1440×1000、1024×768、390×844；布局修改增加 320×568、断点边界和 200% 缩放。检查键盘焦点、长内容、加载/空/失败、手机面板及软键盘可达性。未执行项如实记录。
- 修改作品渲染时执行相关 `pnpm test:render` 并核对真实下载；业务交互执行相关旅程，构建/静态检查不能替代浏览器验收。简单可逆样式不另写镜像实现的测试。
- 截图与报告保存在被忽略的 tests/e2e/.artifacts/<run-id>/，注明环境、提交、视口、真实/夹具数据和限制。基线更新必须解释差异，不能掩盖缺陷。应用改动按下文开发/部署流程复核正式域名；纯文档规范不重新部署服务器。

上述标准适用于新增及本次修改涉及的组件；旧页面分批迁移，不把制定规范称为全站已达标。合理例外在变更说明记录理由与验证，用户新的明确设计要求优先并同步文档。

## 三种开发环境

| 环境 | 应用与依赖的位置 | 接入方式 |
| --- | --- | --- |
| 本地开发 | 开发者电脑运行应用，Docker Compose 提供本地 PostgreSQL 和 S3 | 按 README 的本地启动流程，使用本地 .env 配置 |
| Codex 云端开发 | Codex 托管容器运行应用，aws-1 提供 PostgreSQL 和 Redis | 使用 scripts/cloud/access.py，通过托管 Tailscale 代理建立 SSH 和数据库隧道 |
| Claude 远端开发 | Claude 所连接的远端机器或容器运行应用，依赖由该环境的 setup 配置决定 | 读取该环境已有的 SSH、Tailscale 和数据库配置，按下文选择直连或 SOCKS5 隧道 |

环境判定结合用户说明、实际主机、已有 setup 与代理配置。127.0.0.1 指执行命令的那台机器。数据库 URL 指向回环地址时，先确认该端口对应本机服务还是已建立的隧道。

## 本地开发

依照 README 的“本地启动”配置 Node.js、pnpm 和 Docker Compose。默认 PostgreSQL 为 127.0.0.1:55432，数据库及用户为 designx，S3 为 http://127.0.0.1:58333。具体取值见 .env.example 和 infra/compose/docker-compose.dev.yml。

应用配置取值顺序为外部进程环境、.env.ai.local、.env。启动前核对已有外部变量对应的环境。本地常规开发直接使用本地依赖。任务涉及 aws-1 时，根据本地已配置的 Tailscale 路由和 SSH 身份建立连接。

测试使用 README 定义的测试入口及独立资源配置。TEST_DATABASE_URL 与应用的 DATABASE_URL 分别配置，测试入口默认使用本机 PostgreSQL 55432。

## Codex 云端开发

以下配置已在当前 Codex 托管环境验证。

- SSH 目标为 ubuntu@100.122.73.49:22，服务器别名 aws-1，实测 hostname 为 ip-172-31-42-202。
- 网络路径为托管 Tailscale 代理，使用 HTTP CONNECT 连接 proxy:8088。
- SSH 私钥由运行时变量 AWS1_SSH_KEY 提供。脚本在运行时创建权限 0600 的临时文件，并在退出时清理。
- 脚本显式指定 SSH 配置，处理当前镜像系统 SSH include 权限异常。
- SSH 主机公钥固定在 scripts/cloud/aws1_known_hosts。公钥变化时先核实服务器身份。
- PostgreSQL 位于 aws-1 的 127.0.0.1:5432。当前 DATABASE_URL 选择 designx 数据库和 workx 用户，URL 缺少密码时由 PGPASSWORD 提供。
- Redis 位于 aws-1 的 127.0.0.1:6379。当前 REDIS_URL 选择数据库 1，URL 缺少密码时由 REDIS_PASSWORD 提供。

在需要直连托管代理的命令执行器中运行，受沙箱限制时使用执行工具提供的权限升级机制。

### 初始化与启动

首次进入 Codex 环境执行初始化，再启动开发进程。会话可能延续既有进程；启动前先核对 5173/3001 与已有 `scripts/cloud/start.mjs`，健康时复用，避免重复启动。需要重启时只停止本项目的启动进程，由其清理 Worker 和 E2B 隧道后再启动。若旧 corepack/pnpm 包装进程退出后端口仍占用，核实 PID、工作目录及父级 concurrently 属于本仓库，再停止该孤立项目进程；确认端口释放后启动，不能直接重复 start。

    python3 scripts/cloud/dev.py setup
    python3 scripts/cloud/dev.py start

setup 安装锁定的 pnpm 依赖、Renderer 所需 Chromium 和已校验摘要的隧道工具，通过管理员 SSH 在 aws-1 的 designx 库中补齐租户角色，再执行仓库的幂等数据库迁移并验证数据库、Redis、R2。已有 designx 库由 workx 拥有。

start 在 Codex 工作区启动 Web、API、Generation、Media、Agent、Import 和 Renderer，共享到 aws-1 的数据库隧道。开发 Web 监听 0.0.0.0:5173，API 监听 127.0.0.1:3001。Node.js、Python 3、corepack、curl 是入口前提。

对象存储默认使用现有 R2 designx 私有桶，S3_BUCKET 与 S3_STAGING_BUCKET 均为 designx，保持仓库既有开发约定。S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY 优先使用同名绑定，缺少时从 WORKX_R2_PARENT_ACCESS_KEY_ID / WORKX_R2_PARENT_SECRET_ACCESS_KEY 读取。S3_ENDPOINT 等显式环境变量可覆盖开发默认值。服务端 S3 请求使用环境中的 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 规则。

AI_ENABLED 和 IMAGE_GENERATION_ENABLED 均默认为 false，基础初始化及浏览器验收使用这一配置。需要 AI 功能时在该环境显式配置 AI_ENABLED 及对应模型、E2B 模板和凭据。

### E2B 访问开发环境

默认使用 chisel。云开发环境主动连接 E2B 内的 chisel 服务端，由反向隧道将开发环境的 Web 5173、API 3001 映射到 E2B 的同名回环端口。chisel 使用随机认证和服务端指纹校验，E2B 入口要求 traffic access token。

start 默认创建专用 E2B 隧道沙箱，在开发进程运行期间定期续期，退出时清理。设置 DESIGNX_TUNNEL_SANDBOX_ID 可接入指定的现有 E2B 沙箱，退出时关闭本次隧道服务。E2B SDK 使用当前环境的 HTTPS_PROXY / HTTP_PROXY。

连接信息保存在 Git 忽略的 .env.cloud-tunnel.local。E2B 内的浏览器与客户端访问 http://127.0.0.1:5173，API 访问 http://127.0.0.1:3001。

cloudflared 是显式选择的备用方式。

    python3 scripts/cloud/dev.py setup --tunnel-provider cloudflared
    python3 scripts/cloud/dev.py start --tunnel-provider cloudflared

也可显式设置 DESIGNX_TUNNEL_PROVIDER=cloudflared。该模式建立临时 HTTPS 入口并输出 URL，应用的 WEB_ORIGIN 随入口设置。此模式要求 cloudflared 可直连 Cloudflare 网络；当前 Codex 网络中的直连测试被拒绝，需在具备对应网络能力的环境使用。浏览器直传 R2 时，桶 CORS 还需允许实际使用的浏览器 Origin，现有开发规则允许 http://127.0.0.1:5173。

仅需单独建立 E2B 隧道时，在应用已运行的环境执行 node scripts/cloud/tunnel.mjs，默认同样为 chisel，--provider cloudflared 显式启用备用。


验证 SSH、PostgreSQL 身份和 Redis 认证。

    python3 scripts/cloud/access.py check

执行服务器命令。

    python3 scripts/cloud/access.py ssh 'hostname && whoami'

通过数据库隧道启动应用。

    python3 scripts/cloud/access.py run -- pnpm dev:api
    python3 scripts/cloud/access.py run -- pnpm dev:v2

run -- <command> <arguments> 自动选择可用回环端口，为子进程更新 DATABASE_URL、REDIS_URL、PGHOST 和 PGPORT，命令结束时清理隧道。相关应用进程需要共享连接时，在一次 run 中启动。S3、AI 等其他依赖继续使用当前环境提供的配置。

2026-11-18 实测 SSH 登录用户为 ubuntu，PostgreSQL 返回 designx|workx，Redis 返回 PONG，本地隧道转发也已验证。

## 开发与服务器部署

当前 Codex 环境负责开发、构建和验证。用户通过 https://designx.velax.cn 访问 aws-1 上独立部署的应用版本。

部署已提交的当前代码版本。

    python3 scripts/cloud/deploy.py

该入口先构建 Web，再将当前 Git 提交和 dist 上传至 /srv/designx/releases/<版本>。服务器构建 Docker 镜像并固定其镜像 ID，通过 infra/compose/docker-compose.aws.yml 运行 API、all Worker 和 Renderer。应用使用生产运行模式及宿主机网络，API 仅监听服务器 127.0.0.1:3100。Docker 的 restart 策略负责服务器重启后的进程恢复。

Nginx 为 designx.velax.cn 提供 HTTPS，静态文件位于 /srv/designx/current/dist，/api/ 代理至服务器本机 3100。该站点的运行依赖服务器上的部署文件和容器。E2B 访问开发环境继续使用前文的默认 chisel 方案。

服务器配置保存在 /etc/designx/app.env，权限 0600。首次部署为服务器创建独立的 designx_production 数据库和 designx_app 登录角色，密码在服务器生成并写入该私有配置。R2 参数从当前环境的应用绑定读取，后续部署保留已有服务器配置。Codex 开发仍使用前文的 designx 数据库。当前 AI 与图片生成默认关闭。上传使用已有的同源 API 通道，由服务器写入 R2。

部署会执行记录式数据库迁移、检查 API 健康和 Worker/Renderer 就绪，再切换 current 链接与 Nginx。已有部署存在时，服务启动或站点配置失败会恢复上一版本的镜像配置与静态链接。数据库迁移按仓库现有方式向前执行。

该服务器使用的 TLS 证书路径为 /etc/letsencrypt/live/designx.velax.cn，现有 Certbot 自动续期任务在证书更新后重载 Nginx。域名 DNS、证书及服务器已有 PostgreSQL/R2 是部署前提。

## 产品现状与完成标准

首版主线已确定为个人海报：模板/素材 → 编辑 → 保存 → 导出。实施顺序、审计映射和验收记录见 [个人海报首版计划](docs/implementation/personal-poster-release.md)。后续会话先核对该计划的最新状态，不重新询问已确定的方向。

后续未完成范围、代码缺口与待验收项的区分，以及可直接执行的 G1–G8 提示词见 [剩余工作与 Goal](docs/implementation/remaining-goals.md)。A、B1、B2 已有发布证据，不按原审计重复重做；G1–G7 完善手动海报产品，G8 真实 AI 单独启动。每项完成后同步状态与证据。

- 首版账号使用普通用户名和密码，邮件投递/邮箱验证/邮件找回已由用户明确排除，不再询问邮件服务配置或视为上线依赖。旧邮箱账号仍作为登录标识兼容；账户设置、改密与会话撤销见 [B2 普通账号](docs/implementation/account-release.md)。禁止仅凭用户名重置密码。
- 新建个人海报使用 `workspaceMode=editor`，旧项目/多画板默认 `studio`；列表、搜索和刷新必须遵守持久化入口。
- 创建请求提供幂等键；素材解析、版本权限校验和初始文档写入在同一事务。内置 `stock-*`、上传素材 ID 和参考记录 ID 不混用。
- 公共工具目录只列真实手动入口和 `/api/capabilities` 配方。提示词明确标注为预设，能力关闭时在创建项目之前阻止进入。
- 模板文档构造复用 `src/data/template-design.js`；UI 预览与服务端创建保持一致。品牌 Logo 使用素材 ID、版本 ID 和不可变 URL 的统一合同。
- 项目/素材目录使用 `/api/projects/page`、`/api/assets/page` 的游标分页与服务端筛选；不要先取 1000 条再在浏览器过滤，也不要自动遍历全库填满选择器。上传状态读取单素材；错误与空结果分开。B1 合同及限制见 [资料库分页与搜索](docs/implementation/library-search-release.md)。
- `pnpm test:poster` 自动创建隔离数据库、S3 和 Web/API/Media/Renderer，执行普通账号、个人海报、1000 条以上资料库旅程与共享渲染对照；需要本机 PostgreSQL、已有 SeaweedFS 镜像和 Playwright Chromium。

产品梳理见 docs/implementation/product-readiness-audit.md，线上抽查证据见同目录 product-readiness-evidence-2026-11-18.json。2026-11-18 的部署已有真实账户、项目、素材和导出链路，但线上 Agent/图片生成关闭，目录中的提示词预设不代表独立工具已实现。后续工作先核对当前部署和 /api/capabilities，再更新报告中的问题状态与验收证据。

功能完成需要贯通用户入口、真实接口、数据保存、失败恢复和结果交付；历史本地验收、fixture、健康检查或部署成功不能单独等同于 C 端产品就绪。开发环境验证后部署已提交版本，并通过正式域名复测。梳理和文档更新本身不改变线上业务开关。

## Claude 远端开发

先读取 Claude 远端环境的 setup 和已有 SSH 配置，确认 Tailscale 运行模式、实际 socket、代理端口与密钥位置。用户此前说明 Claude 的 setup 使用 SOCKS5 接入 tailnet，该环境的具体参数尚未在本次 Codex 会话实测。

- 当 Claude 的命令实际运行在 aws-1 上时，数据库 URL 的回环地址直接指向 aws-1 本机服务。
- 当 Claude 运行在另一台具有原生 Tailscale 路由的远端机器上时，使用该机器已配置的 SSH 身份和路由连接 aws-1，按应用所在机器建立所需隧道。
- 当 Claude 运行在 userspace Tailscale 容器中时，使用 setup 中实际监听的 SOCKS5 代理连接 SSH，并按需配置 SSH 本地端口转发。

下面示例适用于已经确认 SOCKS5 监听在 127.0.0.1:1055、安装了支持 SOCKS5 的 OpenBSD nc，且 setup 已将身份文件写入 ~/.ssh/aws1 的环境。参数以 Claude 的实际 setup 为准。

    ssh -o 'ProxyCommand=nc -X 5 -x 127.0.0.1:1055 %h %p' -i ~/.ssh/aws1 ubuntu@100.122.73.49 'hostname; whoami'

数据库凭据继续使用 Claude 环境已有的绑定和角色。proxy:8088 与 AWS1_SSH_KEY 是上述 Codex 接入配置，使用前须确认当前环境提供对应能力。数据库默认端口、本机端口转发和本地 Docker 映射端口应分别确认。

## 凭据与新会话

密钥和密码保存在各环境的秘密或运行时变量绑定中。版本库保存接入脚本、主机公钥和说明。数据库操作遵循用户当前任务的范围，例行连通性检查执行身份查询和 Redis PING。

Codex 环境需要绑定 AWS1_SSH_KEY、DATABASE_URL、PGPASSWORD、REDIS_URL 和 REDIS_PASSWORD。其他环境使用各自实际配置的凭据来源。

新会话需要检出包含本文件及 scripts/cloud/ 的仓库版本，或使用包含这些文件的已发布环境快照。进入仓库后先读取本文件，并在任务需要云端依赖时自行建立连接。对已有配置可确认的信息，直接读取和验证。

仓库提交与推送会保存这些文件。环境源配置与快照的发布是单独的操作，未来会话使用的仓库分支及环境变量绑定也需与目标开发环境一致。
