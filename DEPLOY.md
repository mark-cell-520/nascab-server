# NasCabOS 服务端部署指南

本目录（`deploy/`）与源码中的改造一起，把 NasCabOS 从「桌面 NAS 应用」变成「可长期运行的服务」。核心思路：**所有环境差异都通过配置注入，不改代码**。

> 改造内容见文末「改造清单」，相对上游的修改声明见 [MODIFICATIONS.md](MODIFICATIONS.md)，仓库结构与上游同步见「仓库结构与上游同步」。

---

## 目录

- [快速开始](#快速开始)
- [Web 控制台](#web-控制台)
- [机器控制接口](#机器控制接口api-control)
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

### 主题（浅色 / 暗色）

控制台支持暗色主题，三处入口等价：顶栏用户菜单的「暗色模式」、登录页页脚的主题按钮、快捷键 `Shift+D`。

- 选择优先级：**用户手动选过**（`localStorage`）> 系统 `prefers-color-scheme`
- 没有显式选择时跟随系统，系统在深浅之间切换会实时生效
- 实现上 `console.js` 启动时把解析结果写到 `<html data-theme="light|dark">`，CSS 只认这一个属性，
  所以暗色令牌只需声明一份，组件规则两边共用，不存在「两套样式各自漂移」的问题
- `console.css` 里所有颜色都走 CSS 自定义属性；新增组件时请沿用变量，不要写死十六进制色值，
  否则暗色下会漏出亮色块

### 前端渲染与内存

控制台要一直开着，轮询里的每一分浪费都会累加成风扇噪音和电量：

| 项 | 做法 |
|---|---|
| 概览页 3 秒轮询 | 指标卡骨架只建一次，之后只改文本、进度条宽度与迷你图柱高，**不重建 DOM** |
| 存储池表格 | 按数据指纹判断，容量没变就整表跳过（磁盘是分钟级变化的量） |
| 设备信息 / 服务状态 | 定义列表建一次骨架，之后只更新 `<dd>` 文本 |
| 日志查看器 5 秒轮询 | 日志文本没变就直接返回；且只在用户本来就在底部时才跟随滚动，往上翻看历史不会被拽走 |
| 趋势数据 | `state.history` 固定上限 24 个采样点，不会无限增长 |

### 媒体：音乐播放与影视清晰度

控制台自带「音乐」与「影视」两个页面（`web/console/pages-media.js`，同样是纯静态无依赖）。

**音乐**：左侧库导航（全部歌曲 / 专辑 / 艺人 / 最近播放 / 我的收藏）加歌单列表；主区曲目表；
底部是**常驻播放器栏**，切页面不中断。播放器带播放队列抽屉（可上移/下移/移除/点选）、
顺序/随机/单曲三种模式、进度拖动、音量、LRC 歌词逐行高亮。
播放队列存在 `localStorage`，刷新页面不丢。

歌单本身做了两处修漏：`play_list2index` 增加 `position` 列（老库自动补列并按加入顺序回填），
并新增 `playlist/index/reorder`、`playlist/index/move`、`playlist/index/clear` 三个接口；
`/api/music/list` 带 `list_id` 时改为按 `position` 排序——改造前走的是 `m.id desc`，
用户排的顺序根本不会生效。`playlist/get` 现在也返回曲目列表。

**影视**：海报墙（搜索 / 类型 / 排序 / 分页）+ 详情弹层（评分、时长、分辨率、演员、简介、续播进度、分集列表）。
剧集在详情弹层里直接列出分集，点某一集即播；播放中可上一集/下一集，播完自动连播（5 秒倒计时可取消）。
播放器是全屏舞台，提供四组可选能力：

| 能力 | 做法 |
|---|---|
| 清晰度 | `原画 / 1080P / 720P / 480P / 360P` 五档，档位表由 `GET /api/videoPlayer/qualities` 按源分辨率算出——源只有 720p 时 1080p 一档会被禁用并标注「高于源分辨率，不推荐」，放大不会更清晰只会浪费带宽。切清晰度从当前播放位置接着播，不从头开始 |
| 字幕 | 内嵌字幕轨与外挂字幕（同目录 + 用户上传过的）合成一份菜单，走 `<track>` + `/subtitle-vtt` 出 WebVTT——切换即时、不用重连流、原画路径也不被破坏。可选字号/位置/颜色/背景/描边与 ±10s 延时。图像字幕（PGS/VOBSUB）在菜单里禁用并说明原因，不给「选了没反应」的死选项。另支持上传字幕与在线搜索（迅雷字幕服务） |
| 音轨 | 多音轨（国语/英语/导演评论）列出语言 + 编码 + 声道数，切换时服务端按 `audioMapIndex` 重封装并从当前位置续上 |
| 倍速与播放行为 | 0.5x–3x 八档；「自动跳过片头」「自动连播下一集」两个开关。片头片尾区间来自 `video_index.open_skip_*_sec`，播放中浮出「跳过片头」按钮 |

播放器另有缓冲进度条、起播/缓冲加载态、音量与静音、全屏、画中画，
以及一套完整快捷键：`空格`/`K` 播放暂停、`←`/`→` ±10s、`J`/`L` ±30s、`↑`/`↓` 音量、
`0`–`9` 跳百分比、`M` 静音、`F` 全屏、`P` 画中画、`C` 字幕、`A` 音轨、`S` 倍速、`N` 下一集、`,`/`.` 字幕延时、`Esc` 退出。
断点续播每 10 秒落一次库，关掉页面也不丢。

上游的转码接口只接受 `width` / `resolution` / `bitrate` 三个裸参数，其中 `resolution` 还只认
`1920x1080` 这种 WxH 写法——传 `"1080p"` 会被 `parseResolution` 静默忽略，结果是「选了清晰度但没有任何变化」。
新增 `src/utils/videoQualityUtil.js` 把档位收敳成一份 canonical 定义（档位 key → 宽/高/码率/maxrate/bufsize），
`/transcode` 与 `/stream-mp4` 都从这儿取参数，前端也只认档位 key。显式传 `width`/`bitrate` 的老调用方行为不变。
清晰度、字幕、音轨、倍速四类偏好都写进 `video_play_preference`，下次打开同一部影片自动恢复。

服务端这边：`collectSystemInfo()` 的静态部分（`package.json`、CPU 型号、核心数）按进程缓存——
其中 `os.cpus()` 在 Windows 上每次调用都会重新构造一份「每个逻辑核一个对象」的数组，
概览页每 3 秒调一次，不缓存就是每分钟制造一整套纯垃圾。

### 控制台专用接口

| 接口 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/console/bootstrap` | 无 | 产品名与版本号，供登录页显示 |
| `GET /api/console/overview` | 登录用户 | 设备信息 + 硬件指标（非管理员只返回设备信息） |
| `GET /api/console/logs?file=combined&lines=300` | 管理员 | 日志尾部；文件名白名单（combined/error/access），最多读 1MB / 1000 行 |

### 媒体相关接口（控制台「音乐」「影视」页用到）

| 接口 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/videoPlayer/qualities?filePath=...` | 登录用户 + 文件 view/download 权限 | 可选清晰度档位表 + 源分辨率 + 用户上次选择（清晰度/字幕/音轨/倍速） |
| `GET /api/videoPlayer/tracks?filePath=...` | 同上 | 可选音轨与字幕轨清单（含内嵌/外挂、语言、编码、可否走 WebVTT）+ 片头片尾区间 |
| `GET /api/videoPlayer/transcode?...&quality=720p` | 同上 | HLS 转码；`quality` 为档位 key，`original` 会 400 指引走原画直链 |
| `GET /api/videoPlayer/stream-mp4?...&quality=480p&audioMapIndex=1` | 同上 | fMP4 流；带缩放参数时自动重编码；`audioMapIndex` 选音轨 |
| `GET /api/videoPlayer/subtitle-vtt?filePath=...&subtitleIndex=3` | 同上 | 内嵌字幕轨导成 WebVTT（带缓存）；`subtitlePath=` 则直接转外挂文件 |
| `POST /api/videoPlayer/uploadSubtitle` | 同上 | 上传外挂字幕到 `subtitleUpload/<视频 hash>/<uid>/` |
| `POST /api/videoPlayer/searchSubtitle` | 同上 | 迅雷字幕搜索（`searchType=keyword` 或按影片特征） |
| `POST /api/videoPlayer/downloadSearchedSubtitle` | 同上 | 把搜到的字幕下载到上传目录 |
| `POST /api/videoPlayer/deleteExternalSubtitle` | 同上 | 删除自己上传的字幕 |
| `POST /api/videoPlayer/preference` | 同上 | 续播位置 + 清晰度/字幕/音轨/倍速偏好 |
| `POST /api/music/playlist/index/reorder` | 登录用户 | 整体重排，`index_ids` 为完整顺序（可为子集） |
| `POST /api/music/playlist/index/move` | 登录用户 | 单曲移到 `to_position`（0 基，越界夹紧） |
| `POST /api/music/playlist/index/clear` | 登录用户 | 清空歌单曲目，不动歌单本身 |
| `POST /api/music/playlist/get` | 登录用户 | 歌单元信息 + 曲目列表（按 `position`） |
| `GET /api/music/cover?file_path=...&size=300` | 登录用户 | 内嵌封面（`has_inner_cover=1` 才有） |
| `GET /api/music/transcode?path=...` | 登录用户 + 文件权限 | 192k MP3 兜底（浏览器解不了的格式），支持 Range |

> 媒体地址都要带 `accessToken` 查询参数（`<audio>`/`<video>` 的 `src` 发不出 `Authorization` 头），
> 服务端 `extractTokenFromRequest` 认这个参数。文件管理器的缩略图与下载一直是这么做的。

### 访问与安全

- 令牌走 `Authorization: Bearer <token>`（`localStorage` 持久化），过期时用 `refreshToken` 自动续期，续期失败才回登录页
- `/` 与 SPA 回退响应带严格 CSP（`default-src 'self'`、无 `unsafe-inline` 脚本）、`X-Frame-Options`、`nosniff`；HTML 一律 `no-cache`，升级后刷新即生效
- 登录失败计数与 IP 拉黑由既有安全模块负责，控制台不另造一套
- 只想提供 API 不开放页面：`NASCAB_CONSOLE_ENABLED=false`，此时 `/` 返回 404，探针与 `/api/*` 不受影响

---

## 机器控制接口（/api/control）

Web 控制台是给人点的，这一节是给**脚本和 AI Agent** 用的。

一个长期令牌换全部管理能力：查状态、看日志、管共享目录、浏览/上传/下载/新建/重命名/删除文件、管理下载任务与 Docker 容器。不需要先登录拿 JWT，也不需要cookie。

### 两个入口

| 入口 | 地址 | 用途 |
|---|---|---|
| 主端口 | `http://<IP>:6789/api/control` | 和业务 API 同端口，便于反向代理统一暴露 |
| 独立端口 | `http://127.0.0.1:6792/api/control` | 默认只绑本机回环，给本机脚本用，可以单独做防火墙策略 |

独立端口可以用 `control.port=0` 关掉（只保留主端口入口），用 `control.enabled=false` 把整个控制面关掉。

### 令牌

| 情况 | 行为 |
|---|---|
| 设了 `NASCAB_CONTROL_TOKEN`（或 `control.token`） | 用这个值，轮换令牌只改环境变量 |
| 没设 | 首次启动自动生成 `ncctl_<48 位十六进制>`，写入 `<数据目录>/control.json`，**重启后复用** |

启动日志会打印一段醒目横幅，含地址、令牌与用法。`control.json` 形如：

```json
{ "token": "ncctl_...", "source": "generated", "host": "127.0.0.1", "port": 6792, "createdAt": "..." }
```

> 自动生成的令牌用 `O_EXCL` 竞争创建文件，保证 cluster 下多个 express worker 拿到的是**同一个**令牌——
> 否则同一份配置在主端口上会时好时坏。

### 配置项

| 配置项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `control.enabled` | `NASCAB_CONTROL_ENABLED` | `true` | 关掉后控制接口与独立端口都不监听 |
| `control.host` | `NASCAB_CONTROL_HOST` | `127.0.0.1` | 独立监听地址，默认只绑本机 |
| `control.port` | `NASCAB_CONTROL_PORT` | `6792` | 独立端口，`0` 表示不单独监听 |
| `control.token` | `NASCAB_CONTROL_TOKEN` | 空 | 留空则自动生成并落盘 |

### 快速试用

```bash
# 探活（不需要令牌）
curl http://127.0.0.1:6792/api/control/ping

# 从 control.json 取令牌
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/control.json','utf8')).token)")

# 总览：系统 / CPU / 内存 / 磁盘 / 共享目录
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:6792/api/control/status

# 列目录
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:6792/api/control/files?path=D%3A%5Cmedia"

# 上传（请求体就是文件字节）
curl -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/octet-stream" -H "X-Filename: movie.mkv" \
     --data-binary @movie.mkv \
     "http://127.0.0.1:6792/api/control/files/upload?path=D%3A%5Cmedia"
```

### 接口总览

响应统一为 `{ "ok": true, "data": ... }` / `{ "ok": false, "error": { "code", "message" } }`，
路径一律用服务端绝对路径。完整清单见 [接口参考](#)与 `electron_server/src/api/modules/control/`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ping` | 探活，无需令牌 |
| GET | `/info` | 部署信息 + 端点清单（不含令牌） |
| GET | `/status` | 系统信息 + 硬件指标 + 内存 + 磁盘 + 共享目录 |
| GET | `/logs` | 日志尾部（`file`、`lines`） |
| GET/POST | `/shares`、`/shares/remove` | 共享目录查询 / 添加 / 移除 |
| GET | `/files`、`/files/stat` | 列目录、文件详情 |
| GET | `/files/download` | 流式下载，支持 Range |
| POST | `/files/upload` | 上传，请求体为文件原始字节（流式落盘） |
| POST | `/files/mkdir`、`/files/rename`、`/files/delete` | 新建 / 重命名 / 删除（可批量） |
| GET/POST | `/downloads`、`/downloads/add`、`/downloads/action` | 下载器状态、添加任务、批量启停删除 |
| GET/POST | `/docker/status`、`/docker/containers`、`/docker/images`、`/docker/container` | 引擎状态、列表、启停 |

### 命令行客户端与 Claude 技能

仓库外附带一个零依赖的 Node 客户端 `nascabctl`，封装了上面全部接口：

```bash
nascabctl status                          # 总览
nascabctl ls "D:\media"                   # 列目录
nascabctl upload ./电影.mkv "D:\media"     # 上传
nascabctl download "D:\media\a.mkv" ./a.mkv
nascabctl logs -n 50                      # 看日志
nascabctl docker                          # 容器列表
nascabctl --json shares                   # 原始 JSON
```

连接信息按「命令行参数 > 环境变量 `NASCAB_URL`/`NASCAB_TOKEN` > `~/.nascabctl.json` > 自动发现 `control.json`」解析，
本机部署下通常零配置。

在 Claude Code 里它作为技能 `nascab` 安装，直接用自然语言即可驱动，例如「看一下 NAS 状态」「把这部电影传到 D:\media」。

### 安全须知

- 控制令牌**等价于管理员 root**，不要写进会提交的仓库、日志或聊天记录
- 独立端口默认只听 `127.0.0.1`，外部访问不到；远程使用请改 `control.host` 或走 SSH 隧道 / 反向代理 + IP 白名单
- 不需要机器控制面时直接 `NASCAB_CONTROL_ENABLED=false`
- 与 Web 控制台的分工：`/api/console` 走 JWT + 用户权限分级，`/api/control` 只有「有令牌/没令牌」——
  两者最终复用同一套服务端实现，不复制业务逻辑

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
| `worker.expressCount` | `NASCAB_EXPRESS_COUNT` | `0` | express API worker 进程数，`0` = 自动（省内存，默认 1 个） |
| `console.enabled` | `NASCAB_CONSOLE_ENABLED` | `true` | 是否启用 Web 控制台（挂在 `/`） |
| `console.title` | `NASCAB_CONSOLE_TITLE` | `NasCabOS` | 登录页/顶栏/浏览器标题显示的产品名 |
| `console.dir` | `NASCAB_CONSOLE_DIR` | `<root>/web/console` | 控制台静态资源目录 |
| `control.enabled` | `NASCAB_CONTROL_ENABLED` | `true` | 是否启用机器控制接口 `/api/control` |
| `control.host` | `NASCAB_CONTROL_HOST` | `127.0.0.1` | 控制接口独立监听地址，默认只绑本机 |
| `control.port` | `NASCAB_CONTROL_PORT` | `6792` | 控制接口独立端口，`0` = 不单独监听 |
| `control.token` | `NASCAB_CONTROL_TOKEN` | 空 | 控制令牌；留空自动生成并写入 `<数据目录>/control.json` |

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
  "worker": { "autoRestart": true, "maxRestarts": 10, "expressCount": 1 }
}
```

> `expressCount: 1` 是内存优先的选择。NasCab 的 API 负载以文件流（内核态搬运，不占 JS 线程）、
> SQLite 查询和缩略图转发放为主，不是 CPU 密集；多开 worker 买到的东西很有限，代价却是每个进程
> 一份完整的 express + 路由 + 中间件常驻内存。真要提高并发再往大调，上限为核心数。

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

源码改造（相对上游基线 `upstream-v1.2.5`，共 11 次提交，第 1 次为上游基线）：

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
| `web/console/pages-files.js`、`pages-nas.js` | **新增**。文件管理器（浏览/上传/下载/新建/重命名/删除/拖拽/缩略图）+ 挂载管理、分享管理、下载器、容器四页；页面模块化，`console.js` 只提供注册机制 |
| `src/utils/userShareFolderUtil.js` | **新增 `ensureDefaultShareFolder()`**：全新部署时共享目录列表是空的，文件管理器会无处可看；现首次启动自动建 `<数据目录>/files` |
| `src/initHandler/initMain.js` | 启动时创建上述默认共享目录并打印路径 |
| `src/config/deployConfig.js`、`src/config/config.js` | 新增 `control` 配置段（开关/监听地址/独立端口/令牌） |
| `src/utils/controlTokenUtil.js` | **新增**。控制令牌解析与落盘：显式令牌优先，否则首次启动自动生成并写入 `<数据目录>/control.json`（重启后复用）；用 `O_EXCL` 竞争创建，保证 cluster 下多个 worker 令牌一致 |
| `src/api/modules/control/*` | **新增**。机器控制接口 `/api/control`：`controlAuth`（Bearer / `X-NasCab-Token` / 查询串令牌，常数时间比较）、`controlDelegate`（构造带数据库句柄的超级管理员 req 复用既有控制器）、`controlController`（21 个端点）、`controlRouter` |
| `src/api/controlServer.js` | **新增**。控制接口独立监听（默认 `127.0.0.1:6792`），只挂控制路由与 `/healthz`，端口冲突不影响主服务 |
| `src/api/app.js` | 主端口挂载 `/api/control`；`control.enabled=false` 时不挂载 |
| `src/workers/expressWorker.js` | HTTP 就绪后启动控制接口独立监听，关停时一并关闭 |
| `src/api/modules/console/consoleController.js` | 导出 `collectSystemInfo`/`requestHwMetrics` 供控制接口复用（避免两处各写一份系统信息） |
| `deploy/config.example.json`、`deploy/docker/docker-compose.yml`、`deploy/windows/install-service.ps1` | 补充 `control.*` 配置项与 `NASCAB_CONTROL_*` 环境变量；compose 增加 6792 端口映射 |
| `src/utils/expressWorkerCount.js` | **新增**。express worker 进程数决策：显式配置 > 数据库旧值 > 自动（省内存，默认 1 个）。启动路径与设置接口共用一份，避免两边算出不同的数 |
| `src/initUtil.js`、`src/initHandler/initMain.js` | 接入上述决策，并打印「为什么是这个数」的可读理由 |
| `src/api/modules/others/apiSetting/apiSettingController.js` | 设置接口改用同一份决策；进程数下限从 2 放开到 1，返回自动/手动来源与上限 |
| `electron_server/language/*.json` | 「API 进程数量不能低于 2」改为「不能低于 1」，与新默认值一致 |
| `web/console/console.css` | **重写为设计令牌 + 暗色主题**：所有颜色走 CSS 自定义属性，暗色只覆盖 `[data-theme="dark"]` 一层；新增键盘焦点环、细滚动条、选中色、卡片悬浮层次、页面进入动画、弹层缩放、高对比偏好适配 |
| `web/console/console.js` | 主题系统（手动选择 > 系统偏好，`Shift+D` 快捷键）；概览指标卡/存储池/设备信息改为**就地更新**，不再每 3 秒整体重建 DOM；日志页内容未变则跳过重绘，且不再把正在往上翻的用户拽回底部 |
| `web/console/index.html` | `color-scheme` 支持深浅；用户菜单与登录页页脚各加一个主题入口 |
| `src/api/modules/console/consoleController.js` | `package.json`/CPU 型号/核心数按进程缓存——`os.cpus()` 在 Windows 上每次调用都重新构造整个数组，概览页 3 秒一次轮询，不缓存就是持续制造垃圾 |
| `src/api/controlServer.js` | 多 worker 抢控制端口时按 info 记录而非 error（不是故障，报了会让运维误判）。补充说明：cluster worker 的 `listen` 会经主进程共享句柄完成绑定，多个 express worker 实际是**共享**同一个控制端口，单个 worker 挂掉不影响控制接口 |
| `src/utils/videoQualityUtil.js` | **新增**。清晰度档位的唯一来源：档位 key → 宽/高/码率/maxrate/bufsize，`normalizeQualityKey` 兼容 `1080p`/`FHD`/`1920x1080`/`source` 等写法，`listQualities` 按源分辨率收窄档位（不放大），`resolveQuality` 出 ffmpeg 参数 |
| `src/utils/mediaTrackLabelUtil.js` | **新增**。音轨/字幕轨标签与可达性的唯一来源：ISO 639 语言码 → 中文名、字幕编码 → 中文名（含「PGS 图像字幕」）、声道数 → 5.1/立体声、`isTextSubtitleCodec` 判定能否转 WebVTT、倍速白名单归一 |
| `src/api/modules/videoPlayer/videoPlayerController.js` | `/transcode` 新增 `quality` 参数并映射到 resolution/bitrate/maxrate/bufsize；新增 `GET /qualities`（返回档位表与整份偏好）与 `GET /tracks`（音轨/字幕轨清单 + 片头片尾）；`/info` 附带档位表；`/stream-mp4` 支持 `width`/`bitrate`/`quality`/`audioMapIndex`（带缩放参数时自动从 `mode=copy` 退到重编码，避免「选了 720p 出来还是原画」）；`/preference` 持久化清晰度/字幕/音轨/倍速；`/subtitle-vtt` 文件不存在时返回 404 而非默认 500 |
| `src/workers/transcodeWorker.js` | 透出 `options.maxrate`/`options.bufsize` 到 `-maxrate`/`-bufsize`（只有 `-b:v` 时 x264 在复杂场景会冲到远超目标值，流式播放表现为带宽抖动） |
| `src/db/table/tableVideoPlayPreference.js` | 新增 `quality`、`subtitle_ref`、`audio_index`、`speed` 四列，老库逐列自动 `ADD COLUMN`（幂等） |
| `src/api/modules/videoPlayer/videoPlayerService.js` | 偏好读写带上四列，落库前归一化：清晰度过 `normalizeQualityKey`、字幕引用只认 `emb:<流号>`/`ext:<文件名>`、音轨序号带上限、倍速过白名单——脏值一律落空而不是把任意字符串存进库；新增 `getTrackInfo` 汇总音轨/字幕轨清单 |
| `src/db/table/tableMusicPlayList2Index.js` | **新增 `position` 列**（播放顺序），老库自动补列并按 `create_time` + `index_id` 回填；新增 `(list_id, position)` 索引 |
| `src/api/modules/music/playlist/playListService.js` | 加歌按调用方传入的顺序分配 position；新增 `reorderIndexes`（整体重排，提交子集时未提到的按原相对次序移到队尾）、`moveIndex`（单曲移到指定位置，越界夹紧）、`clearIndexes`（清空曲目）；`getList` 现在返回曲目列表；歌单预览图改按播放顺序取 |
| `src/api/modules/music/playlist/playListController.js`、`musicRouter.js` | 新增 `playlist/index/reorder`、`playlist/index/move`、`playlist/index/clear` 三个接口 |
| `src/api/modules/music/list/musicListService.js` | 带 `list_id` 时按 `pl.position` 排序——**改造前固定 `m.id desc`，用户在歌单里排的顺序完全不会生效** |
| `web/console/pages-media.js` | **新增**。音乐页（库导航/专辑/艺人/最近播放/收藏/歌单）+ 常驻播放器（队列抽屉、三种播放模式、进度与音量、LRC 歌词逐行高亮、队列持久化到 localStorage）+ 影视页（海报墙、详情弹层、续播进度、分集列表）+ 全屏播放器（清晰度选择、字幕菜单与外观调节、音轨切换、倍速、跳过片头、自动连播、画中画/全屏、缓冲进度、完整快捷键、断点续播） |
| `web/console/console.js`、`console.css`、`index.html` | 导航新增「媒体」分组（影视/音乐）；补足播放器栏、队列抽屉、歌词面板、海报墙、清晰度/字幕/音轨/倍速菜单、加载态、缓冲条、跳过片头、分集列表的样式（同样走设计令牌，暗色自动生效） |
| `electron_server/language/*.json` | 新增 `videoPlayer.QUALITY_ORIGINAL_USE_RAW`（原画不走转码，应改走原画直链） |

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

### 媒体播放（本轮新增）

以下在本机实测通过（Node 22.20.0，真实启动的服务端）：

- 清晰度档位表：`GET /api/videoPlayer/qualities` 返回 5 档、原画在最前；探针拿不到分辨率时全部档位仍可选、推荐退回 720p（不 500）；缺 `filePath` 与无 token 均被拒
- `/transcode?quality=720p` 返回 m3u8 且分片指向 `/api/videoPlayer/hls/<playId>/segment_000.ts`；`quality=original` 明确 400 指引走原画直链；无法识别的档位与不带 `quality` 的老调用方行为不变
- 清晰度偏好落库与读回；脏值（如「垃圾值」）不落库；别名 `source` 归一为 `original`
- 播放列表：`position` 从 1 连续递增且与加入顺序一致；整体重排、单曲移动（含越界夹紧）、提交子集时未提及项按原相对次序移到队尾、清空、增量加入排到末尾，全部实测
- **老库补列**：造一个没有 `position` 列的旧库，`createTable` 自动补列并按 `create_time`+`index_id` 回填
- `/api/music/list` 带 `list_id` 时按 `position` 返回，重排后接口顺序跟着变（改造前固定 `m.id desc`，排序无效）
- 事务内误用 `knex` 而非 `trx` 导致 SQLite 单连接池死锁——已修，测试可复现
- 页面渲染：音乐页库导航/歌单栏/播放全部、常驻播放器栏与队列抽屉创建、播放器控件齐全、队列从 `localStorage` 恢复、影视页筛选栏与海报网格，均无运行时错误
- 用无头 Chrome 实际截图核对浅色/暗色下的音乐页、影视页与播放器舞台（含清晰度菜单）

### 播放器功能增强（本轮新增）

以下在本机实测通过（Node 22.20.0，真实启动的服务端 + jsdom + 无头 Chrome）：

- `GET /api/videoPlayer/tracks` 返回 `audio`/`subtitles` 两个数组与 `openSkip`；探针失败时是空数组而不是 500；缺 `filePath` 与无 token 均被拒
- 四类偏好分别落库与读回；越界 `audio_index`（99）、白名单外 `speed`（9）、`subtitle_ref=off`、路径穿越写法的 `subtitle_ref` 全部落空，不会把脏值写进库
- 外挂 `subtitle_ref` 归一成文件名（`ext:/任意/路径/a.zh.srt` → `ext:a.zh.srt`）——绝对路径会随挂载点变动失效
- `video_play_preference` 老库（只有上游三列）自动补齐 `quality`/`subtitle_ref`/`audio_index`/`speed`，重复执行 `createTable` 幂等
- `/subtitle-vtt` 指向不存在的字幕文件时返回 404 而不是默认 500（播放器列出的外挂字幕可能已被删掉，这是常态）
- 标签映射：`chi`→国语、`hdmv_pgs_subtitle`→「PGS 图像字幕」、6 声道→5.1；`tags.title`（导演评论音轨）优先于语言码；无任何元数据时补序号，否则同一文件里几条字幕长得一模一样分不出来
- 文本字幕（subrip/ass/mov_text/webvtt）判为可转 WebVTT，图像字幕（pgs/vobsub/dvdsub）判为不可——菜单里禁用并说明原因，不给死选项
- 播放器 UI：四个菜单（清晰度/字幕/音轨/倍速）都能开合；字幕菜单带「关闭字幕」+ 上传/搜索/样式三个动作；倍速八档加「自动跳过片头」「自动连播下一集」两个开关；倍速写进 `video.playbackRate` 并持久化；音量写进 `video.volume`
- 快捷键全表无运行时错误；数字键 `5` 重连流的 `src` 带 `seek=3600`（7200 秒的 50%）
- 剧集：详情弹层列出分集，点某一集直接起播并把标题换成该集名字
- 用 CDP 驱动无头 Chrome 截图核对播放器各状态（播放器/字幕菜单/倍速菜单/清晰度菜单/音轨菜单），以及 780px 窄屏下顶栏自动收起文字标签只留图标、浅色主题下菜单跟随主题而视频区保持深色

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

### 文件管理与 NAS 页面（本轮新增）

- 首次启动自动创建默认共享目录 `<数据目录>/files`（Docker 下在持久化卷内），日志打印路径
- 文件管理器全链路实测（jsdom + 真实服务端，23 项断言）：列目录、进入子目录、面包屑跳转、回上级、
  新建文件夹（磁盘与列表同步）、**分片上传真实落盘且内容一致**、重命名、删除、页面内添加共享目录
- 上传走 4MB 分片 + `upload/check` 断点续传；小文件单分片即完成，服务端返回 `UPLOAD_COMPLETED`
- 挂载管理、分享管理、下载器、容器四个页面均能拉到真实数据并渲染（本机无 Docker，引擎状态正确显示「不可用」）
- 五个测试套件共 141 项断言全部通过（配置 33 / 接口 38 / 页面渲染 34 / 文件管理 23 / 初始化向导 13）

### 机器控制接口（本轮新增）

以下均在本机实测通过（Node 22.20.0，无界面模式，真实启动的服务端，共 61 项接口断言 + 11 项配置断言）：

- 两个入口都可用：独立端口 `127.0.0.1:6792` 与主端口 `/api/control` 返回一致结果
- 鉴权：无令牌 401、错误令牌 401、`Authorization: Bearer` / `X-NasCab-Token` / `?token=` 三种传法均可用；未知子路径返回 404 JSON
- 自动生成的令牌在多个 express worker 间一致（`O_EXCL` 竞争创建），启动横幅只由抢到创建权的进程完整打印
- 多个 express worker **共享**同一个控制端口（cluster worker 的 `listen` 经主进程共享句柄绑定），实测杀掉其中一个 worker 后控制接口仍正常，且 autoRestart 会把它拉起来
- `NASCAB_CONTROL_TOKEN` 显式指定后立即生效，并同步写入 `<数据目录>/control.json`
- `control.port=0` 时不再监听独立端口，主端口入口仍可用
- `control.enabled=false` 时 `/api/control/*` 全部 404、独立端口不监听，`/healthz` 与 Web 控制台不受影响
- 文件全链路：列目录（目录优先排序、父目录正确）、`stat`、`mkdir`、`rename`（拒绝带路径分隔符与 `..` 的新名字）、
  `delete`（单条与批量）、`upload`（三种文件名指定方式 + 自动命名 + 目录不存在时报错）、
  `download`（内容逐字节一致、带 `Content-Disposition`）
- 上传的 path 语义：给了文件名则 path 必须是已存在目录；没给则按目标文件全路径处理
- 共享目录：添加、重复添加去重、移除、不存在目录 400、相对路径 400
- 日志：读取尾部、非法文件名（路径穿越尝试）返回 400
- 下载器与容器接口在本机未安装对应组件时返回统一的 `{ok:false}` 结构，不抛异常、不挂起
- 控制接口内部委托既有控制器（文件增删/容器/下载器），与 Web 控制台走同一套实现，未复制业务逻辑
- 命令行客户端 `nascabctl` 实测：探活、总览、列目录、上传、下载（内容一致）、重命名、删除、共享目录增删、日志、下载器、容器、`raw` 直调、`--json`；连接信息可从 `control.json` 自动发现

### 界面外观与内存优化（本轮新增）

以下均在本机实测通过（Node 22.20.0，无界面模式，真实启动的服务端 + jsdom 渲染验证）：

**内存**

- express worker 进程数改为按机器规格自动决策，默认 **1 个**（原逻辑 `Math.max(2, …)` 强制至少 2 个）。
  同一空数据目录启动，实测进程总 RSS 从 **346.0 MB 降到 249.5 MB（-96.5 MB，-28%）**
- `NASCAB_EXPRESS_COUNT=4` 显式指定后按 4 个启动，超过核心数时压回核心数、超过硬上限 8 时压回 8
- 决策依据打印在启动日志里（`🧮 express worker 数量 = 1：自动决策：…`），配了环境变量也会说明
- 设置接口 `GET /api/apiSetting` 与启动路径返回同一个数，并额外给出 `expressApiCountAuto` / `expressApiCountReason` / `expressApiCountMax`
- `collectSystemInfo()` 的静态部分改为进程级缓存，消除 `os.cpus()` 在 3 秒轮询里的重复构造

**界面**

- 暗色主题：三处入口（用户菜单 / 登录页页脚 / `Shift+D`）等价；手动选择持久化，未选择时跟随系统且实时响应系统切换
- 重新加载页面后主题保持（`localStorage`）
- 概览页轮询不再重建 DOM：连续两次轮询后指标卡与趋势图节点身份不变，趋势图柱数随时间增长且上限 24
- 设备信息列表（`#device-kv`）同样只建一次骨架，`<dd>` 节点身份不变
- 日志查看器内容未变时跳过重绘
- CSS 中无硬编码浅色背景残留（原先网格视图占位块写死了 `#f6f8fb`，暗色下会漏出一块亮色）
- 键盘焦点环（`:focus-visible`）、减少动画偏好（`prefers-reduced-motion`）、高对比偏好均已定义
- 六个测试套件共 **243 项断言**全部通过（配置 57 / 控制台接口 38 / 页面渲染 51 / 文件管理 23 / 初始化向导 13 / 机器控制接口 61）
