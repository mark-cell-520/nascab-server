# 相对上游的修改说明

本项目是 [nascab/NasCabOS](https://github.com/nascab/NasCabOS)（GPL-3.0）的衍生版本。
按 GPL-3.0 第 5 节「You must cause the modified files to carry prominent notices」的要求，
在此对修改作显著声明。

## 基线

| 项 | 值 |
|---|---|
| 上游仓库 | <https://github.com/nascab/NasCabOS> |
| 上游版本 | v1.2.5（commit `77cdb9b`，本仓库标签 `upstream-v1.2.5`） |
| 改造目标 | 从「桌面 NAS 应用」改造为「可长期运行的服务端」 |
| 改造时间 | 2026-10-25 起 |

查看完整差异：

```bash
git diff upstream-v1.2.5..main --stat     # 改了哪些文件
git log --oneline upstream-v1.2.5..main   # 分了几次提交、每次做了什么
```

## 改了什么

改造集中在 `electron_server/`（后端）与新增的 `deploy/`（部署产物），**未改动任何客户端代码**
（flutter_client / tv_android / tv_apple / harmony_client 均保持上游原样）。

动机：桌面应用隐含的假设是「有人看着、单用户、本机磁盘、能弹窗」；
服务端的假设是「无人值守、多客户端、容器或虚拟机、根文件系统可能只读、磁盘要能长期跑」。
两者的差距就是下面这些改造。

| 方向 | 上游行为 | 改造后 |
|---|---|---|
| 配置来源 | 写死在代码 / `package.json` / 界面设置存数据库 | 三级配置：内置默认 < `config.json` < 环境变量 |
| 环境探测 | 读 `package.json` 的 `isDocker` 字段 | 运行时开关 `NASCAB_IS_DOCKER`，不用改包信息 |
| 单例保护 | 无界面模式没有任何保护，重复启动会两个进程抢同一个 SQLite | `O_EXCL` 锁文件，冲突时报出持有者 PID；持有者已死的残留锁自动接管 |
| worker 崩溃 | `restartWorker()` 已实现但**全仓无人调用**，崩溃后 API 离线而主进程仍显示健康 | 指数退避自动重启（1s→30s）+ 次数上限 + 稳定 60s 重置预算 + 正常退出不重启 |
| 端口占用 | 静默换一个端口；数据库里的旧端口会压过 `PORT` 环境变量 | `server.portFallback=false` 时快速失败并明确报错；显式指定的端口优先于数据库值 |
| CORS | 反射任意 `Origin` 且允许携带凭证 | 白名单，默认仅同源 + 本机 + `file://`，第三方源需显式声明 |
| 健康检查 | 无 | `/healthz`（存活）、`/readyz`（就绪，含数据库连通检查，失败 503） |
| 日志 | `maxFiles:1` 等于不轮转，长期运行会把磁盘写满；且 `NODE_ENV` 未设置时被判定为开发环境，**文件日志被静默关闭、级别降为 debug** | 轮转参数可配；日志目录可配且不可写时回退；访问日志单独落 `access.log`；开发环境默认值只在真正运行于 Electron 中时套用 |
| 外部二进制 | 路径写死，只能放在应用目录内 | `NASCAB_LIBS_DIR` / `NASCAB_ONNX_DIR` 可指向只读镜像之外的数据卷 |
| 优雅停止 | Windows 上没有可行路径 | 监听 `SIGBREAK`，经 WinSW 服务可优雅停止 |
| 异常兜底 | 无全局 `uncaughtException` 处理 | 全局兜底 + 统一关停流程（停 worker → 释放锁） |
| Web 界面 | 主控制台 `web/main` 是官方构建产物、**不入库**，源码部署后 `/` 直接 404 | 自带无构建步骤的 Web 控制台（`web/console`）：登录/首次部署向导 + 概览/存储/用户/网络/安全/应用/进程/日志/关于 10 个页面，带 CSP 等安全响应头与 SPA 回退 |
| 首个管理员 | 只能随机生成，账号密码要在启动日志里翻 | 支持 `NASCAB_ADMIN_USER`/`NASCAB_ADMIN_PASSWORD` 显式指定；创建成功立即打印醒目横幅；极端情况下可在网页上走初始化向导 |
| 用户信息接口 | `getUserProfile` 查询不存在的 `role`/`updated_at` 列，`/api/auth/profile` 对所有客户端返回 400 | 按真实表结构取列 |
| 共享目录 | 全新部署时列表为空，客户端「无处可看」 | 首次启动自动创建 `<数据目录>/files`（显示名「文件存储」，Docker 下位于持久化卷内） |
| Web 文件管理 | 上游只有 Flutter/Android/TV 客户端，源码部署后网页端完全没有文件操作能力 | 控制台内置文件管理器：浏览、分片上传（断点续传）、下载、新建、重命名、删除、缩略图、拖拽 |

逐文件的改造清单、部署方式与实测验证结果见 [DEPLOY.md](DEPLOY.md)。

## 许可

上游以 GPL-3.0 分发，本衍生版本同样以 GPL-3.0 分发，仓库根目录的 `LICENSE` 保持上游原样未作修改。
