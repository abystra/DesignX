# 开发环境与云服务器接入

每次会话先确认命令实际运行的位置、现有环境变量和网络路径，再选择对应的开发方式。仓库路径会随机器变化，本文中的命令均从仓库根目录执行。

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

首次进入 Codex 环境执行初始化，再启动开发进程。

    python3 scripts/cloud/dev.py setup
    python3 scripts/cloud/dev.py start

setup 安装锁定的 pnpm 依赖、Renderer 所需 Chromium 和已校验摘要的隧道工具，通过管理员 SSH 在 aws-1 的 designx 库中补齐租户角色，再执行仓库的幂等数据库迁移并验证数据库、Redis、R2。已有 designx 库由 workx 拥有。

start 在 Codex 工作区启动 Web、API、Generation、Media、Agent、Import 和 Renderer，共享到 aws-1 的数据库隧道。开发 Web 监听 0.0.0.0:5173，API 监听 127.0.0.1:3001。Node.js、Python 3、corepack、curl 是入口前提。

对象存储默认使用现有 R2 designx 私有桶，S3_BUCKET 与 S3_STAGING_BUCKET 均为 designx，保持仓库既有开发约定。S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY 优先使用同名绑定，缺少时从 WORKX_R2_PARENT_ACCESS_KEY_ID / WORKX_R2_PARENT_SECRET_ACCESS_KEY 读取。S3_ENDPOINT 等显式环境变量可覆盖开发默认值。服务端 S3 请求使用环境中的 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 规则。

AI_ENABLED 默认为 false，基础初始化及浏览器验收使用这一配置。需要 AI 功能时在该环境显式配置 AI_ENABLED 及对应模型、E2B 模板和凭据。

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
