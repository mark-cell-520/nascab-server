# NasCabOS 服务端部署指南

本目录（`deploy/`）与源码中的改造一起，把 NasCabOS 从「桌面 NAS 应用」变成「可长期运行的服务」。核心思路：**所有环境差异都通过配置注入，不改代码**。

> 改造内容见文末「改造清单」，相对上游的修改声明见 [MODIFICATIONS.md](MODIFICATIONS.md)，仓库结构与上游同步见「仓库结构与上游同步」。

---

## 目录

- [快速开始](#快速开始)
- [Web 控制台](#web-控制台)
- [仓库结构与上游同步](#仓库结构与上游同步)
- [配置系统](#配置系统)
- [部署方式](#部署方式)
  - [systemd（Linux 裸机）](#1-systemdlinux-裸机推荐)
  - [Docker / docker-compose](#2-docker--docker-compose)
  - [Windows 服务](#3-windows-服务)
  - [裸机脚本](#4-裸机脚本快速验证)
- [健康检查与探针](#健康检查与探针)
- [反向代理](#反向代理)
- [运维手册](#运维手册)
- [已知平台差异](#已知平台差异)
- [改造清单](#改造清单)

---

## Web 控制台

源码部署时上游的 `web/main`（官方构建产物，被 `.gitignore` 排除）并不在仓库里，直接 `node src/main_nascab_os.js` 起来后 `/` 是 404。因此本仓库自带了一个 **Web 控制台**（`electron_server/web/console/`，纯静态、无构建步骤、无前端依赖），启动即在 `/` 可用。

### 首次登录

| 场景 | 会发生什么 |
|---|---|
| 全新数据目录 | 启动时自动创建一个超级管理员，**账号密码直接打印在启动日志里**（也会在 10 秒后再打印一次），登录后请立即修改 |
| 设了 `NASCAB_ADMIN_USER` + `NASCAB_ADMIN_PASSWORD` | 用这对账号创建，日志里会标注「来自环境变量」 |
| 启动时创建失败 / 数据库被清空 | 打开 `/` 会直接进入**初始化向导**，在页面上创建第一个超级管理员 |

```bash
# 推荐：Docker / 脚本化部署时显式指定首管理员
NASCAB_ADMIN_USER=admin NASCAB_ADMIN_PASSWORD='换成一个强密码' node src/main_nascab_os.js

# 首次启动的日志长这样
# ================ 首次启动：超级管理员账号（来自 NASCAB_ADMIN_USER 环境变量）================
#   用户名: admin
#   密码  : 换成一个强密码
#   请登录 Web 控制台后立即修改。控制台地址: http://<服务器IP>:6789/
```

### 页面

登录后是单页控制台（前端路由，刷新/直接访问子路径都不会 404）：

| 页面 | 内容 | 数据来源 |
|---|---|---|
| 概览 | CPU / 内存 / 网络 / 温度四张指标卡（含迷你走势）、存储池、设备信息、服务状态、系统通知 | `/api/console/overview`、`/api/home/config` |
| 存储管理 | 各挂载点容量卡片（文件系统、已用、总量、使用率） | 同上 |
| 用户管理 | 账号列表（角色、状态、创建/最近登录时间） | `/api/user/list` |
| 网络服务 | 监听地址、P2P 远程访问、DDNS、实时上下行速率 | `/api/service/*`、硬件监控 |
| 安全中心 | 登录防护状态、IP 黑名单、登录设备 | `/api/security/*`、`/api/auth/devices` |
| 应用中心 | 已启用的应用（标识 → 中文名映射） | `/api/apps/getApps` |
| 进程管理 | 服务端各进程的 PID、CPU、内存 | `/api/service/process` |
| 系统日志 | 在线看日志尾部，可切换运行/错误/访问日志，可自动刷新 | `/api/console/logs` |
| 关于本机 | 版本、服务器标识、Node/Electron、硬件环境、开源许可 | `/api/console/overview` |

顶栏支持全局搜索菜单（按 `/` 聚焦）、系统通知、用户菜单；窄屏自动折叠为抽屉式侧边栏。

### 控制台专用接口

| 接口 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/console/bootstrap` | 无 | 产品名与版本号，供登录页显示 |
| `GET /api/console/overview` | 登录用户 | 设备信息 + 硬件指标（非管理员只返回设备信息） |
| `GET /api/console/logs?file=combined&lines=300` | 管理员 | 日志尾部；文件名白名单（combined/error/access），最多读 1MB / 1000 行 |

### 访问与安全

- 令牌走 `Authorization: Bearer <token>`（`localStorage` 持久化），过期时用 `refreshToken` 自动续期，续期失败才回登录页
- `/` 与 SPA 回退响应带严格 CSP（`default-src 'self'`、无 `unsafe-inline` 脚本）、`X-Frame-Options`、`nosniff`；HTML 一律 `no-cache`，升级后刷新即生效
- 登录失败计数与 IP 拉黑由既有安全模块负责，控制台不另造一套
- 只想提供 API 不开放页面：`NASCAB_CONSOLE_ENABLED=false`，此时 `/` 返回 404，探针与 `/api/*` 不受影响

---

## 仓库结构与上游同步

本仓库是从上游 [nascab/NasCabOS](https://github.com/nascab/NasCabOS) fork 出来的**独立仓库**，服务端改造都在 `main` 分支上。

| 引用 | 含义 |
|---|---|
| `main` | 改造后的代码，当前分支 |
| `upstream-v1.2.5` | 上游基线标签（commit `77cdb9b`），改造的起点 |
| `upstream/main` | 上游 main 的跟踪引用，`main` 默认跟踪它 |

远程只有一个 `upstream`，指向 GitHub 镜像（本机直连 GitHub 不稳定）：

```bash
git remote -v
# upstream  https://githubfast.com/nascab/NasCabOS.git
```

**推自己的仓库**：先加远程再推，`upstream` 不会被影响。

```bash
git remote add origin <你的仓库地址>
git push -u origin main
```

**拉上游更新**：与上游有共同祖先，可以直接三方合并，冲突通常只落在改造过的那十几个文件里。

```bash
git fetch upstream
git log --oneline upstream-v1.2.5..upstream/main   # 上游做了什么
git merge upstream/main
```

### 关于稀疏检出

工作区是**稀疏检出**（`core.sparseCheckout=true`），只保留后端源码、部署产物和客户端源码，
上游仓库里约 600MB 的二进制（Flutter/Android/HarmonyOS 构建产物等）不在本地。
规则写在 `.git/info/sparse-checkout`，改完后执行一次 `git sparse-checkout reapply` 生效。

由此有两点要注意：

- **推送会触发回填**。对象库里没有那些二进制的 blob，`git push` 时 git 会按需从 `upstream`
  回填，等于把整个 665MB 的 monorepo 传一遍，本机网络下要跑很久。只关心服务端的话，
  更省事的做法是另建一个只含 `electron_server/` + `deploy/` 的精简仓库。
- **别跑 `git gc` / `git sparse-checkout disable`**。前者要遍历全部对象，后者会把 600MB
  全部检出到本地，都会触发同样的回填。

---

## 快速开始

```bash
# 1. 准备代码（electron_server 目录）与依赖
cd electron_server
npm ci --omit=dev          # 生产依赖，不含 electron

# 2. 准备外部二进制（ffmpeg/ffprobe/rclone/sftpgo/transmission/openlist）
#    从 https://github.com/nascab/NasCabOS/releases 下载对应平台的 libs-*.zip，
#    解压到 electron_server/libs（或用 NASCAB_LIBS_DIR 指向别处）

# 3. 启动
cp deploy/config.example.json config.json   # 按需修改
node src/main_nascab_os.js
```

**运行时要求：Node 22 LTS。**

> 为什么必须是 22：Electron 37 内置 Node 22，`nodejieba` 等原生模块只发布了该 ABI 的预编译二进制。用 Node 24 会回退到源码编译，Windows 上因缺少 VS 生成工具而直接失败（实测：`npm ci` 在 nodejieba 处报 gyp 错误）。Linux 上能编译成功但不必要地拉长了构建时间。

---

## 配置系统

三级取值，后者覆盖前者：

```
内置默认值  <  config.json  <  环境变量
```

### 配置文件搜索顺序

| 顺序 | 位置 | 说明 |
|---|---|---|
| 1 | `$NASCAB_CONFIG` | 显式指定，最高优先 |
| 2 | `<应用根目录>/config.json` | 推荐，随代码一起分发 |
| 3 | `<当前工作目录>/config.json` | 便于临时测试 |
| 4 | `<用户数据目录>/config.json` | 按实例覆盖 |

> 第 4 级中的 `data.dir` **不生效**——数据目录由它自身推导，改了会造成循环依赖。需要改数据目录请用第 2/3 级或 `NASCAB_DATA_DIR`。

JSON 里以 `_` 开头的键会被忽略，可以直接写注释（见 `config.example.json`）。配置文件损坏时打警告并回落到默认值，**不会阻断启动**。

### 配置项总览

| 配置 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `server.host` | `NASCAB_HOST` | `0.0.0.0` | 监听地址；仅本机/反代可设 `127.0.0.1` |
| `server.port` | `PORT` | `6789` | HTTP 端口 |
| `server.httpsPort` | `HTTPS_PORT` | `6799` | HTTPS 端口 |
| `server.httpsEnabled` | `NASCAB_HTTPS_ENABLED` | `true` | 反接场景可关闭 |
| `server.portFallback` | `NASCAB_PORT_FALLBACK` | `true` | 端口占用是否顺延；**服务器建议 false** |
| `server.behindProxy` | `NASCAB_BEHIND_PROXY` | `false` | 信任 `X-Forwarded-*` |
| `data.dir` | `NASCAB_DATA_DIR` | 自动推导 | 数据目录（DB/缓存/证书/锁） |
| `libs.dir` | `NASCAB_LIBS_DIR` | `<root>/libs` | 外部二进制根目录 |
| `onnx.dir` | `NASCAB_ONNX_DIR` | `<root>/onnx_models` | AI 模型目录 |
| `logging.level` | `LOG_LEVEL` | `info` | 日志级别 |
| `logging.dir` | `NASCAB_LOG_DIR` | `<root>/logs` | 日志目录（不可写自动回退数据目录） |
| `logging.file` | `NASCAB_LOG_FILE` | `true` | 是否写文件 |
| `logging.accessLog` | `NASCAB_ACCESS_LOG` | `false` | HTTP 访问日志（单独 `access.log`） |
| `logging.rotate.maxSize` | `NASCAB_LOG_MAX_SIZE` | `20971520` | 单文件上限 20MB |
| `logging.rotate.maxFiles` | `NASCAB_LOG_MAX_FILES` | `10` | 保留份数 |
| `security.corsOrigins` | `NASCAB_CORS_ORIGINS` | `[]` | CORS 白名单，空=仅同源+本机+`file://` |
| `security.jwtSecret` | `JWT_SECRET` | 空 | JWT 密钥，生产建议显式设置 |
| `worker.autoRestart` | `NASCAB_WORKER_AUTO_RESTART` | `true` | worker 崩溃自动重启 |
| `worker.maxRestarts` | `NASCAB_WORKER_MAX_RESTARTS` | `10` | 单 worker 重启上限 |
| `console.enabled` | `NASCAB_CONSOLE_ENABLED` | `true` | 是否启用 Web 控制台（挂在 `/`） |
| `console.title` | `NASCAB_CONSOLE_TITLE` | `NasCabOS` | 登录页/顶栏/浏览器标题显示的产品名 |
| `console.dir` | `NASCAB_CONSOLE_DIR` | `<root>/web/console` | 控制台静态资源目录 |

另有三个非 `console.*` 的运行开关：

| 环境变量 | 作用 |
|---|---|
| `NASCAB_IS_DOCKER=1` | 让 ffmpeg/ffprobe 使用系统命令、数据目录落到 `/nascabos_data`（Docker 镜像已内置） |
| `NASCAB_ADMIN_USER` + `NASCAB_ADMIN_PASSWORD` | 首次启动时用这对账号创建超级管理员，省得去日志里翻随机账号。两者必须同时设置；用户名 3-20 位字母数字下划线、密码至少 6 位。已存在超管时无效 |
| `NASCAB_CONFIG` | 显式指定配置文件路径 |

### 服务器部署推荐配置

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 6789,
    "httpsEnabled": false,
    "portFallback": false,
    "behindProxy": true
  },
  "logging": {
    "level": "info",
    "dir": "/var/log/nascabos",
    "accessLog": true,
    "rotate": { "maxSize": 20971520, "maxFiles": 10 }
  },
  "security": {
    "jwtSecret": "请换成随机长字符串"
  },
  "worker": { "autoRestart": true, "maxRestarts": 10 }
}
```

---

## 部署方式

### 1. systemd（Linux 裸机，推荐）

```bash
sudo useradd -r -m -d /var/lib/nascabos -s /usr/sbin/nologin nascab
sudo mkdir -p /opt/nascab/app /var/log/nascabos
# 部署代码与 libs 到 /opt/nascab/app，并修正属主
sudo chown -R nascab:nascab /opt/nascab /var/log/nascabos

sudo cp deploy/systemd/nascabos.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nascabos

journalctl -u nascabos -f          # 看日志
systemctl status nascabos
```

单元文件已内置：`Restart=always`、`TimeoutStopSec=60`（留给 transmission 收尾）、`LimitNOFILE=65535`、以及一组 systemd 沙箱选项。按机器修改 `User`、路径与资源限制。

### 2. Docker / docker-compose

```bash
# 从仓库根目录执行（构建上下文是 electron_server）
docker compose -f deploy/docker/docker-compose.yml up -d --build
docker compose -f deploy/docker/docker-compose.yml logs -f
```

镜像要点：

- 基础 `node:22-bookworm-slim`，apt 安装 ffmpeg/ffprobe/transmission/rclone
- `npm pkg delete scripts.postinstall` 后再 `npm ci --omit=dev` —— 原生 postinstall 是 `@electron/rebuild`，只为桌面端 Electron 编译；无界面模式需要面向 Node ABI 的二进制
- 非 root 用户运行，数据卷 `/nascabos_data`
- 内置 `/healthz` 健康检查，`STOPSIGNAL SIGTERM` + `stop_grace_period: 60s`

挂载媒体库：编辑 compose 文件的 `volumes`，把宿主机媒体/下载目录映射进容器，再在 NasCabOS 界面里添加对应路径。

### 3. Windows 服务

```powershell
# 管理员 PowerShell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1 -InstallDir C:\NasCabOS
```

脚本会自动下载 [WinSW](https://github.com/winsw/winsw/releases)、生成服务配置、注册失败重启策略并启动服务。卸载加 `-Uninstall`。

**Windows 优雅停止**：Node 在 Windows 上收不到 `SIGTERM`，只能靠 `CTRL_BREAK`（应用已额外监听 `SIGBREAK`）。WinSW 作为独立的 .NET 服务宿主发送 `CTRL_BREAK`，不会打断自己；裸机脚本则不能这么做——`GenerateConsoleCtrlEvent` 组 ID 传 0 会连带打断调用方（PowerShell 5.1 收到 CTRL_BREAK 会直接进入调试器），传目标 PID 又要求目标以 `CREATE_NEW_PROCESS_GROUP` 启动，`Start-Process` 无法指定。所以：

- `deploy\scripts\start.ps1` 的 Stop 直接结束进程，**会留下残留锁**；但下次启动会检测到「持有者已死」并自动接管（已实测），不会卡住。
- 需要优雅关停请用服务方式（`install-service.ps1`，WinSW `stopsignal=ctrl-break`，best-effort）。
- Linux/macOS 的 `start.sh` 用 `SIGTERM`，走完整 `gracefulShutdown`（停 worker → 释放锁）。

### 4. 裸机脚本（快速验证）

```bash
NASCAB_APP_DIR=/opt/nascab/app bash deploy/scripts/start.sh start|stop|restart|status
```

Windows 对应 `deploy\scripts\start.ps1 -Action Start|Stop|Restart|Status`。适合验证，长期运行请用服务方式。

---

## 健康检查与探针

| 端点 | 鉴权 | 语义 | 用途 |
|---|---|---|---|
| `/health` | 无 | 存活 | 兼容原有路径 |
| `/healthz` | 无 | 存活 | livenessProbe / Docker HEALTHCHECK |
| `/readyz` | 无 | 就绪（含 DB 连通检查） | readinessProbe / 摘流 |

`/readyz` 返回示例：

```json
{ "success": true, "checks": { "uptime": 38, "memoryMb": 98, "db": "ok" } }
```

数据库不可用时返回 **503**，可直接作为「服务未就绪、暂不接流量」的信号。

---

## 反向代理

服务端本身带自签证书（`<数据目录>/certs`），也可放入 `key_custom.pem` / `cert_custom.pem` 覆盖。生产更推荐由代理终止 TLS：

```nginx
server {
    listen 443 ssl http2;
    server_name nas.example.com;

    ssl_certificate     /etc/ssl/nas.example.com.crt;
    ssl_certificate_key /etc/ssl/nas.example.com.key;

    # 大文件与视频流：关闭缓冲与请求体限制
    client_max_body_size 0;
    proxy_request_buffering off;
    proxy_buffering off;

    location / {
        proxy_pass http://127.0.0.1:6789;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket（文件监听 / 编辑器 / 终端）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

服务端配置需相应打开：

```json
{ "server": { "httpsEnabled": false, "behindProxy": true } }
```

`behindProxy=true` 后 `req.ip` 才会取到真实客户端 IP（IP 防爆破、访问日志才能正确记录）。

---

## 运维手册

### 日志

| 文件 | 内容 |
|---|---|
| `<日志目录>/combined.log` | 全部业务日志 |
| `<日志目录>/error.log` | 仅 error |
| `<日志目录>/access.log` | HTTP 访问日志（需 `logging.accessLog=true`） |
| `<日志目录>/stdout.log` | 裸机脚本启动时的标准输出 |

按 `logging.rotate.maxSize` 轮转，保留 `maxFiles` 份。日志目录不可写时自动回退到 `<数据目录>/logs` 并打印提示。

### 常见问题

| 现象 | 原因与处理 |
|---|---|
| 启动即退出，提示「检测到另一个实例」 | 同数据目录已有实例在跑。确认无需并行后停止该进程，或删除锁文件 `<数据目录>/nascabos.lock` |
| 改了 `PORT` 不生效 | 数据库里持久化了旧端口。**显式**通过环境变量/配置文件指定的端口优先于 DB（已修复）；若走 DB 值，需在界面里改 |
| 端口冲突服务就换了个端口 | 旧行为会静默顺延。设 `server.portFallback=false` 改为快速失败 |
| 强杀后起不来 | 锁文件残留。下次启动会自动接管（持有者已死）；也可手动删除 |
| worker 反复重启 | 看是否稳定运行超 60s；超时会重置重启预算。若持续崩溃，日志里有 `已达上限` 告警 |
| `nodejieba` 编译失败 | Node 版本不是 22。换 Node 22 LTS |
| 硬件转码探测失败 | libs 缺失时自动降级 CPU 转码，不影响启动 |

### 升级

1. 备份数据目录（数据库 + 缓存）：`systemctl stop nascabos && cp -a /var/lib/nascabos /var/lib/nascabos.bak`
2. 更新代码，`npm ci --omit=dev`
3. `systemctl start nascabos`

数据库采用「启动时幂等建表 + `ALTER TABLE ADD COLUMN` 补列」，升级通常无需手工迁移。

---

## 已知平台差异

| 平台 | 差异 |
|---|---|
| Windows | `SIGTERM` 不可用。服务路径靠 WinSW 发 `CTRL_BREAK`（best-effort）；裸机脚本只能直接结束进程，锁残留由自动接管兜底 |
| Windows | Node 必须是 22 LTS（原生模块无 Node 24 预编译包） |
| Windows | PowerShell 5.1 读取 `.ps1` 需 UTF-8 BOM，否则中文按 GBK 解码成乱码、破坏字符串解析（本仓库脚本均已带 BOM） |
| macOS | 打包后根目录多一层 `Contents`，已由 `getRootPath()` 处理 |
| Linux/arm64 | libs 需下载对应 arm64 包；sftpgo/openlist 等在 arm64 下需确认 release 提供 |

---

## 改造清单

源码改造（相对上游基线 `upstream-v1.2.5`，共 4 次提交）：

| 文件 | 改造 |
|---|---|
| `src/config/deployConfig.js` | **新增**。配置文件 + 环境变量合并层，`isExplicit()` 区分显式指定与默认值 |
| `src/config/config.js` | 接入配置层；新增 `server/security/worker/libs/onnx` 配置段与 `getLibsPath()`/`getOnnxModelsPath()`；userData 支持 `data.dir`；启动时打印生效配置 |
| `src/workers/expressWorker.js` | 显式绑定 `host`；HTTPS 可关闭；端口占用时按 `portFallback` 快速失败；监听 `SIGBREAK` |
| `src/api/app.js` | CORS 改为白名单（默认仅同源+本机+`file://`，原为反射任意源）；新增 `/healthz` `/readyz`；访问日志可配；反代信任可配 |
| `src/utils/logger.js` | 日志轮转可配（原 `maxFiles:1` 等于不轮转）；日志目录可配且不可写时回退；独立 `access.log` |
| `src/workers/singletonWorkerManager.js` | **worker 崩溃自动重启**（`restartWorker` 原先已实现但全仓无人调用）：指数退避 1s→30s、次数上限、正常运行超 60s 重置预算、正常退出不重启 |
| `src/initHandler/workers.js` | express worker 崩溃自动重启（此前崩溃即 API 离线）；`beginShutdown()` 关停期禁止重启 |
| `src/main_nascab_os.js` | 无界面模式单例锁；全局异常兜底；统一关停流程（含 `beginShutdown` 与锁释放）；监听 `SIGBREAK` |
| `src/utils/singletonLock.js` | **新增**。排他锁文件，冲突时报出持有者 PID，残留锁自动接管 |
| `src/utils/runtimeFlags.js` | **新增**。`NASCAB_IS_DOCKER` 运行时开关，替代只能改 `package.json` |
| `src/utils/appUtil.js` | 显式指定的端口优先于数据库持久化值 |
| `src/initHandler/initMain.js` | 端口漂移受 `portFallback` 控制，禁止漂移时明确报错 |
| `src/utils/remoteAssetsManager.js`、`src/libsPath/*` | libs / onnx 根目录可配置 |
| `src/config/deployConfig.js`、`src/config/config.js` | 新增 `console` 配置段（开关/产品名/目录）；**修复 `NODE_ENV` 未设置时被当成开发环境而关掉文件日志、级别降为 debug**——服务器长期排障会因此完全没有日志 |
| `src/initHandler/initialSuperAdmin.js` | 首管理员支持 `NASCAB_ADMIN_USER`/`NASCAB_ADMIN_PASSWORD`；创建成功立即打印醒目横幅（含控制台地址），不再等 10 秒 |
| `src/api/modules/auth/authRouter.js` | 启用 `POST /createSuperAdmin`，加「系统中没有超管才可用」守卫（否则 403），支撑首次部署向导 |
| `src/api/modules/auth/authService.js` | **修复 `getUserProfile` 选了不存在的 `role`/`updated_at` 列**，`/api/auth/profile` 原先对所有客户端返回 400 |
| `src/api/modules/console/*` | **新增**。`/bootstrap`、`/overview`、`/logs` 三个控制台专用接口 |
| `src/api/app.js` | `/` 改挂自带 Web 控制台（原指向不入库的 `web/main`）；基础安全响应头 + 控制台 CSP；SPA 回退（不吞 `/api` 404） |
| `web/console/` | **新增**。无构建步骤的 Web 控制台：登录/初始化向导、概览、存储、用户、网络、安全、应用、进程、日志、关于共 10 个页面 |

部署产物：`deploy/config.example.json`、`deploy/systemd/`、`deploy/docker/`、`deploy/windows/`、`deploy/scripts/`。

### 已验证项

以下均在本机实测通过（Node 22.20.0，无界面模式）：

- 配置三级优先级（默认 < 配置文件 < 环境变量），33 项断言
- `/health` `/healthz` `/readyz` 探针，DB 不可用时 `/readyz` 返回 503
- CORS 白名单：第三方源不放行、本机源放行
- HTTPS 关闭后不再监听 6799
- 单例锁：同数据目录二次启动被拒（退出码 1，报出持有者 PID）
- 残留锁自动接管（强杀后可再启动）
- worker 崩溃自动重启；正常退出不重启（消除重启循环）
- 显式 `PORT` 压过数据库旧端口值
- 端口冲突 + `portFallback=false` 快速失败（退出码 1 + 明确错误）
- libs 缺失时硬件转码探测降级 CPU，不影响启动
- `deploy/scripts/start.sh` 的 start/stop/status/重复启动保护
- `deploy/scripts/start.ps1` 的 Start/Status/Stop 全生命周期，以及强杀后带残留锁重启自动接管
- 两个 `.ps1` 脚本均通过 PowerShell 5.1 语法解析（文件带 UTF-8 BOM）

### Web 控制台（本轮新增）

以下在本机实测通过（Node 22.20.0，无界面模式，真实启动的服务端 + jsdom 渲染验证，共 38 项接口断言 + 29 项渲染断言 + 13 项初始化向导断言）：

- `GET /` 返回控制台，`console.css`/`console.js` 正常加载；HTML 带 `no-cache` 与 CSP、`nosniff`、`SAMEORIGIN`，`X-Powered-By` 已移除
- SPA 回退：`/storage`、`/users`、`/about` 均返回 `index.html`；`/api/__not_exist__` 仍为 404；带扩展名的 `/nope.js` 仍为 404
- 登录后概览、存储、用户、网络、安全、应用、进程、日志、关于 9 个页面全部渲染出真实数据（CPU/内存/温度、磁盘挂载点、账号列表、进程列表、300 行日志等）
- 首次部署向导：未初始化时自动显示；前端校验用户名格式、密码长度、两次一致性；提交后创建超管并自动进入控制台；已有超管后再次创建返回 403
- `NASCAB_CONSOLE_TITLE` 改变登录页/顶栏/浏览器标题；`NASCAB_ADMIN_USER`/`NASCAB_ADMIN_PASSWORD` 按指定账号建号并能直接登录
- 非法环境变量（如密码不足 6 位）只告警并回退随机账号，不阻断启动
- `NASCAB_CONSOLE_ENABLED=false` 时 `/` 与 SPA 回退返回 404，`/healthz` 与 `/api/*` 不受影响
- 文件日志修复后 `combined.log`/`error.log` 正常生成，`/api/console/logs` 能读到日志尾部
- `/api/auth/profile` 修复后返回完整用户信息（此前因选了不存在的列而 400）
- 无 token 访问控制台接口 401、伪造 token 401；第三方 Origin 不被 CORS 放行、本机 Origin 放行
