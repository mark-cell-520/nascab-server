require('../utils/sharpConfigured');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const Logger = require('../utils/logger');
const { initI18nMiddleware, getLocalizedMessage } = require('../utils/i18nUtil');
const config = require('../config/config');
const path = require('path');
const { authenticateJWT } = require('./middleware/authMiddleware');
// 必须在任何 router 被 require 之前装上：让 async 控制器的 rejection 能走到
// 本文件末尾的错误中间件，否则请求会永久挂住、客户端只能等到超时。
require('./middleware/asyncGuard').install();
// express-validator 7 的默认校验消息是硬编码英文且 withMessage 只覆盖最后一个校验器，
// 会让每个表单错误都变成中英混杂；同理 array() 不去重导致同一提示出现两遍。
require('./middleware/expressValidatorI18n').install();
//初始化数据库和链接
const dbUtil = require('../db/dbUtil');
dbUtil.init();

const app = express(); //创建express应用
const expressWs = require('express-ws')(app); // Enable WebSocket support
app.expressWs = expressWs;

app.disable('x-powered-by');
// 仅信任来自本机回环地址（P2P 代理从 127.0.0.1 转发）的 X-Forwarded-For / X-Real-IP
// 外部直接请求伪造的 X-Forwarded-For 会被忽略，req.ip = 真实连接 IP
app.set('trust proxy', ['loopback']);

// 本地化失败不能把错误处理本身搞崩（404/500 是最后的兜底路径，
// 这里再抛一次就变成请求挂死），统一退回英文原文。
function _safeLocalize(req, key) {
  try {
    const msg = getLocalizedMessage(req, key);
    return typeof msg === 'string' && msg ? msg : key;
  } catch (e) {
    return key;
  }
}

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

app.use(
  cors({
    origin: true,
    credentials: true,
    // 跨域 fetch/探测必须带 Range；未放行时浏览器会发无 Range 的 GET，服务端 200 整文件会把内存打满
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Range',
      'Accept',
      'Accept-Language',
      'X-Requested-With',
      'Cache-Control',
    ],
    exposedHeaders: ['Accept-Ranges', 'Content-Range', 'Content-Length'],
  }),
); //允许跨域并携带凭据
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
// body-parser 在没有 Content-Type 的请求上直接 next()，不会给 req.body 赋值——
// 于是 GET /api/file/download 这类"query 和 body 二选一"的控制器会在
// `req.body.paths` 上抛 TypeError，把本该返回 400 的请求打成 500。
// 全库有 20 多处这样的裸访问，在这里统一兜底比逐个加 || {} 可靠。
app.use((req, res, next) => {
  if (req.body === undefined || req.body === null) req.body = {};
  next();
});
app.use(initI18nMiddleware()); // 使用i18n中间件
app.use(require('./middleware/decryptMiddleware')); // 参数解密中间件

// 健康检查路由
app.use('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'OK',
    serverId: process.env.SERVER_ID,
  });
});

// HTTP请求日志中间件
app.use((req, res, next) => {
  // 推荐用法：Express 封装后的 req.ip（自动处理 IPv6 格式，更简洁）
  const startTime = Date.now();
  // console.log(`API [HTTP] ${req.method} ${req.path} ${req.ip}`);
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    // Logger.http(req, res, responseTime);
  });
  next();
});

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
app.use('/', express.static(path.join(config.appRootPath, 'web', 'main'), { dotfiles: 'deny' }));
app.use('/quickshare', express.static(path.join(config.appRootPath, 'web', 'quickshare'), { dotfiles: 'deny' }));

// 用户相关api
const authApi = require('./modules/auth/authRouter');
app.use('/api/auth', authApi);

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

// 404处理
// 文案走 i18n：'Endpoint not found' 是硬编码英文，中文界面下直接露英文。
// 响应体必须是 `{success, message, code}`：客户端的 ApiResponse.fromJson 只读
// success/message/code 三个字段，之前这里回的是 `{error, path}`（express 默认
// 形状的本地化版），于是 success 缺省为 false、message 为 null，
// ApiErrorLocalizer 一路兜底成一句没信息量的"操作失败"——用户点到一个不存在的
// 接口时永远看不到"接口不存在"，更看不到是哪个路径。
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: _safeLocalize(req, 'common.ENDPOINT_NOT_FOUND'),
    code: 'common.ENDPOINT_NOT_FOUND',
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

  // 控制器抛出的 error 常带 i18n 键（含 `模块.键:上游原文` 形式），
  // 之前一律回 'Internal server error'，用户看到的就是一句没信息量的英文，
  // 真正的原因（如网盘 token 失效、目录读取进程退出）全被丢掉。
  // 这里只透传"形如 i18n 键"的 message；SQL 报错、文件路径等原文仍被
  // 通用文案盖掉，不向内网之外泄露实现细节。
  const status = Number(err && (err.statusCode || err.status)) || 500;
  const httpStatus = status >= 400 && status < 600 ? status : 500;
  const raw = err && typeof err.message === 'string' ? err.message.trim() : '';
  const looksLikeKey = /^[a-z][a-zA-Z0-9]*\.[A-Z][A-Z0-9_]+/.test(raw);

  res.status(httpStatus).json({
    success: false,
    message: looksLikeKey ? _safeLocalize(req, raw) : _safeLocalize(req, 'common.INTERNAL_SERVER_ERROR'),
    code: looksLikeKey ? raw.split(':')[0] : 'INTERNAL_SERVER_ERROR',
  });
});
module.exports = app;
