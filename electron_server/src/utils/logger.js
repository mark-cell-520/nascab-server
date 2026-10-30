const winston = require('winston');
const path = require('path');
const config = require('../config/config');

// 自定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// 控制台输出格式
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;

    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }

    // 发送日志到主进程事件总线，用于UI显示
    try {
      process.emit('log-entry', { timestamp, level, message, meta });
    } catch (e) {
      // 忽略发送失败
    }

    return log;
  })
);

const recentLogs = [];
let logSeq = 0;
function pushRecent(level, message, meta) {
  recentLogs.push({ seq: ++logSeq, timestamp: new Date().toISOString(), level, message, meta });
  if (recentLogs.length > 500) recentLogs.shift();
}
const loggerInstance =
  // 创建logger实例
  winston.createLogger({
    level: config.logging.level,
    format: logFormat,
    defaultMeta: {}, //默认打印的后缀
    transports: [
      // 控制台输出
      new winston.transports.Console({
        format: consoleFormat,
      }),
    ],
  });

// 文件输出（如果启用）
if (config.logging.file.enabled) {
  loggerInstance.add(
    new winston.transports.File({
      filename: path.join(config.logging.file.path, 'error.log'),
      level: 'error',
      maxsize: 1024 * 1024, // 1MB
      maxFiles: 1,
    })
  );

  loggerInstance.add(
    new winston.transports.File({
      filename: path.join(config.logging.file.path, 'combined.log'),
      maxsize: 1024 * 1024, // 1MB
      maxFiles: 1,
    })
  );
}

// 请求 URL 会原样进日志（combined.log + UI 的「最近日志」面板）。WebSocket 握手
// 没法带 Authorization header，只能用 ?accessToken=xxx，于是一条 HTTP 日志就等于
// 把一枚有效令牌抄在磁盘上、并推送到所有能看到日志面板的客户端。这里把敏感查询
// 参数的值抹掉，路径部分保留（排查问题要看的是路径）。
const SENSITIVE_QUERY_KEYS = new Set([
  'accesstoken',
  'refreshtoken',
  'token',
  'password',
  'code',
  'secret',
  'api_key',
  'apikey',
  'authorization',
  'auth',
]);

function sanitizeLogUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return rawUrl;
  const qIndex = rawUrl.indexOf('?');
  if (qIndex === -1) return rawUrl;
  const base = rawUrl.slice(0, qIndex);
  const search = rawUrl.slice(qIndex + 1);
  if (!search) return rawUrl;

  const parts = [];
  for (const pair of search.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey).toLowerCase();
    } catch (_) {
      key = rawKey.toLowerCase();
    }
    parts.push(SENSITIVE_QUERY_KEYS.has(key) ? `${rawKey}=***` : pair);
  }
  return `${base}?${parts.join('&')}`;
}

// 自定义日志方法
class Logger {
  /**
   * 记录HTTP请求日志
   */
  static http(req, res, responseTime) {
    const logData = {
      method: req.method,
      url: sanitizeLogUrl(req.url),
      statusCode: res.statusCode,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      responseTime: `${responseTime}ms`,
    };

    if (req.user) {
      logData.userId = req.user.id;
    }
    loggerInstance.info('HTTP Request', logData);
    pushRecent('info', 'HTTP Request', logData);
  }

  /**
   * 记录错误日志
   */
  static error(message, error = null, meta = {}) {
    const logData = {
      ...meta,
    };

    if (error) {
      logData.error = {
        message: error.message,
        stack: error.stack,
      };
    }

    loggerInstance.error(message, logData);
    pushRecent('error', message, logData);
  }

  /**
   * 记录业务操作日志
   */
  static business(operation, userId, details = {}) {
    const meta = {
      operation,
      userId,
      details,
    };
    loggerInstance.info('Business Operation', meta);
    pushRecent('info', 'Business Operation', meta);
  }

  /**
   * 记录数据库操作日志
   */
  static database(operation, query, duration, userId = null) {
    const meta = {
      operation,
      query: this.sanitizeQuery(query),
      duration: `${duration}ms`,
      userId,
    };
    loggerInstance.debug('Database Operation', meta);
    pushRecent('debug', 'Database Operation', meta);
  }

  /**
   * 记录安全相关日志
   */
  static security(event, userId, details = {}) {
    const meta = {
      event,
      userId,
      details,
    };
    // loggerInstance.warn('Security Event', meta);
    pushRecent('warn', 'Security Event', meta);
  }

  /**
   * 记录性能日志
   */
  static performance(operation, duration, details = {}) {
    const meta = {
      operation,
      duration: `${duration}ms`,
      ...details,
    };
    loggerInstance.info('Performance', meta);
    pushRecent('info', 'Performance', meta);
  }

  /**
   * 清理敏感信息的查询
   */
  static sanitizeQuery(query) {
    if (typeof query === 'string') {
      // 移除密码等敏感信息
      return query.replace(/password=['"][^'"]*['"]/gi, "password='***'");
    }
    return query;
  }

  /**
   * 记录调试信息
   */
  static debug(message, meta = {}) {
    loggerInstance.debug(message, meta);
    pushRecent('debug', message, meta);
  }

  /**
   * 记录信息
   */
  static info(message, meta = {}) {
    loggerInstance.info(message, meta);
    pushRecent('info', message, meta);
  }

  /**
   * 记录警告
   */
  static warn(message, meta = {}) {
    loggerInstance.warn(message, meta);
    pushRecent('warn', message, meta);
  }
  static getRecentLogs() {
    return recentLogs.slice(-500);
  }
  static getRecentAfter(lastSeq = 0) {
    return recentLogs.filter(l => (l.seq || 0) > lastSeq);
  }
}

module.exports = Logger;
