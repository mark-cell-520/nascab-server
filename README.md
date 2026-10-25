# NasCabOS 服务端

NasCabOS 的服务端源码，面向**服务器长期运行**改造过的版本。上游是跨平台 NAS 项目
[ nascab/NasCabOS ](https://github.com/nascab/NasCabOS)（v1.2.5，commit `77cdb9b`），
本仓库只保留服务端部分（`electron_server/`）与部署产物（`deploy/`），
Flutter / Android / tvOS / HarmonyOS 客户端未纳入。

许可证 **GPL-3.0**，相对上游的修改声明见 [MODIFICATIONS.md](MODIFICATIONS.md)。

---

## 这个仓库改了什么

上游是按「桌面 NAS 应用」设计的：Electron 窗口、首次启动走图形引导、配置写在用户目录、
按 CPU 核心数铺开 express worker。改成服务器运行需要解决的是另一组问题。

| 方面 | 上游 | 本仓库 |
|---|---|---|
| 配置 | 散落在用户目录 | 三层：环境变量 > `config.json` > 默认值，全部可通过 `deploy/config.example.json` 注入 |
| 外部二进制 | 写死项目内相对路径 | `NASCAB_LIBS_DIR` / `libs.dir` 可指向独立目录，ffmpeg / rclone / openlist / sftpgo / transmission 分别可配 |
| 首管理员 | 图形界面创建 | 启动时自动创建，账号密码打在日志里；也可用 `NASCAB_ADMIN_USER` / `NASCAB_ADMIN_PASSWORD` 指定 |
| Web 界面 | `web/main` 是构建产物，`.gitignore` 排除，源码部署 `/` 是 404 | 自带纯静态 Web 控制台（`electron_server/web/console/`），无构建、无前端依赖，启动即在 `/` 可用 |
| 日志 | `NODE_ENV` 未设置时按开发环境处理，文件日志被关掉 | 默认按生产环境处理，日志落盘，级别可配 |
| 进程模型 | `Math.max(2, 核心数)` 个 express worker | 默认 1 个 worker（`NASCAB_EXPRESS_COUNT` 覆盖）。API 负载以文件流与 SQLite IO 为主、非 CPU 密集，多开只增加常驻内存；实测同数据目录进程总 RSS 从 346.0 MB 降到 249.5 MB（-28%） |
| 崩溃自愈 | 无 | 单例锁 + worker 崩溃自动重启 + 优雅关停 |
| 机器控制 | 无 | `/api/control`，21 个端点，一个长期令牌换全部管理能力 |

### Web 控制台

单页应用，前端路由（刷新 / 直接访问子路径不会 404）。页面：概览、存储管理、用户管理、
网络服务、安全中心、应用中心、进程管理、系统日志、关于本机；另有 Web 文件管理器与
挂载 / 分享 / 下载 / 容器四个 NAS 管理页面。

界面做了设计令牌化，浅色 / 暗色双主题：暗色只覆盖 `[data-theme="dark"]` 一层令牌，
组件规则两边共用。未显式选择时跟随系统 `prefers-color-scheme` 并实时响应，
也可在用户菜单、登录页页脚或按 `Shift+D` 手动切换（选择记在 `localStorage`）。

概览页轮询改为就地更新，不再每 3 秒把整块指标区 `innerHTML` 重建一遍。

### 音乐与影视

「音乐」页：库导航（全部歌曲 / 专辑 / 艺人 / 最近播放 / 我的收藏）+ 歌单 + 曲目表，
底部是**常驻播放器栏**，切页面不中断。带播放队列抽屉（上移 / 下移 / 移除 / 点选）、
顺序 / 随机 / 单曲三种模式、进度拖动、音量、LRC 歌词逐行高亮；队列存 `localStorage`，刷新不丢。

「影视」页：海报墙 + 详情弹层 + 全屏播放器。播放器可选**五档清晰度**
（原画 / 1080P / 720P / 480P / 360P），档位表由 `GET /api/videoPlayer/qualities` 按源分辨率算出——
源只有 720p 时 1080p 会被禁用并标注「高于源分辨率，不推荐」。切清晰度从当前位置接着播，
偏好写进 `video_play_preference.quality`。

这两个页面修掉了上游两处残缺：

| 方面 | 上游 | 本仓库 |
|---|---|---|
| 歌单顺序 | `play_list2index` 没有顺序字段；列表按 `m.id desc` 排；`playlist/get` 不返回曲目 | 新增 `position` 列（老库自动补列回填）+ reorder/move/clear 三个接口，列表按 `position` 排 |
| 清晰度 | `resolution` 只认 `1920x1080`，传 `"1080p"` 被静默忽略；没有档位表；`bitrate` 不带 `-maxrate/-bufsize` | 档位收敛成 `src/utils/videoQualityUtil.js` 一份定义，`/transcode` 与 `/stream-mp4` 共用 |

### 机器控制接口 `/api/control`

给脚本和 Agent 用的管理面，响应统一 `{ok, data, error}`。两个入口：

- 主端口 `/api/control`（如 `http://host:6789/api/control`）
- 独立监听 `127.0.0.1:6792`（`control.port=0` 只保留主端口入口，`control.enabled=false` 整个关闭）

控制令牌是 root 级凭证，默认只绑回环；远程接入请走 SSH 隧道或反代 + IP 白名单。
令牌未指定则自动生成并写入 `<数据目录>/control.json`。

配套的 Claude 技能 `nascab`（零依赖 Node 客户端）封装了全部端点。

---

## 快速开始

**Node 22 LTS**（Electron 37 对应 Node 22；Node 24 装不上 `nodejieba`）。

```bash
cd electron_server
npm ci
node src/main_nascab_os.js
```

首次启动会在日志里打印自动创建的超级管理员账号密码，请登录后立即修改。
也可提前指定：

```bash
NASCAB_ADMIN_USER=admin NASCAB_ADMIN_PASSWORD='换成一个强密码' node src/main_nascab_os.js
```

常用环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `NASCAB_DATA_DIR` | 项目内 `data/` | 数据目录（SQLite / 缓存 / 证书 / 单例锁） |
| `NASCAB_HOST` | `0.0.0.0` | 监听地址 |
| `PORT` / `NASCAB_PORT` | `6789` | HTTP 端口 |
| `NASCAB_HTTPS_ENABLED` | 视配置 | 是否启用 HTTPS |
| `NASCAB_CONTROL_PORT` | `6792` | 机器控制接口独立端口，`0` 关闭 |
| `NASCAB_EXPRESS_COUNT` | 自动（1） | express worker 进程数 |
| `NASCAB_LIBS_DIR` | 项目内 `libs/` | 外部二进制目录 |
| `NASCAB_ADMIN_USER` / `NASCAB_ADMIN_PASSWORD` | — | 首管理员账号 |

完整配置项总表、四种部署方式、反向代理、运维手册见 **[DEPLOY.md](DEPLOY.md)**。

### 部署产物

`deploy/` 下有四套开箱可用的东西：

- `systemd/nascabos.service` — Linux 裸机（推荐）
- `docker/Dockerfile` + `docker-compose.yml` — 容器
- `windows/install-service.ps1` — Windows 服务
- `scripts/start.sh` / `start.ps1` — 裸机脚本快速验证

---

## 未入库的预编译二进制

`electron_server/libs/sftpgo/`（6 个平台，约 277 MB）与 `libs/transmission/`（约 21 MB）
是第三方**预编译可执行文件**，属于构建产物而非源码，因此没有提交到本仓库——
上游把它们放在 git 里也是整个 monorepo 涨到 665 MB 的主要原因。

取回办法（任选其一）：

```bash
# ① 从上游仓库只稀疏检出这两个目录
git clone --filter=blob:none --no-checkout --depth 1 https://github.com/nascab/NasCabOS.git /tmp/up
cd /tmp/up && git sparse-checkout set electron_server/libs/sftpgo electron_server/libs/transmission
git checkout -q
cp -r electron_server/libs/sftpgo electron_server/libs/transmission <本仓库>/electron_server/libs/

# ② 用官方发行包里的同名目录
```

`electron_server/.gitignore` 已忽略这两个目录，取回也不会被误提交。

---

## 目录结构

```
electron_server/
  src/                 服务端源码（Express + knex/SQLite）
    api/               路由与控制器，含 control/（机器控制接口）
    config/            配置层：config.js + deployConfig.js + expressWorkerCount.js
    workers/           cluster worker 与各类后台任务
    utils/             日志、单例锁、控制令牌等
    main_nascab_os.js  入口
  web/console/         自带 Web 控制台（纯静态，无构建）
  language/            语言包
deploy/                部署产物
DEPLOY.md              部署指南
MODIFICATIONS.md       GPL 修改声明
```

---

## 与上游的关系

本仓库以上游 `77cdb9b`（v1.2.5）为基线，标签 `upstream-v1.2.5` 即该提交，
其后 9 次提交是服务端改造。上游更新可以按普通三方合并接入。

## 许可

GPL-3.0，见 [LICENSE](LICENSE)。上游版权归各自作者所有。
