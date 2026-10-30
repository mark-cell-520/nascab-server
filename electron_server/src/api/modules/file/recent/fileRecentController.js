const path = require('path');
const fs = require('fs');
const ResponseUtil = require('../../../apiUtils/responseUtil');
const tableFileRecent = require('../../../../db/table/tableFileRecent');
const config = require('../../../../config/config');

const RECENT_KEEP_LIMIT = 100;

/**
 * 最近访问列表。
 * 客户端（file_api_service.dart 的 listRecent）直接把 res.data 当数组用，
 * 因此这里必须返回数组本身，而不是 { items: [...] }。
 */
async function list(req, res) {
  try {
    const uid = req.user && req.user.id;
    if (!uid) return ResponseUtil.error(req, res, 'auth.AUTHENTICATION_REQUIRED', 401);

    const connection = { knex: req.dbMain };
    const rows = await tableFileRecent.listRecentByUid(uid, RECENT_KEEP_LIMIT, connection);

    const list = Array.isArray(rows) ? rows : [];
    const itemsByIndex = new Array(list.length);
    const missingPaths = new Set();

    const concurrency = Math.min(16, list.length);
    let cursor = 0;
    async function runOne() {
      while (true) {
        const i = cursor++;
        if (i >= list.length) return;
        const r = list[i];
        const p = r && r.path ? String(r.path) : '';
        if (!p) continue;
        try {
          const st = await fs.promises.stat(p);
          const isDir = !st.isFile();
          const size = !isDir ? st.size : null;
          const mtimeMs = st.mtimeMs;
          const ext = isDir ? '' : path.extname(p).toLowerCase();
          const type = config.getFileType(ext);
          itemsByIndex[i] = {
            path: p,
            name: path.basename(p) || p,
            type: isDir ? 'dir' : type,
            size,
            mtimeMs,
            ext,
          };
        } catch (_) {
          missingPaths.add(p);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => runOne()));

    if (missingPaths.size > 0) {
      await tableFileRecent.deleteByUidAndPaths(uid, Array.from(missingPaths), connection);
    }

    const items = itemsByIndex.filter(Boolean);
    if (list.length >= RECENT_KEEP_LIMIT) {
      setImmediate(() => {
        tableFileRecent.cleanupByUid(uid, RECENT_KEEP_LIMIT, connection).catch(() => {});
      });
    }

    return ResponseUtil.success(req, res, items, 'file.RECENT_SUCCESS', 200);
  } catch (err) {
    console.log(err);
    return ResponseUtil.error(req, res, 'file.RECENT_FAILED', 400, {
      error: err.message,
    });
  }
}

async function clear(req, res) {
  try {
    const uid = req.user && req.user.id;
    if (!uid) return ResponseUtil.error(req, res, 'auth.AUTHENTICATION_REQUIRED', 401);
    const connection = { knex: req.dbMain };
    await tableFileRecent.deleteAllByUid(uid, connection);
    return ResponseUtil.success(req, res, { ok: true }, 'file.RECENT_CLEAR_SUCCESS', 200);
  } catch (err) {
    console.log(err);
    return ResponseUtil.error(req, res, 'file.RECENT_CLEAR_FAILED', 400, {
      error: err.message,
    });
  }
}

module.exports = {
  list,
  clear,
};
