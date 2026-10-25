# NasCabOS 服务端 - 无界面（headless）Docker 镜像
# 多架构：linux/amd64、linux/arm64
#
# 关键点：
# 1. 用 Node 22 LTS —— Electron 37 对应 Node 22，nodejieba 等原生模块只有该 ABI 的预编译二进制，
#    Node 24 会回退源码编译并因缺构建工具而失败（这是实测踩到的坑）。
# 2. 通过 npm pkg delete 移除 root postinstall —— 它执行 @electron/rebuild，
#    是为「桌面端 Electron」编译原生模块；无界面模式需要的是面向 Node ABI 的二进制。
# 3. NASCAB_IS_DOCKER=1 让 ffmpeg/ffprobe 直接用容器内 apt 安装的系统命令，
#    数据目录落到 /nascabos_data 便于挂卷。

FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="NasCabOS Server" \
      org.opencontainers.image.description="NasCabOS NAS server (headless)" \
      org.opencontainers.image.licenses="GPL-3.0" \
      org.opencontainers.image.source="https://github.com/nascab/NasCabOS"

# 运行时依赖：
#   ffmpeg/ffprobe      转码与媒体元信息（isDocker 模式下使用系统命令）
#   transmission-*      PT/BT 下载
#   rclone              云盘与远程挂载
#   ca-certificates     访问 https 外部服务（TMDB 刮削等）
#   sqlite3             便于进容器排查数据库
#   procps/curl         健康检查与进程查看
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ffprobe \
      transmission-daemon \
      transmission-cli \
      rclone \
      sqlite3 \
      procps \
      curl \
      ca-certificates \
      tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/nascab/app

# 先拷依赖描述文件，利用 Docker 层缓存
COPY package.json package-lock.json .npmrc ./

# 移除「为 Electron 编译原生模块」的 postinstall，再安装生产依赖。
# 各依赖自身的 install 脚本会照常执行（下载对应 Node ABI 的预编译二进制）。
RUN npm pkg delete scripts.postinstall \
  && npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# 应用代码
COPY src ./src
COPY language ./language
# libs 中除 ffmpeg/ffprobe 外的二进制（rclone/sftpgo/openlist/transmission/sharp）。
# 容器内 ffmpeg/ffprobe 走系统命令；若不用系统 transmission，可保留 libs/transmission。
# 体积较大时可改为在启动脚本里按需下载。
COPY libs ./libs

# ---- 部署配置（环境变量优先于 config.json，按需调整）----
ENV NODE_ENV=production \
    NASCAB_IS_DOCKER=1 \
    NASCAB_DATA_DIR=/nascabos_data \
    NASCAB_LIBS_DIR=/opt/nascab/app/libs \
    NASCAB_ONNX_DIR=/opt/nascab/app/onnx_models \
    NASCAB_LOG_DIR=/nascabos_data/logs \
    NASCAB_HOST=0.0.0.0 \
    PORT=6789 \
    HTTPS_PORT=6799 \
    NASCAB_HTTPS_ENABLED=false \
    NASCAB_PORT_FALLBACK=false \
    NASCAB_ACCESS_LOG=true \
    NASCAB_WORKER_AUTO_RESTART=true \
    NASCAB_LOG_MAX_SIZE=20971520 \
    NASCAB_LOG_MAX_FILES=10

# 数据卷：数据库、缓存、证书、日志、单例锁都在这里
RUN mkdir -p /nascabos_data \
  && chown -R node:node /nascabos_data /opt/nascab
USER node

EXPOSE 6789

VOLUME ["/nascabos_data"]

# 存活探针：进程活着即 200
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:6789/healthz || exit 1

# 优雅停止：SIGTERM 由 node 处理，走 gracefulShutdown
STOPSIGNAL SIGTERM

CMD ["node", "src/main_nascab_os.js"]
