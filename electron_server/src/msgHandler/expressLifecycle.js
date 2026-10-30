const tableConfig = require('../db/table/tableConfig');

function _safeBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  const s = v === undefined || v === null ? '' : String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

async function ensureP2pConnectWorkerState({ initUtil, serverId }) {
  const enabled = await tableConfig.getP2pRemoteAccessEnabled().catch(() => false);
  const tokenRaw = await tableConfig.getConfigByKey('nascab_token').catch(() => '');
  const hasToken = !!(tokenRaw && String(tokenRaw).trim());
  if (_safeBool(enabled) && hasToken) {
    initUtil.startP2pConnectWorker(serverId);
    return;
  }
  if (_safeBool(enabled) && !hasToken) {
    await tableConfig.setP2pRemoteAccessEnabled(false).catch(() => {});
  }
  await initUtil.stopP2pConnectWorker().catch(() => {});
}

async function ensureDdnsWorkerState({ initUtil, serverId }) {
  const enabledRaw = await tableConfig.getConfigByKey(tableConfig.KEY_DDNS_ENABLED).catch(() => '0');
  const enabled = _safeBool(enabledRaw);
  const tokenRaw = await tableConfig.getConfigByKey('nascab_token').catch(() => '');
  const hasToken = !!(tokenRaw && String(tokenRaw).trim());
  if (enabled && hasToken) {
    initUtil.startDdnsWorker(serverId);
    return;
  }
  if (enabled && !hasToken) {
    await tableConfig.setConfigByKey(tableConfig.KEY_DDNS_ENABLED, '0').catch(() => {});
  }
  await initUtil.stopDdnsWorker().catch(() => {});
}

async function ensureExpressBroadcastWorkerState({ initUtil, httpPort, serverId }) {
  const enabled = await tableConfig.getAutoDiscoverServerEnabled().catch(() => true);
  if (_safeBool(enabled)) {
    initUtil.startExpressBroadcastWorker(httpPort, serverId);
    return;
  }
  await initUtil.stopExpressBroadcastWorker().catch(() => {});
}

function handleExpressStarted({ initUtil, Logger, message, serverId, jwtSecret }) {
  const httpPort = message?.data?.httpPort;
  const httpsPort = message?.data?.httpsPort;
  Logger.info(`✅ API server started: ${httpPort}`);

  if (!initUtil.expressStarted) {
    initUtil.expressStarted = true;
    initUtil.expressHttpPort = httpPort;
    if (httpsPort) initUtil.expressHttpsPort = httpsPort;
    Promise.resolve()
      .then(async () => {
        const http = Number(httpPort);
        const https = Number(httpsPort);
        if (Number.isFinite(http) && http > 0) await tableConfig.saveHttpPort(http);
        if (Number.isFinite(https) && https > 0) await tableConfig.saveHttpsPort(https);
      })
      .catch(() => {});
    Promise.resolve()
      .then(async () => {
        await ensureExpressBroadcastWorkerState({ initUtil, httpPort, serverId });
      })
      .catch(() => {});
    initUtil.startBackgroundTaskWorker(jwtSecret);
    initUtil.startTinyImageWorker();
    Promise.resolve()
      .then(async () => {
        await initUtil.maybeStartSubtitlePreExtractWorker({ requirePending: true });
      })
      .catch(() => {});
    Promise.resolve()
      .then(async () => {
        await ensureP2pConnectWorkerState({ initUtil, serverId });
      })
      .catch(() => {});
    Promise.resolve()
      .then(async () => {
        await ensureDdnsWorkerState({ initUtil, serverId });
      })
      .catch(() => {});
    // 立即推送服务状态到前端，确保界面从「启动中」刷新为已启动
    initUtil.notifyExpressStarted();
  }
}

function handleExpressStartedHttps({ initUtil, Logger, message }) {
  const httpsPort = message?.data?.httpsPort;
  Logger.info(`✅ Express HTTPS listening on port: ${httpsPort}`);
  initUtil.expressHttpsPort = httpsPort;
}

function handleExpressEnded({ initUtil, Logger, httpPort, httpsPort, serverId, jwtSecret }) {
  Logger.info(`🔚 Express stopped: restarting in 5s`);
  setTimeout(() => {
    initUtil.startOneExpressWorker(httpPort, httpsPort, serverId, jwtSecret);
  }, 5000);
}

function handleGetHwMetrics({ expressWorker, initUtil, message }) {
  const requestId = message?.data?.requestId == null ? '' : String(message.data.requestId);
  const send = payload => {
    if (requestId) {
      expressWorker.send({ type: 'getHwMetricsResponse', data: { requestId, payload } });
      return;
    }
    expressWorker.send({ type: 'getHwMetricsResponse', data: payload });
  };
  Promise.resolve()
    .then(async () => {
      if (initUtil && typeof initUtil.touchHwMetricsRequest === 'function') {
        initUtil.touchHwMetricsRequest();
      }
      let payload = initUtil.hwMetricsCache || {};
      const ts = payload && typeof payload.timestamp === 'number' ? payload.timestamp : 0;
      if (!ts || Date.now() - ts > 5000) {
        if (initUtil && typeof initUtil.waitForNextHwMetrics === 'function') {
          try {
            const next = await initUtil.waitForNextHwMetrics(2000);
            if (next && typeof next === 'object') payload = next;
          } catch (_) {}
        }
      }
      send(payload || {});
    })
    .catch(() => {
      send(initUtil.hwMetricsCache || {});
    });
}

function handleRequestAppRestart({ initUtil, Logger, message }) {
  if (initUtil.restartInProgress) return;
  initUtil.restartInProgress = true;
  const userId = message?.data?.userId;
  Logger.info(`🔄 Restart requested${userId ? `: ${userId}` : ''}`);

  setTimeout(() => {
    try {
      const { app } = require('electron');
      if (app && typeof app.relaunch === 'function' && typeof app.quit === 'function') {
        app.relaunch();
        app.quit();
        return;
      }
    } catch (_) {}

    // 无界面模式（Docker）下没有 electron，只能自行退出、交给 supervisord 拉活。
    // 这里绝不能直接 process.exit(0)：singletonWorkerManager 用不带 detached 的
    // child_process.fork 拉起 worker，主进程一退它们就被 init(1) 收养并继续常驻，
    // 每代泄漏 4~5 个进程（photoWatch / videoWatch / musicWatch / backgroundTask /
    // expressBroadcast，实测 5 代合计约 1.2 GB）。残留进程各自持有 chokidar 监听和
    // SQLite 连接，媒体目录被重复监听、索引写入互相覆盖、广播状态陈旧，
    // 最终表现为"功能基本都用不了"——而用户点一次「重启服务」就多泄一代。
    //
    // 因此改走 SIGTERM：main_nascab_os.js 的无界面分支已注册 SIGTERM 处理器，
    // 会先 singletonWorkerManager.gracefulShutdown() 再退出，复用同一条清理链路。
    // 万一处理器没注册上（模块加载顺序变化），SIGTERM 的默认终止语义也与旧行为一致，
    // 不会更糟。
    try {
      process.kill(process.pid, 'SIGTERM');
      // 兜底：gracefulShutdown 对每个 worker 有 5~12s 的停止超时，若 SIGTERM 处理器
      // 本身抛异常或被吞掉，进程会一直不退出，supervisord 等满 stopwaitsecs 后
      // SIGKILL 整组，这一代 worker 照样泄。所以再挂一个足够长的强退定时器。
      const forceExit = setTimeout(() => {
        try {
          process.exit(0);
        } catch (_) {}
      }, 20000);
      if (typeof forceExit.unref === 'function') forceExit.unref();
      return;
    } catch (_) {}

    try {
      process.exit(0);
    } catch (_) {}

    // 两条退出路径都没能终结进程（electron 的 app.quit 抛异常、process.exit
    // 也被吞掉）。此时若继续把 restartInProgress 留在 true，之后所有重启
    // 请求都会被这个函数第一行的 if 静默吞掉，服务再也无法通过该接口重启。
    initUtil.restartInProgress = false;
    Logger.warn('⚠️ Restart requested but the process did not exit; lock released for retry');
  }, 300);
}

function handleEnsureP2pConnectWorker({ initUtil, serverId }) {
  Promise.resolve()
    .then(async () => {
      await ensureP2pConnectWorkerState({ initUtil, serverId });
    })
    .catch(() => {});
}

function handleEnsureDdnsWorker({ initUtil, serverId }) {
  Promise.resolve()
    .then(async () => {
      await ensureDdnsWorkerState({ initUtil, serverId });
    })
    .catch(() => {});
}

function handleRestartP2pConnectWorker({ initUtil, serverId }) {
  Promise.resolve()
    .then(async () => {
      await initUtil.stopP2pConnectWorker().catch(() => {});
      await ensureP2pConnectWorkerState({ initUtil, serverId });
    })
    .catch(() => {});
}

function handleEnsureTinyImageWorker({ initUtil }) {
  try {
    initUtil.startTinyImageWorker();
  } catch (_) {}
}

function handleSetP2pRemoteAccessEnabled({ initUtil, message, serverId, expressWorker }) {
  const enabled = _safeBool(message?.data?.enabled);
  Promise.resolve()
    .then(async () => {
      await tableConfig.setP2pRemoteAccessEnabled(enabled);
      await ensureP2pConnectWorkerState({ initUtil, serverId });
      if (expressWorker && typeof expressWorker.send === 'function') {
        expressWorker.send({ type: 'setP2pRemoteAccessEnabledResponse', data: { ok: true, enabled } });
      }
    })
    .catch(() => {
      if (expressWorker && typeof expressWorker.send === 'function') {
        expressWorker.send({ type: 'setP2pRemoteAccessEnabledResponse', data: { ok: false, enabled } });
      }
    });
}

function handleSetDdnsEnabled({ initUtil, message, serverId, expressWorker }) {
  const enabled = _safeBool(message?.data?.enabled);
  Promise.resolve()
    .then(async () => {
      await tableConfig.setConfigByKey(tableConfig.KEY_DDNS_ENABLED, enabled ? '1' : '0').catch(() => {});
      await ensureDdnsWorkerState({ initUtil, serverId });
      if (expressWorker && typeof expressWorker.send === 'function') {
        expressWorker.send({ type: 'setDdnsEnabledResponse', data: { ok: true, enabled } });
      }
    })
    .catch(() => {
      if (expressWorker && typeof expressWorker.send === 'function') {
        expressWorker.send({ type: 'setDdnsEnabledResponse', data: { ok: false, enabled } });
      }
    });
}

function handleSetAutoDiscoverServerEnabled({ initUtil, message, serverId, expressWorker }) {
  const enabled = _safeBool(message?.data?.enabled);
  const httpPort = initUtil?.expressHttpPort;
  Promise.resolve()
    .then(async () => {
      await tableConfig.setAutoDiscoverServerEnabled(enabled);
      await ensureExpressBroadcastWorkerState({ initUtil, httpPort, serverId });
      if (expressWorker && typeof expressWorker.send === 'function') {
        expressWorker.send({ type: 'setAutoDiscoverServerEnabledResponse', data: { ok: true, enabled } });
      }
    })
    .catch(() => {
      if (expressWorker && typeof expressWorker.send === 'function') {
        expressWorker.send({ type: 'setAutoDiscoverServerEnabledResponse', data: { ok: false, enabled } });
      }
    });
}

function handleIpcProxyHttpRes({ initUtil, message }) {
  const id = message?.id == null ? '' : String(message.id);
  if (!id) return;
  const pending = initUtil && initUtil.p2pIpcProxyPending instanceof Map ? initUtil.p2pIpcProxyPending : null;
  if (!pending) return;
  const item = pending.get(id);
  if (!item) return;
  pending.delete(id);
  try {
    if (item.worker && typeof item.worker.send === 'function') {
      item.worker.send({ type: 'ipcProxy:http:res', id, data: message.data });
    }
  } catch (_) {}
}

function handleGetMountLibsStatus({ expressWorker, message }) {
  const requestId = message?.data?.requestId == null ? '' : String(message.data.requestId);
  const send = payload => {
    if (requestId) {
      expressWorker.send({ type: 'getMountLibsStatusResponse', data: { requestId, payload } });
      return;
    }
    expressWorker.send({ type: 'getMountLibsStatusResponse', data: payload });
  };
  try {
    const remoteAssets = require('../utils/remoteAssetsManager');
    send(remoteAssets.getMountLibsStatus());
  } catch (_) {
    send({ enabled: false, syncing: false, fileMountReady: true, openlistMountReady: true, fileServerReady: true, libs: {} });
  }
}

module.exports = {
  expressStarted: handleExpressStarted,
  expressStartedHttps: handleExpressStartedHttps,
  expressEnded: handleExpressEnded,
  getHwMetrics: handleGetHwMetrics,
  getMountLibsStatus: handleGetMountLibsStatus,
  requestAppRestart: handleRequestAppRestart,
  ensureP2pConnectWorker: handleEnsureP2pConnectWorker,
  ensureDdnsWorker: handleEnsureDdnsWorker,
  restartP2pConnectWorker: handleRestartP2pConnectWorker,
  ensureTinyImageWorker: handleEnsureTinyImageWorker,
  setP2pRemoteAccessEnabled: handleSetP2pRemoteAccessEnabled,
  setDdnsEnabled: handleSetDdnsEnabled,
  setAutoDiscoverServerEnabled: handleSetAutoDiscoverServerEnabled,
  'ipcProxy:http:res': handleIpcProxyHttpRes,
};
