'use strict';
/**
 * 控制接口独立监听服务
 *
 * 为什么要单独一个端口：控制令牌是 root 级凭证，把它和面向公网的业务端口
 * （6789/6799）混在一起，意味着任何能访问 Web 界面的人都顺带拿到了机器控制面。
 * 拆开后默认只绑 127.0.0.1:6792，本机脚本/Agent 直接用，远程接入交给
 * SSH 隧道或反向代理 + IP 白名单，策略可以单独收紧。
 *
 * 关闭方式：control.port=0（只保留主端口上的 /api/control）
 *          或 control.enabled=false（整个控制接口下线）
 */

const express = require('express');
const path = require('path');
const Logger = require('../utils/logger');
const config = require('../config/config');
const controlTokenUtil = require('../utils/controlTokenUtil');

let _server = null;

/** 控制接口独立 express 应用：只挂控制路由与探针，不挂业务 API */
function createControlApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.get('/healthz', (req, res) => {
    res.status(200).json({ success: true, message: 'OK', service: 'nascab-control' });
  });

  // 请求体解析。上传接口（files/upload）必须是裸字节流，JSON 解析器会把流读掉，
  // 因此显式跳过它——主端口上同理（那边的 bodyParser.json 也只认 application/json）。
  const jsonParser = express.json({ limit: config.upload.maxFileSize });
  const urlencodedParser = express.urlencoded({ limit: config.upload.maxFileSize, extended: true });
  const skipUpload = req => String(req.path || '').startsWith('/api/control/files/upload');
  app.use((req, res, next) => (skipUpload(req) ? next() : jsonParser(req, res, next)));
  app.use((req, res, next) => (skipUpload(req) ? next() : urlencodedParser(req, res, next)));

  // 惰性 require：router 会拉起 dbUtil 等依赖，放到真正启动控制服务时再加载
  app.use('/api/control', require('./modules/control/controlRouter'));
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found', path: req.originalUrl } });
  });
  return app;
}

/**
 * 启动控制接口独立监听
 * @returns {null|import('http').Server} 未启用时返回 null
 */
function startControlServer() {
  if (_server) return _server;

  const control = config.control || {};
  if (!control.enabled) {
    Logger.info('机器控制接口未启用（control.enabled=false）');
    return null;
  }
  const port = Number(control.port) || 0;
  if (port <= 0) {
    Logger.info('控制接口未配置独立端口（control.port=0），仅通过主端口的 /api/control 提供');
    return null;
  }

  try {
    const app = createControlApp();
    const server = app.listen(port, control.host, () => {
      const tokenInfo = controlTokenUtil.getControlInfo();
      const url = `http://${control.host}:${port}/api/control`;
      // cluster 下多个 express worker 都会执行到这里；令牌只由抢到创建权的那个进程完整打印，
      // 其余进程打一行指引，避免启动日志被重复横幅淹没
      if (tokenInfo.tokenClaimed || tokenInfo.tokenSource === 'config') {
        Logger.info(
          `\n================ 机器控制接口已就绪 ================\n` +
            `  地址  : ${url}\n` +
            `  探活  : ${url}/ping（无需令牌）\n` +
            `  令牌  : ${tokenInfo.token}${tokenInfo.tokenSource === 'generated' ? '（自动生成，已写入 ' + tokenInfo.infoFile + '）' : '（来自配置）'}\n` +
            `  用法  : curl -H "Authorization: Bearer <令牌>" ${url}/status\n` +
            `  注意  : 默认只监听本机回环；远程使用请改 control.host 或走 SSH 隧道/反代\n` +
            `==================================================`
        );
      } else {
        Logger.info(`机器控制接口已就绪: ${url}（令牌见 ${tokenInfo.infoFile}）`);
      }
    });
    server.on('error', err => {
      if (err && err.code === 'EADDRINUSE') {
        Logger.error(`控制接口端口 ${control.host}:${port} 被占用，控制接口未启动（不影响主服务）`);
        return;
      }
      Logger.error('控制接口启动失败:', err && err.message ? err.message : err);
    });
    _server = server;
    return server;
  } catch (err) {
    Logger.error('控制接口启动异常:', err && err.message ? err.message : err);
    return null;
  }
}

function stopControlServer() {
  if (!_server) return;
  try {
    _server.close();
  } catch (_) {}
  _server = null;
}

module.exports = {
  startControlServer,
  stopControlServer,
  createControlApp,
  getServer: () => _server,
};
