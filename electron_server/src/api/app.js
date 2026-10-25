require('../utils/sharpConfigured');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const Logger = require('../utils/logger');
const { initI18nMiddleware } = require('../utils/i18nUtil');
const config = require('../config/config');
const path = require('path');
const { authenticateJWT } = require('./middleware/authMiddleware');
//初始化数据库和链接
const dbUtil = require('../db/dbUtil');
dbUtil.init();

const app = express(); //创建express应用
const expressWs = require('express-ws')(app); // Enable WebSocket support
app.expressWs = expressWs;

app.disable('x-powered-by');
// 反向代理信任设置：
// 默认仅信任本机回环（P2P 代理从 127.0.0.1 转发）的 X-Forwarded-For / X-Real-IP；
// server.behindProxy=true 时（Nginx/Caddy/Traefik 等前置）信任代理链，req.ip 才能取到真实客户端 IP
app.set('trust proxy', config.server.behindProxy ? true : ['loopback']);

/**
 * 生成本机/桌面客户端默认放行的 CORS 源判定
 * 放行：无 Origin 头（curl、移动端、桌面客户端）、同源、本机回环任意端口、file:// 桌面端
 * 拦截：其余任意第三方站点（改造前为 origin:true 反射任意源，配合 credentials:true 等于任意网站可携带凭证调用）
 */
function isLocalOrSameOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (origin === 'null') return callback(null, true); // file:// 场景浏览器会发 Origin: null
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return callback(null, false);
  }
  if (parsed.protocol === 'file:') return callback(null, true);
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '[::1]') {
    return callback(null, true);
  }
  return callback(null, false);
}

const _corsAllowedHeaders = [
  'Content-Type',
  'Authorization',
  'Range',
  'Accept',
  'Accept-Language',
  'X-Requested-With',
  'Cache-Control',
];
const _corsExposedHeaders = ['Accept-Ranges', 'Content-Range', 'Content-Length'];

function buildCorsOptions() {
  const origins = config.security.corsOrigins || [];
  const base = {
    credentials: true,
    // 跨域 fetch/探测必须带 Range；未放行时浏览器会发无 Range 的 GET，服务端 200 整文件会把内存打满
    allowedHeaders: _corsAllowedHeaders,
    exposedHeaders: _corsExposedHeaders,
  };
  if (origins.includes('*')) {
    // 显式配置 ['*']：兼容改造前的宽松行为（不推荐，仅用于排障）
    return { ...base, origin: true };
  }
  if (origins.length > 0) {
    const allow = new Set(origins);
    return { ...base, origin: (o, cb) => cb(null, !o || allow.has(o)) };
  }
  // 默认：仅同源 + 本机 + 桌面端
  return { ...base, origin: isLocalOrSameOrigin };
}

app.use(cors(buildCorsOptions()));

function _isScannerPath(rawPath) {
  const p = String(rawPath || '');
  if (!p) return false;
  if (p === '/' || p === '/favicon.ico') return false;
  const lower = p.toLowerCase();
  if (lower.startsWith('/@fs/')) return true;
  if (lower.includes('..%2f') || lower.includes('%2e%2e%2f') || lower.includes('../') || lower.includes('..\\')) return true;
  if (lower.includes('/proc/self/environ')) return true;
  if (lower.includes('/.aws/credentials')) return true;
  if (lower.startsWith('/.env') || lower === '/env' || lower.startsWith('/env.')) return true;
  if (lower.startsWith('/.git/')) return true;
  if (lower.includes('docker-compose') || lower.includes('terraform.tfstate') || lower.includes('terraform.tfvars')) return true;
  if (lower.includes('wp-config.php')) return true;
  if (lower.includes('actuator/env') || lower.includes('actuator/configprops')) return true;
  if (lower.endsWith('.bak') || lower.endsWith('.old') || lower.endsWith('.save') || lower.endsWith('.swp') || lower.endsWith('~')) return true;
  return false;
}

app.use((req, res, next) => {
  const pathStr = req.originalUrl || req.path || '';
  if (_isScannerPath(pathStr)) {
    console.log(`---FORBIDDEN API [HTTP] ${req.method} ${req.path} ${req.ip}`);
    res.status(404).end();
    return;
  }
  next();
});

/**
 * 基础安全响应头（对所有响应生效）
 * 服务端要长期暴露在局域网甚至公网，这几项是成本最低的加固
 */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  next();
});

// 大文件 Range 流式（rawFile / download）若走压缩层，部分客户端会退化为整文件 200 或异常缓冲；显式排除
app.use(
  compression({
    filter: (req, res) => {
      const p = String(req.path || req.url || '');
      if (
        p.includes('/api/file/rawFile') ||
        p.includes('/api/videoPlayer/rawFile') ||
        p.includes('/api/videoPlayer/stream-mp4') ||
        p.includes('/api/file/download')
      ) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
); //开启静态文件压缩
app.use(bodyParser.json({ limit: config.upload.maxFileSize })); //限制上传大小
app.use(bodyParser.urlencoded({ limit: config.upload.maxFileSize, extended: true })); //限制上传大小
app.use(cookieParser()); // 使用cookie-parser中间件
app.use(initI18nMiddleware()); // 使用i18n中间件
app.use(require('./middleware/decryptMiddleware')); // 参数解密中间件

// 健康检查路由（存活探针）：进程活着就返回 200，供 Docker/ systemd / k8s livenessProbe 使用
app.use('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'OK',
    serverId: process.env.SERVER_ID,
  });
});

// 兼容常见探针路径别名
app.use('/healthz', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'OK',
    serverId: process.env.SERVER_ID,
  });
});

// 就绪探针：数据库可用才算就绪，否则返回 503，供 readinessProbe / 负载均衡摘流使用
app.use('/readyz', async (req, res) => {
  const checks = {
    uptime: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    db: 'unknown',
  };
  let ready = true;
  try {
    const knex = dbUtil.getConnectMainDb().knex;
    await knex.raw('select 1 as ok');
    checks.db = 'ok';
  } catch (err) {
    checks.db = 'fail';
    checks.dbError = err && err.message ? err.message : String(err);
    ready = false;
  }
  res.status(ready ? 200 : 503).json({ success: ready, checks });
});

// HTTP请求日志中间件（默认关闭，通过 logging.accessLog / NASCAB_ACCESS_LOG 开启）
if (config.logging.accessLog) {
  app.use((req, res, next) => {
    const startTime = Date.now();
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      Logger.http(req, res, responseTime);
    });
    next();
  });
}

// 挂载数据库实例到req对象上 方便路由使用
app.use((req, res, next) => {
  //把数据库链接对象挂载到req上，方便在路由中使用
  req.dbMain = dbUtil.getConnectMainDb().knex;
  req.dbVideo = dbUtil.getConnectVideoDb().knex;
  req.dbBook = dbUtil.getConnectBookDb().knex;
  req.dbMusic = dbUtil.getConnectMusicDb().knex;
  req.dbFile = dbUtil.getConnectFileDb().knex;
  req.dbPhoto = dbUtil.getConnectPhotoDb().knex;
  req.dbGeo = dbUtil.getConnectGeoDb().knex;

  next();
});

//静态资源映射
app.use(`/wallpaper`, authenticateJWT, express.static(path.join(config.appRootPath, 'web', 'wallpaper'), { dotfiles: 'deny' }));
app.use(
  '/customWallpaper',
  authenticateJWT,
  (req, res, next) => {
    const uid = req.user && req.user.id !== undefined && req.user.id !== null ? String(req.user.id) : '';
    const seg = String(req.path || '')
      .split('/')
      .filter(Boolean)[0];
    if (!seg) return res.status(404).end();
    if (!uid || seg !== uid) return res.status(403).end();
    next();
  },
  express.static(config.getCustomWallpaperPath(), { dotfiles: 'deny' })
);
// Web 控制台（/）
// 上游把 web/main 列为不入库的构建产物，源码部署时该目录是空的，
// 因此这里改为提供自带的 Web 控制台（web/console，纯静态、无构建步骤）。
// 控制台页面自身不带内联事件与 eval，可以上一套较严格的 CSP；
// 其余路径仍只带基础安全头，避免影响既有页面（如 Flutter Web 版）。
app.use('/', (req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
});

const consoleEnabled = config.console && config.console.enabled !== false;
const consoleDir = typeof config.getConsolePath === 'function' ? config.getConsolePath() : path.join(config.appRootPath, 'web', 'console');
if (consoleEnabled) {
  // HTML 不缓存：控制台升级后刷新即可生效，不需要运维清 CDN
  app.use(
    '/',
    express.static(consoleDir, {
      dotfiles: 'deny',
      setHeaders: res => {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      },
    })
  );
} else {
  Logger.info('Web 控制台已关闭（console.enabled=false），仅提供 API 与探针');
}
app.use('/quickshare', express.static(path.join(config.appRootPath, 'web', 'quickshare'), { dotfiles: 'deny' }));

// 用户相关api
const authApi = require('./modules/auth/authRouter');
app.use('/api/auth', authApi);

// Web 控制台专用api
const consoleApi = require('./modules/console/consoleRouter');
app.use('/api/console', consoleApi);

// 安全中心相关api
const securityApi = require('./modules/security/securityRouter');
app.use('/api/security', securityApi);

// 硬件监控相关api
const hwApi = require('./modules/others/hw/hwRouter');
app.use('/api/hw', hwApi);

// 挂载/分享插件状态
const pluginApi = require('./modules/others/plugin/pluginRouter');
app.use('/api/plugin', pluginApi);

// 外观相关api
const appearanceApi = require('./modules/others/appearance/appearanceRouter');
app.use('/api/appearance', appearanceApi);

// Apps相关api
const appsApi = require('./modules/others/apps/appsRouter');
app.use('/api/apps', appsApi);

// API设置相关api
const apiSettingApi = require('./modules/others/apiSetting/apiSettingRouter');
app.use('/api/apiSetting', apiSettingApi);

// 快速分享相关api
const quickShareApi = require('./modules/quickShare/quickShareRouter');
app.use('/api/quickShare', quickShareApi);

// 消息中心相关api
const messageApi = require('./modules/message/messageRouter');
app.use('/api/message', messageApi);

// 首页相关api
const homeApi = require('./modules/home/homeRouter');
app.use('/api/home', homeApi);

// 加密空间相关api
const encryptedSpaceApi = require('./modules/encryptedSpace/encryptedSpaceRouter');
app.use('/api/encryptedSpace', encryptedSpaceApi);

// 用户管理相关api
const userApi = require('./modules/user/userRouter');
app.use('/api/user', userApi);

// 文件目录相关api
const fileApi = require('./modules/file/fileRouter');
app.use('/api/file', fileApi);

// 文本编辑相关api
const editorApi = require('./modules/editor/editorRouter');
app.use('/api/editor', editorApi);

// 文件分享服务相关api
const fileServerApi = require('./modules/fileServer/fileServerRouter');
app.use('/api/fileServer', fileServerApi);

// 文件挂载相关api
const fileMountApi = require('./modules/fileMount/fileMountRouter');
app.use('/api/fileMount', fileMountApi);
const openlistMountApi = require('./modules/openlistMount/openlistMountRouter');
app.use('/api/openlistMount', openlistMountApi);

// 磁盘间备份相关api
const fileBackupApi = require('./modules/fileBackup/fileBackupRouter');
app.use('/api/fileBackup', fileBackupApi);

// VideoPlayer相关api
const videoPlayerApi = require('./modules/videoPlayer/videoPlayerRouter');
app.use('/api/videoPlayer', videoPlayerApi);

// Photo相关api
const photoApi = require('./modules/photo/photoRouter');
app.use('/api/photo', photoApi);

// Video相关api
const videoApi = require('./modules/video/videoRouter');
app.use('/api/video', videoApi);

// Book相关api
const bookApi = require('./modules/book/bookRouter');
app.use('/api/book', bookApi);

// Music相关api
const musicApi = require('./modules/music/musicRouter');
app.use('/api/music', musicApi);

// Notes相关api
const notesApi = require('./modules/notes/notesRouter');
app.use('/api/notes', notesApi);

// Service相关api
const serviceApi = require('./modules/service/serviceRouter');
app.use('/api/service', serviceApi);

// Docker相关api
const dockerApi = require('./modules/docker/dockerRouter');
app.use('/api/docker', dockerApi);

// Transmission相关api
const transmissionApi = require('./modules/transmission/transmissionRouter');
app.use('/api/transmission', transmissionApi);

// MediaTool相关api
const mediaToolApi = require('./modules/mediaTool/mediaToolRouter');
app.use('/api/mediaTool', mediaToolApi);

// Map相关api（兼容旧版 /api/mapApi）
const mapApi = require('./modules/photo/map/photoMapRouter');
app.use('/api/mapApi', mapApi);

// 文件变动检测ws链接处理
require('./modules/file/ws/watch/fileWatcher')(app);
// 文件统计ws链接处理
require('./modules/file/ws/stats/fileStats')(app);
// 文本编辑ws链接处理
require('./modules/editor/ws/editorWs')(app);
// 终端 ws 链接处理
require('./modules/terminal/terminalWs')(app);

// 单页应用回退：控制台使用前端路由，刷新/直接访问子路径时需要返回 index.html
// 只处理 GET、且不属于 /api 与 WebSocket 升级的请求，避免把 API 的 404 也吞掉
if (consoleEnabled) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = String(req.path || '/');
    if (p.startsWith('/api/') || p.startsWith('/quickshare') || p.startsWith('/wallpaper') || p.startsWith('/customWallpaper')) {
      return next();
    }
    // 带扩展名的请求视为静态资源，找不到就正常 404
    if (path.extname(p)) return next();
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(consoleDir, 'index.html'), err => {
      if (err) next();
    });
  });
}

// 404处理
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  Logger.error('Express error:', err, {
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

  // 使用统一的错误响应格式
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    code: 'INTERNAL_SERVER_ERROR',
  });
});
module.exports = app;
