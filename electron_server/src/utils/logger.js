const winston = require('winston');
const path = require('path');
const fs = require('fs');
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

/**
 * 解析可用的日志目录
 * 服务器部署时应用根目录可能是只读挂载，写不进去要回退到用户数据目录
 */
function resolveLogDir() {
  const candidates = [];
  const configured = config.logging.file.path;
  if (configured) candidates.push(configured);
  // 回退候选：用户数据目录下的 logs
  try {
    if (typeof config.getUserDataPath === 'function') {
      candidates.push(path.join(config.getUserDataPath(), 'logs'));
    }
  } catch (_) {}
  candidates.push(path.join(process.cwd(), 'logs'));

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // 探测可写性
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      return dir;
    } catch (_) {
      // 换下一个候选
    }
  }
  return null;
}

// 文件输出（如果启用）
if (config.logging.file.enabled) {
  const logDir = resolveLogDir();
  if (!logDir) {
    console.warn('[logger] 没有可写的日志目录，文件日志已禁用');
  } else {
    const rotate = config.logging.rotate || {};
    const maxSize = Number(rotate.maxSize) > 0 ? Number(rotate.maxSize) : 20 * 1024 * 1024;
    const maxFiles = Number(rotate.maxFiles) > 0 ? Number(rotate.maxFiles) : 10;

    loggerInstance.add(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: maxSize,
        maxFiles: maxFiles,
      })
    );

    loggerInstance.add(
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        maxsize: maxSize,
        maxFiles: maxFiles,
      })
    );

    // 单独的访问日志文件，避免访问日志把业务日志冲散
    if (config.logging.accessLog) {
      // winston 的 npm 级别中 http 低于 info；主 logger 级别为 info 时访问日志会被过滤掉，
      // 这里按需放宽到 http，保证 access.log 能写进去
      const LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
      const curIdx = LEVELS.indexOf(loggerInstance.level);
      const httpIdx = LEVELS.indexOf('http');
      if (curIdx === -1 || curIdx > httpIdx) {
        loggerInstance.level = 'http';
      }

      loggerInstance.add(
        new winston.transports.File({
          filename: path.join(logDir, 'access.log'),
          level: 'http',
          maxsize: maxSize,
          maxFiles: maxFiles,
        })
      );
    }

    console.log(`[logger] 日志目录: ${logDir} (单文件上限 ${Math.round(maxSize / 1048576)}MB, 保留 ${maxFiles} 个)`);
  }
}

// 自定义日志方法
class Logger {
  /**
   * 记录HTTP请求日志
   * 使用 winston 内置的 http 级别（位于 info 与 verbose 之间），
   * 便于单独写入 access.log 而不混入业务日志
   */
  static http(req, res, responseTime) {
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      responseTime: `${responseTime}ms`,
    };

    if (req.user) {
      logData.userId = req.user.id;
    }
    loggerInstance.http('HTTP Request', logData);
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
