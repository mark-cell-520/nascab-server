const fs = require('fs');
const path = require('path');
const Logger = require('../../../../../utils/logger');
const { decodeJWT } = require('../../../../middleware/authMiddleware');
const { hasPermission, parseScopedAllow, matchApi } = require('../../../../../utils/permissionUtil');

async function calculateStats(itemPath, stats, onProgress, signal, isRoot = false) {
  if (signal && signal.aborted) return;

  try {
    const itemStat = await fs.promises.stat(itemPath);
    if (itemStat.isDirectory()) {
      if (!isRoot) {
        stats.folderCount += 1;
      }
      const files = await fs.promises.readdir(itemPath);
      for (const file of files) {
        if (signal && signal.aborted) {
          return;
        }
        await calculateStats(path.join(itemPath, file), stats, onProgress, signal, false);
      }
    } else {
      stats.size += itemStat.size;
      stats.count += 1;
      if (stats.count % 100 === 0) {
        onProgress();
      }
    }
  } catch (err) {}
}

module.exports = app => {
  app.ws('/api/file/stats', async (ws, req) => {
    let abortController = new AbortController();

    // 这个 WS 原来完全没有任何鉴权：拿到地址就能让它遍历任意路径并回传
    // 文件数/总大小/目录树时间戳，等于一个不需要登录的目录枚举接口。
    // 浏览器没法给 WebSocket 握手带头，所以和 /api/file/watch 一样从
    // query 里取 accessToken，再逐条路径走 hasPermission。
    let user = null;
    try {
      const accessToken = req.query && req.query.accessToken;
      if (!accessToken) {
        ws.close(4001, 'accessToken is empty');
        return;
      }
      user = decodeJWT(req, String(accessToken));
      if (!user) {
        ws.close(4001, 'invalid accessToken');
        return;
      }
      user.id = user.userId || user.id || user.uid || user.user_id;

      if (user.tokenType === 'scoped') {
        const now = new Date();
        const tokenRecord = await req.dbMain('user_token')
          .where({ token: String(accessToken), is_valid: true, type: 'scoped' })
          .andWhere('expire_time', '>', now)
          .first();
        if (!tokenRecord) {
          ws.close(4001, 'invalid accessToken');
          return;
        }
        const allowApi = parseScopedAllow(tokenRecord.allow_api);
        if (!matchApi(allowApi, '/api/file/stats')) {
          ws.close(4001, 'no permission');
          return;
        }
        user.allow_api = allowApi;
        user.allow_path = parseScopedAllow(tokenRecord.allow_path);
      }
    } catch (e) {
      Logger.error('[fileStats] auth check failed', e && e.message ? e.message : e);
      ws.close(4001, 'auth check failed');
      return;
    }

    const sendJson = payload => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    ws.on('message', async msg => {
      try {
        const data = JSON.parse(msg);
        const { paths, action } = data;

        if (action === 'cancel') {
          abortController.abort();
          abortController = new AbortController();
          return;
        }

        if (!paths || !Array.isArray(paths)) {
          return;
        }

        // 权限按请求里的每条路径单独判：scoped 令牌可能只放开了一个子目录，
        // 而 paths 是可以一次传多个的。
        for (const p of paths) {
          const ok = await hasPermission(req.dbMain, user, 'view', String(p || ''));
          if (!ok) {
            sendJson({ type: 'error', message: 'no permission' });
            return;
          }
        }

        abortController.abort();
        abortController = new AbortController();
        const signal = abortController.signal;

        const stats = {
          size: 0,
          count: 0,
          folderCount: 0,
          ctime: null,
          mtime: null,
          name: '',
          path: '',
        };

        if (paths.length === 1) {
          try {
            const p = paths[0];
            const stat = await fs.promises.stat(p);
            stats.ctime = stat.birthtime;
            stats.mtime = stat.mtime;
            stats.name = path.basename(p);
            stats.path = p;
          } catch (e) {
            Logger.error('Error getting basic stat', e);
          }
        }

        const sendProgress = () => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'progress', ...stats }));
          }
        };

        sendProgress();

        for (const p of paths) {
          if (signal.aborted) break;
          await calculateStats(p, stats, sendProgress, signal, true);
        }

        if (!signal.aborted && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'complete', ...stats }));
        }
      } catch (err) {
        Logger.error('File stats error:', err);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
      }
    });

    ws.on('close', () => {
      abortController.abort();
    });
  });
};
