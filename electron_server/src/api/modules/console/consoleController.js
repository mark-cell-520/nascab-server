const fs = require('fs');
const os = require('os');
const path = require('path');
const ResponseUtil = require('../../apiUtils/responseUtil');
const Logger = require('../../../utils/logger');
const config = require('../../../config/config');
const userUtil = require('../../../utils/userUtil');

/** 日志查询参数上限，防止一次把整个磁盘读进内存 */
const MAX_LOG_LINES = 1000;
const MAX_LOG_BYTES = 1024 * 1024;

/** 与 hwController 一致的 IPC 取数方式：向主进程要一份硬件指标 */
function requestHwMetrics(timeoutMs = 3000) {
  return new Promise(resolve => {
    if (typeof process.send !== 'function') {
      resolve(null);
      return;
    }
    const requestId = `console_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      process.off('message', onMessage);
    };
    const done = payload => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    };
    const onMessage = message => {
      if (!message || message.type !== 'getHwMetricsResponse') return;
      const incoming = message?.data?.requestId == null ? '' : String(message.data.requestId);
      if (incoming && incoming !== requestId) return;
      const payload = message?.data && typeof message.data === 'object' ? message.data.payload || {} : {};
      done(payload);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    process.on('message', onMessage);
    try {
      process.send({ type: 'getHwMetrics', data: { requestId }, timestamp: Date.now() });
    } catch (err) {
      done(null);
    }
  });
}

/** 控制台展示用的系统静态信息 */
function collectSystemInfo() {
  let packageJson = {};
  try {
    packageJson = require(path.join(config.getRootPath(), 'package.json'));
  } catch (_) {}

  const dataDir = typeof config.getUserDataPath === 'function' ? config.getUserDataPath() : '';
  const logDir = config.logging && config.logging.file ? config.logging.file.path : '';

  return {
    title: config.console.title,
    version: packageJson.version || '',
    productName: packageJson.name || '',
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    cpuModel: (os.cpus() && os.cpus()[0] && os.cpus()[0].model) || '',
    cpuCores: (os.cpus() || []).length,
    totalMemory: os.totalmem(),
    nodeVersion: process.version,
    electron: process.versions.electron || '',
    chrome: process.versions.chrome || '',
    serverId: process.env.SERVER_ID || '',
    dataDir,
    logDir,
    consoleEnabled: config.console.enabled !== false,
    listen: {
      host: config.server.host,
      port: config.app.port,
      httpsPort: config.server.httpsEnabled ? config.server.httpsPort : null,
      httpsEnabled: config.server.httpsEnabled !== false,
    },
    startedAt: Date.now() - Math.round(process.uptime() * 1000),
    uptimeSec: Math.round(process.uptime()),
  };
}

class ConsoleController {
  /**
   * GET /api/console/bootstrap
   * 登录页需要的极简信息：产品名与版本号。不涉及任何服务器细节，
   * 让登录页能显示部署者自定义的 console.title
   */
  getBootstrap = async (req, res) => {
    try {
      let packageJson = {};
      try {
        packageJson = require(path.join(config.getRootPath(), 'package.json'));
      } catch (_) {}
      return ResponseUtil.success(
        req,
        res,
        {
          title: config.console.title,
          version: packageJson.version || '',
          enabled: config.console.enabled !== false,
        },
        'common.SUCCESS'
      );
    } catch (err) {
      Logger.error('Console bootstrap failed', err, { method: 'getBootstrap' });
      return ResponseUtil.serverError(req, res, err);
    }
  };

  /**
   * GET /api/console/overview
   * 控制台首屏一次取全：设备信息 + 硬件指标
   */
  getOverview = async (req, res) => {
    try {
      const system = collectSystemInfo();
      const isAdmin = req.user ? userUtil.isAdmin(req.user) : false;
      // 硬件指标走 IPC，非管理员或取数失败时返回 null，前端显示「无权限/暂无数据」
      const metrics = isAdmin ? await requestHwMetrics() : null;

      return ResponseUtil.success(req, res, { system, metrics }, 'common.SUCCESS');
    } catch (err) {
      Logger.error('Console overview failed', err, { method: 'getOverview' });
      return ResponseUtil.serverError(req, res, err);
    }
  };

  /**
   * GET /api/console/logs?file=combined&lines=200
   * 读取日志文件尾部，供控制台在线查看（不 tail -f，靠前端轮询）
   */
  getLogs = async (req, res) => {
    try {
      const logDir = config.logging && config.logging.file ? config.logging.file.path : '';
      const requested = String(req.query.file || 'combined');
      // 白名单文件名，防止路径穿越
      const allowed = { combined: 'combined.log', error: 'error.log', access: 'access.log' };
      const fileName = allowed[requested];
      if (!fileName) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }

      const filePath = path.join(logDir, fileName);
      const wantLines = Math.min(parseInt(req.query.lines, 10) || 200, MAX_LOG_LINES);

      if (!fs.existsSync(filePath)) {
        return ResponseUtil.success(req, res, { file: fileName, exists: false, lines: [], size: 0 }, 'common.SUCCESS');
      }

      const stat = fs.statSync(filePath);
      // 只读尾部，避免大文件占内存
      const readFrom = Math.max(0, stat.size - MAX_LOG_BYTES);
      const length = stat.size - readFrom;
      const fd = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, readFrom);
        let text = buffer.toString('utf8');
        // 从中间截断时第一行大概率不完整，丢掉
        if (readFrom > 0) {
          const firstBreak = text.indexOf('\n');
          if (firstBreak >= 0) text = text.slice(firstBreak + 1);
        }
        let lines = text.split('\n').filter(line => line.length > 0);
        if (lines.length > wantLines) lines = lines.slice(lines.length - wantLines);
        return ResponseUtil.success(
          req,
          res,
          { file: fileName, exists: true, lines, size: stat.size, truncated: readFrom > 0 },
          'common.SUCCESS'
        );
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      Logger.error('Console logs failed', err, { method: 'getLogs' });
      return ResponseUtil.serverError(req, res, err);
    }
  };
}

const controller = new ConsoleController();
// 供 /api/control 复用：控制接口与 Web 控制台应始终看到同一份系统信息与硬件指标
controller.collectSystemInfo = collectSystemInfo;
controller.requestHwMetrics = requestHwMetrics;

module.exports = controller;
