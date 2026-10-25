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
| 机器控制面 | 没有任何面向脚本/自动化的控制接口，一切操作都要先有图形客户端或逆推 JWT 流程 | 新增 `/api/control`：一个长期令牌换全部管理能力（状态/日志/共享目录/文件增删改查与传输/下载器/容器），响应为稳定的 `{ok,data,error}`；另开独立监听（默认只绑 `127.0.0.1:6792`），可与面向公网的业务端口分开做防火墙策略 |
| worker 进程数 | 按 CPU 核心数铺开（最少 2 个），小内存机器上两个 express worker 就占掉 1/4 以上常驻内存 | 按机器规格自动决策，默认 1 个（API 负载是 IO 密集不是 CPU 密集）；需要并发可用 `NASCAB_EXPRESS_COUNT` 显式指定，上限为核心数。实测同数据目录启动进程总 RSS 由 346.0 MB 降至 249.5 MB |
| 界面主题 | 只有浅色一套，暗色环境与夜间运维下刺眼 | 样式设计令牌化 + 暗色主题；手动选择优先于系统 `prefers-color-scheme`，未选择时实时跟随；`Shift+D` 快捷切换 |
| 前端轮询 | 概览页每 3 秒把整块指标区 `innerHTML` 重建一遍，日志页每 5 秒重绘 300 行 | 就地更新：骨架只建一次，之后只改文本/条宽/柱高；数据指纹未变则整块跳过；日志页不再把正在往上翻看历史的用户拽回底部 |
| 音乐播放列表 | `play_list2index` 只有 `(list_id, index_id, create_time)` 三列，**没有顺序字段**；`/api/music/list` 带 `list_id` 时按 `m.id desc` 排序；`playlist/get` 不返回曲目；`addListIndexes` 还按 rowid 顺序分配位置 | 新增 `position` 列（老库自动补列并按加入顺序回填）+ `(list_id, position)` 索引；新增 `playlist/index/reorder`、`playlist/index/move`、`playlist/index/clear`；列表改按 `position` 排序；`playlist/get` 返回曲目；加歌按调用方传入顺序分配位置。控制台另带播放队列（抽屉、上移/下移/移除、顺序/随机/单曲、LRC 歌词、队列持久化） |
| 影视清晰度 | `/transcode` 只接受裸 `width`/`resolution`/`bitrate`，其中 `resolution` **只认 `1920x1080` 这种 WxH 写法**，传 `"1080p"` 被 `parseResolution` 静默忽略——选了清晰度而实际没有任何变化；没有任何地方定义过「有哪些清晰度可选」，前端拿不到档位表；`bitrate` 不带 `-maxrate`/`-bufsize`；清晰度偏好不落库 | 新增 `src/utils/videoQualityUtil.js` 作为档位唯一来源（原画/1080P/720P/480P/360P → 宽/高/码率/maxrate/bufsize），`normalizeQualityKey` 兼容 `1080p`/`FHD`/`1920x1080`/`source` 等写法；新增 `GET /api/videoPlayer/qualities` 按源分辨率给出可选档位（源分辨率低于档位时禁用并标注「不推荐」，放大不增加清晰度只浪费带宽）；`/transcode` 与 `/stream-mp4` 接受 `quality`；`video_play_preference` 新增 `quality` 列持久化偏好。控制台影视页带海报墙、详情弹层、续播进度与全屏播放器（清晰度菜单、Esc/空格快捷键） |
| 播放器功能 | 上游只有 Flutter/Android/TV 客户端，Web 端没有任何播放器；而 Web 播放器要的「选字幕/选音轨/调倍速/连播」在上游服务端要么没有接口、要么接口存在但前端无处可用 | 新增 `src/utils/mediaTrackLabelUtil.js`（语言码→中文名、字幕编码→中文名、能否转 WebVTT 的判定、倍速白名单）；新增 `GET /api/videoPlayer/tracks` 一次给出音轨轨/字幕轨清单（含内嵌与外挂、语言、编码、可达性）与片头片尾区间；`/stream-mp4` 走已有的 `audioMapIndex` 选音轨；字幕走 `<track>` + `/subtitle-vtt`（WebVTT），切换即时且不破坏原画路径，图像字幕（PGS/VOBSUB）在菜单里禁用并说明原因而不是给死选项；`/preference` 持久化清晰度/字幕/音轨/倍速四类偏好（脏值归一化后落空）；`video_play_preference` 补 `subtitle_ref`/`audio_index`/`speed` 三列。控制台播放器补上字幕菜单与外观调节、音轨切换、0.5x–3x 倍速、跳过片头、剧集分集列表与自动连播、音量/静音、全屏/画中画、缓冲进度与完整快捷键 |
| 源编码浏览器不支持 |/stream-mp4 的 mode=copy 是纯 remux，上游**只对 .mov 判断过音频要不要转 aac**、**视频编码一眼都没看过**，HEVC / DTS / AC3 这类源被原封不动推给浏览器；_isMp4CompatibleAudioCodec 把 AC3 算作「兼容」，那只是「mp4 容器装得下」，桌面 Chrome/Firefox 解不了 AC3。上游客户端报错后**先**弹「原文件编码不支持,已为您自动转码播放」再发转码请求，转码没起来时这句话是假的 |新增 src/utils/webPlayableUtil.js 把「容器兼容」与「浏览器可解」分成两个函数（含 H.264 10bit/4:2:2 profile），并提供 mimeCandidates 供前端实测。**但这份表只是「主流浏览器交集」的参考，不是结论**——编码支持高度依赖具体浏览器和平台（Safari 与带 HEVC 硬解的 Windows Edge/Chrome 都能放 HEVC），所以服务端只提供信息、判断交给最了解自身能力的浏览器。GET /api/videoPlayer/tracks 增加 video 与 directPlay（ok/reason/note/videoCodec/audioCodecs/mimeCandidates）；控制台播放器用 MediaSource.isTypeSupported 与canPlayType 实测，浏览器放不了才切到转码档位并点名具体编码，转码失败回落原画，原画仍不行才报错。/stream-mp4 只按「要不要缩放」决定重编码，**原画档位保持纯 remux**。（一度让服务端也按编码退到重编码，结果 4K HEVC 被推上 libx264 实时编码、服务器跟不上，用户原本能硬解直看的原片反而看不了——已回退，并加了「原画档位输出编码必须等于源编码」的测试兜底） |
| 相册 | `/api/photo` 下有一整套相册能力（时间线、相册、合集、智能相册、人脸、地点、相似图、回收站、GPS 补全、AI 开关），但 Web 控制台一处都没接——照片只能在手机客户端看；`getTimelinePhotoList` 的注释写着 `page`/`pageSize` 而实现一个都没用，时间轴无法滚动加载；`/album/delete` 只认 `id` 而同文件其它接口全认 `album_id`；`getTinyImgByPath` 的缓存键不含请求的 `size` 而缓存目录是扁平的，第一个请求的尺寸被永久固化；`photoTimeLineService` 每次查询都 `console.log(query.toString())` | 新增 `web/console/pages-photo.js` 与控制台「相册」页：时间线（年份导航、按拍摄日期分组、滚动分页、类型筛选、搜索）、相册（卡片/详情/增改删/增删照片/设封面）、收藏、地点、回收站五个视图，加灯箱（大图、前后翻页、EXIF、收藏、加入相册、下载、删除）与多选批量操作。`getTimelinePhotoList` 实现分页（传 `pageSize` 才分页、单页上限 500、响应带 `hasMore`，不传时保持原行为）；`deleteAlbum` 同时接受 `id` 与 `album_id`；`getTinyImgByPath` 让尺寸参与缓存键并新增 `normalizeTinySize`（未指定回落 640）；清掉相册模块 4 处 `console.log` |

| 播放器画面比例 | 上游 Web 端没有任何播放器，自然也没有画面比例这类显示控制；服务端同样没有对应接口 | 控制台播放器新增七档画面比例：自动（按片源比例留黑边）、16:9 / 16:10 / 4:3 / 1:1（强制显示宽高比，用来矫正元数据写错的片源）、裁剪填充（填满播放区并裁掉多余）、拉伸填充（拉满不管比例）。实现落在 `<video>` 的 `aspect-ratio` + `object-fit` 上，**不重连流、不起播、不丢播放位置**；快捷键 `R` 在常用几档间循环；偏好与音量一样只存 `localStorage`（显示偏好跟设备相关，不占服务端偏好表） |

逐文件的改造清单、部署方式与实测验证结果见 [DEPLOY.md](DEPLOY.md)。

## 许可

上游以 GPL-3.0 分发，本衍生版本同样以 GPL-3.0 分发，仓库根目录的 `LICENSE` 保持上游原样未作修改。
