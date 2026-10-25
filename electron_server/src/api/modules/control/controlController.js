'use strict';
/**
 * 机器控制接口（/api/control）
 *
 * 目标读者是脚本与 AI Agent，因此约定与面向人的 Web 控制台刻意不同：
 *   1. 响应统一为 { ok, data, error }，不带国际化信封，不随界面改版而变
 *   2. 路径一律用「服务端绝对路径」，不做相对解析，也不做用户视角的虚拟目录
 *   3. 每个接口都能独立调用，不依赖前置步骤（无状态、可重试）
 *   4. 令牌走 Authorization: Bearer 或 X-NasCab-Token，查询串 ?token= 仅用于下载直链
 *
 * 能力面：状态/日志/共享目录/文件增删改查与传输/下载器/容器。
 * 这是 root 级接口——见 controlAuth.js 的说明。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const ResponseUtil = require('../../apiUtils/responseUtil');
const Logger = require('../../../utils/logger');
const config = require('../../../config/config');
const controlTokenUtil = require('../../../utils/controlTokenUtil');
const userShareFolderUtil = require('../../../utils/userShareFolderUtil');
const { delegate } = require('./controlDelegate');

// 复用的控制器（与控制台同一套实现）
const consoleController = require('../console/consoleController');
const fileMkdirController = require('../file/mkdir/fileMkdirController');
const fileRenameController = require('../file/rename/fileRenameController');
const fileDeleteController = require('../file/delete/fileDeleteController');
const transmissionController = require('../transmission/transmissionController');
const dockerController = require('../docker/dockerController');

/** 单次上传体积上限：控制接口是流式落盘，但仍是单请求，给个上限避免误用 */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 * 1024;
/** 单次列目录条目上限，防止把巨型目录一次拉爆内存 */
const MAX_LIST_ENTRIES = 20000;

function ok(res, data) {
  return res.json({ ok: true, data: data === undefined ? null : data });
}

function fail(res, statusCode, code, message, extra) {
  return res.status(statusCode).json({
    ok: false,
    error: Object.assign({ code, message }, extra || {}),
  });
}

function isAbsoluteLikePath(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('\\\\') || v.startsWith('\\')) return true;
  return /^[a-zA-Z]:[\\/]/.test(v);
}

/** 解析并校验绝对路径（控制接口只接受绝对路径，避免相对路径落到意想不到的地方） */
function resolveAbsPath(raw, res) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) {
    fail(res, 400, 'PATH_REQUIRED', '缺少 path 参数（服务端绝对路径）');
    return null;
  }
  if (!isAbsoluteLikePath(v)) {
    fail(res, 400, 'PATH_NOT_ABSOLUTE', `path 必须是服务端绝对路径：${v}`);
    return null;
  }
  return path.resolve(v);
}

/**
 * 校验「单个文件/目录名」
 * 不再静默剥掉路径分隔符——带分隔符的名字一律视为非法，
 * 否则 '../x' 这种输入会被洗成 '..x' 悄悄落到目录里，排查时对不上号
 */
function safeFileName(raw) {
  if (typeof raw !== 'string') return '';
  const name = raw.trim();
  if (!name) return '';
  if (name.includes('/') || name.includes('\\')) return '';
  if (name === '.' || name === '..') return '';
  // Windows 保留名与尾部点/空格（CON、PRN、aux、nul、com1..com9、lpt1..lpt9）
  if (/[. ]$/.test(name)) return '';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) return '';
  return name;
}

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = num / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

function statEntry(fullPath, name) {
  let st = null;
  try {
    st = fs.statSync(fullPath);
  } catch (_) {
    return null;
  }
  const isDir = st.isDirectory();
  return {
    name: name || path.basename(fullPath),
    path: fullPath,
    type: isDir ? 'dir' : 'file',
    size: isDir ? null : st.size,
    sizeText: isDir ? '—' : formatBytes(st.size),
    mtime: st.mtimeMs,
    ext: isDir ? '' : path.extname(fullPath).replace('.', '').toLowerCase(),
  };
}

class ControlController {
  /**
   * GET /api/control/ping
   * 公开探活：不需要令牌。供客户端判断「这个端口是不是 NasCab 控制接口」
   */
  ping = async (req, res) => {
    let packageJson = {};
    try {
      packageJson = require(path.join(config.getRootPath(), 'package.json'));
    } catch (_) {}
    return ok(res, {
      service: 'nascab-control',
      title: config.console.title,
      version: packageJson.version || '',
      time: Date.now(),
      hostname: os.hostname(),
      auth: 'Bearer <control token> 或 X-NasCab-Token 头',
    });
  };

  /**
   * GET /api/control/info
   * 部署信息：版本、目录、端口、控制接口自身配置（不含令牌）
   */
  info = async (req, res) => {
    const system = consoleController.collectSystemInfo();
    const controlInfo = controlTokenUtil.getControlInfo();
    return ok(res, {
      title: system.title,
      version: system.version,
      hostname: system.hostname,
      platform: system.platform,
      arch: system.arch,
      nodeVersion: system.nodeVersion,
      electron: system.electron,
      dataDir: system.dataDir,
      logDir: system.logDir,
      listen: system.listen,
      startedAt: system.startedAt,
      uptimeSec: system.uptimeSec,
      control: {
        enabled: controlInfo.enabled === true,
        host: controlInfo.host,
        port: controlInfo.port,
        tokenSource: controlInfo.tokenSource,
        tokenFile: controlInfo.infoFile,
        endpoints: [
          'GET    /api/control/ping',
          'GET    /api/control/info',
          'GET    /api/control/status',
          'GET    /api/control/logs',
          'GET    /api/control/shares',
          'POST   /api/control/shares',
          'POST   /api/control/shares/remove',
          'GET    /api/control/files',
          'POST   /api/control/files/mkdir',
          'POST   /api/control/files/rename',
          'POST   /api/control/files/delete',
          'POST   /api/control/files/upload',
          'GET    /api/control/files/download',
          'GET    /api/control/files/stat',
          'GET    /api/control/downloads',
          'POST   /api/control/downloads/add',
          'POST   /api/control/downloads/action',
          'GET    /api/control/docker/status',
          'GET    /api/control/docker/containers',
          'GET    /api/control/docker/images',
          'POST   /api/control/docker/container',        ],
      },
    });
  };

  /**
   * GET /api/control/status
   * 一屏看全：系统信息 + 硬件指标 + 共享目录 + 磁盘
   */
  status = async (req, res) => {
    try {
      const system = consoleController.collectSystemInfo();
      const metrics = await consoleController.requestHwMetrics();
      const shares = await userShareFolderUtil.getUserShareFoldersWithStats();

      const disks = [];
      try {
        const seen = new Set();
        for (const share of shares) {
          if (!share.exists) continue;
          const root = path.parse(share.path).root;
          if (!root || seen.has(root)) continue;
          seen.add(root);
          const st = await fs.promises.statfs(root);
          disks.push({
            mount: root,
            total: st.bsize * st.blocks,
            free: st.bsize * st.bfree,
            used: st.bsize * (st.blocks - st.bfree),
          });
        }
      } catch (_) {}

      return ok(res, {
        system,
        metrics,
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          used: os.totalmem() - os.freemem(),
        },
        disks,
        shares: shares.map(s => ({
          path: s.path,
          name: s.name,
          exists: s.exists,
          allowDownload: s.allowDownload,
          mtime: s.mtimeMs,
        })),
        shareCount: shares.length,
      });
    } catch (err) {
      Logger.error('Control status failed', err, { method: 'status' });
      return fail(res, 500, 'STATUS_FAILED', err && err.message ? err.message : String(err));
    }
  };

  /**
   * GET /api/control/logs?file=combined|error|access&lines=200
   */
  logs = async (req, res) => {
    const result = await delegate(consoleController.getLogs, {
      method: 'GET',
      url: '/api/console/logs',
      query: { file: req.query.file, lines: req.query.lines },
    });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'LOGS_FAILED', (result.error && result.error.message) || '读取日志失败');
    }
    return ok(res, result.data);
  };

  /**
   * GET /api/control/shares
   */
  shares = async (req, res) => {
    try {
      const list = await userShareFolderUtil.getUserShareFoldersWithStats();
      return ok(res, { items: list, count: list.length });
    } catch (err) {
      return fail(res, 500, 'SHARES_FAILED', err && err.message ? err.message : String(err));
    }
  };

  /**
   * POST /api/control/shares  { path, name?, allowDownload? }
   */
  addShare = async (req, res) => {
    const target = resolveAbsPath(req.body && req.body.path, res);
    if (!target) return undefined;
    let st;
    try {
      st = fs.statSync(target);
    } catch (_) {
      return fail(res, 400, 'PATH_NOT_FOUND', `目录不存在：${target}`);
    }
    if (!st.isDirectory()) {
      return fail(res, 400, 'PATH_NOT_DIR', `不是目录：${target}`);
    }
    try {
      const list = await userShareFolderUtil.getUserShareFolders({ includeMissing: true });
      const name = req.body && req.body.name ? String(req.body.name).trim() : '';
      const allowDownload = req.body && req.body.allowDownload !== undefined ? !!req.body.allowDownload : true;
      const next = list.filter(i => i.path !== target);
      next.push({ path: target, name: name || path.basename(target), allowDownload });
      await userShareFolderUtil.saveUserShareFolders(next);
      const after = await userShareFolderUtil.getUserShareFoldersWithStats();
      return ok(res, { items: after, count: after.length, added: target });
    } catch (err) {
      return fail(res, 500, 'SHARE_ADD_FAILED', err && err.message ? err.message : String(err));
    }
  };

  /**
   * POST /api/control/shares/remove  { path }
   */
  removeShare = async (req, res) => {
    const target = resolveAbsPath(req.body && req.body.path, res);
    if (!target) return undefined;
    try {
      const list = await userShareFolderUtil.getUserShareFolders({ includeMissing: true });
      const next = list.filter(i => i.path !== target);
      const removed = next.length !== list.length;
      await userShareFolderUtil.saveUserShareFolders(next);
      const after = await userShareFolderUtil.getUserShareFoldersWithStats();
      return ok(res, { removed, items: after, count: after.length });
    } catch (err) {
      return fail(res, 500, 'SHARE_REMOVE_FAILED', err && err.message ? err.message : String(err));
    }
  };

  /**
   * GET /api/control/files?path=<绝对路径>
   * 列目录。path 省略时返回共享目录根列表
   */
  listFiles = async (req, res) => {
    const raw = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!raw) {
      const shares = await userShareFolderUtil.getUserShareFoldersWithStats();
      return ok(res, {
        path: '',
        parent: null,
        isRoot: true,
        items: shares.map(s => ({
          name: s.name,
          path: s.path,
          type: 'dir',
          size: null,
          sizeText: '—',
          mtime: s.mtimeMs,
          ext: '',
          exists: s.exists,
          allowDownload: s.allowDownload,
          isShare: true,
        })),
      });
    }

    const target = resolveAbsPath(raw, res);
    if (!target) return undefined;
    let st;
    try {
      st = fs.statSync(target);
    } catch (_) {
      return fail(res, 404, 'PATH_NOT_FOUND', `路径不存在：${target}`);
    }
    if (!st.isDirectory()) {
      // 传的是文件：退回文件信息，方便脚本少调一次 stat
      const entry = statEntry(target, path.basename(target));
      return ok(res, { path: target, parent: path.dirname(target), isRoot: false, isFile: true, items: [entry] });
    }

    let names;
    try {
      names = fs.readdirSync(target);
    } catch (err) {
      return fail(res, 403, 'DIR_NOT_READABLE', `无法读取目录：${err && err.message ? err.message : err}`);
    }
    names.sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const items = [];
    for (const name of names.slice(0, MAX_LIST_ENTRIES)) {
      const entry = statEntry(path.join(target, name), name);
      if (entry) items.push(entry);
    }
    // 目录排前面，文件按名称，和常见文件管理器一致
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'zh-CN');
    });

    const parent = path.dirname(target);
    return ok(res, {
      path: target,
      parent: parent === target ? null : parent,
      isRoot: false,
      truncated: names.length > MAX_LIST_ENTRIES,
      total: names.length,
      items,
    });
  };

  /**
   * GET /api/control/files/stat?path=
   */
  statFile = async (req, res) => {
    const target = resolveAbsPath(req.query.path, res);
    if (!target) return undefined;
    const entry = statEntry(target, path.basename(target));
    if (!entry) return fail(res, 404, 'PATH_NOT_FOUND', `路径不存在：${target}`);
    try {
      const st = fs.statSync(target);
      entry.birthtime = st.birthtimeMs;
      entry.mode = st.mode;
    } catch (_) {}
    return ok(res, entry);
  };

  /**
   * POST /api/control/files/mkdir  { path }  path 为要创建的目录全路径
   */
  mkdir = async (req, res) => {
    const target = resolveAbsPath(req.body && req.body.path, res);
    if (!target) return undefined;
    const result = await delegate(fileMkdirController.mkdir, {
      body: { base: path.dirname(target), name: path.basename(target) },
    });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'MKDIR_FAILED', (result.error && result.error.message) || '创建目录失败');
    }
    return ok(res, { path: target, created: true });
  };

  /**
   * POST /api/control/files/rename  { path, newName }
   */
  rename = async (req, res) => {
    const target = resolveAbsPath(req.body && req.body.path, res);
    if (!target) return undefined;
    const newName = safeFileName(req.body && req.body.newName);
    if (!newName) return fail(res, 400, 'NAME_REQUIRED', 'newName 不能为空且不能包含路径分隔符');
    const result = await delegate(fileRenameController.rename, {
      body: { path: target, newName },
    });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'RENAME_FAILED', (result.error && result.error.message) || '重命名失败');
    }
    return ok(res, { from: target, to: path.join(path.dirname(target), newName), renamed: true });
  };

  /**
   * POST /api/control/files/delete  { paths: [...], recycle?: false }
   */
  deleteFiles = async (req, res) => {
    const rawPaths = (req.body && req.body.paths) || (req.body && req.body.path ? [req.body.path] : []);
    if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
      return fail(res, 400, 'PATHS_REQUIRED', 'paths 必须是非空数组');
    }
    const paths = rawPaths.map(p => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
    for (const p of paths) {
      if (!isAbsoluteLikePath(p)) {
        return fail(res, 400, 'PATH_NOT_ABSOLUTE', `path 必须是服务端绝对路径：${p}`);
      }
    }
    const result = await delegate(fileDeleteController.remove, {
      body: {
        paths: paths.map(p => path.resolve(p)),
        recycle: !!(req.body && req.body.recycle),
        deleteScrapeFiles: !!(req.body && req.body.deleteScrapeFiles),
      },
    });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'DELETE_FAILED', (result.error && result.error.message) || '删除失败');
    }
    return ok(res, { deleted: paths.map(p => path.resolve(p)) });
  };

  /**
   * GET /api/control/files/download?path=
   * 直接流式下载，带 Content-Disposition；支持 Range（断点续传由 express 处理）
   */
  download = async (req, res) => {
    const target = resolveAbsPath(req.query.path, res);
    if (!target) return undefined;
    let st;
    try {
      st = fs.statSync(target);
    } catch (_) {
      return fail(res, 404, 'PATH_NOT_FOUND', `路径不存在：${target}`);
    }
    if (st.isDirectory()) {
      return fail(res, 400, 'PATH_IS_DIR', '目录暂不支持打包下载，请指定文件');
    }
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-NasCab-File-Path', encodeURIComponent(target));
    return res.download(target, path.basename(target), err => {
      if (err && !res.headersSent) {
        fail(res, 500, 'DOWNLOAD_FAILED', err.message || String(err));
      }
    });
  };

  /**
   * POST /api/control/files/upload?path=<目录>&name=<文件名>
   * 请求体为文件原始字节（流式落盘，不整块进内存）。
   *
   * path 的语义分两种，和 scp/curl -T 的直觉一致：
   *   - 显式给了文件名（name 查询参数 / X-Filename 头 / Content-Disposition）
   *     → path 必须是「已存在的目录」
   *   - 没给文件名 → path 就是「目标文件全路径」
   */
  upload = async (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!rawPath) {
      return fail(res, 400, 'PATH_REQUIRED', '缺少 path 查询参数（目标目录或目标文件绝对路径）');
    }
    if (!isAbsoluteLikePath(rawPath)) {
      return fail(res, 400, 'PATH_NOT_ABSOLUTE', `path 必须是服务端绝对路径：${rawPath}`);
    }
    const resolved = path.resolve(rawPath);

    let fileName = safeFileName(req.query.name);
    if (!fileName) {
      const headerName = req.get('x-filename') || req.get('x-nascab-filename');
      if (headerName) fileName = safeFileName(decodeURIComponent(String(headerName)));
    }
    if (!fileName) {
      const cd = req.get('content-disposition');
      if (cd) {
        const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
        if (m) fileName = safeFileName(decodeURIComponent(m[1]));
      }
    }

    let st = null;
    try {
      st = fs.statSync(resolved);
    } catch (_) {}

    let dir;
    if (fileName) {
      // 显式文件名：path 必须是已存在目录
      if (!st || !st.isDirectory()) {
        return fail(res, 400, 'DIR_NOT_FOUND', `目标目录不存在或不是目录：${resolved}`);
      }
      dir = resolved;
    } else if (st && st.isDirectory()) {
      // 目录但没给名字：自动命名，避免把请求写成一个奇怪的文件
      dir = resolved;
      fileName = `upload-${Date.now()}.bin`;
    } else {
      // 按「目标文件全路径」处理
      dir = path.dirname(resolved);
      fileName = path.basename(resolved);
    }

    let dirStat = null;
    try {
      dirStat = fs.statSync(dir);
    } catch (_) {}
    if (!dirStat || !dirStat.isDirectory()) {
      return fail(res, 400, 'DIR_NOT_FOUND', `目标目录不存在：${dir}`);
    }
    if (!fileName || fileName === '.' || fileName === '..') {
      return fail(res, 400, 'NAME_REQUIRED', '无法确定上传文件名，请用 name 查询参数或 X-Filename 头指定');
    }

    const dest = path.join(dir, fileName);
    let received = 0;
    let stream = null;
    try {
      stream = fs.createWriteStream(dest);
    } catch (err) {
      return fail(res, 500, 'OPEN_FAILED', `无法写入目标文件：${err && err.message ? err.message : err}`);
    }

    let aborted = false;
    const cleanup = () => {
      if (aborted) return;
      aborted = true;
      try {
        req.unpipe(stream);
      } catch (_) {}
      try {
        stream.destroy();
      } catch (_) {}
    };

    req.on('aborted', cleanup);
    stream.on('error', err => {
      cleanup();
      if (!res.headersSent) {
        fail(res, 500, 'WRITE_FAILED', `写入失败：${err && err.message ? err.message : err}`);
      }
    });

    req.on('data', chunk => {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        cleanup();
        try {
          fs.unlinkSync(dest);
        } catch (_) {}
        if (!res.headersSent) {
          fail(res, 413, 'UPLOAD_TOO_LARGE', `上传超过单请求上限 ${formatBytes(MAX_UPLOAD_BYTES)}，请分片上传`);
        }
      }
    });

    stream.on('close', () => {
      if (aborted || res.headersSent) return;
      let finalStat = null;
      try {
        finalStat = fs.statSync(dest);
      } catch (_) {}
      ok(res, {
        path: dest,
        name: fileName,
        size: finalStat ? finalStat.size : received,
        received,
      });
    });

    req.pipe(stream);
    return undefined;
  };

  /**
   * GET /api/control/downloads
   * 下载器（Transmission）状态与任务列表
   */
  downloads = async (req, res) => {
    const status = await delegate(transmissionController.getStatus, { method: 'GET', url: '/api/transmission/status' });
    const torrents = await delegate(transmissionController.listTorrents, {
      method: 'GET',
      url: '/api/transmission/torrents/list',
      query: req.query || {},
    });
    return ok(res, {
      daemon: status.ok ? status.data : null,
      daemonOk: status.ok,
      daemonError: status.ok ? null : status.error,
      torrents: torrents.ok && torrents.data && Array.isArray(torrents.data.torrents) ? torrents.data.torrents : [],
      torrentsOk: torrents.ok,
      torrentsError: torrents.ok ? null : torrents.error,
    });
  };

  /**
   * POST /api/control/downloads/add  { url?, filename?, download_dir, paused? }
   */
  addDownload = async (req, res) => {
    const body = req.body || {};
    if (!body.url && !body.filename) {
      return fail(res, 400, 'URL_REQUIRED', '需要 url（磁力/HTTP 链接）或 filename（服务端 .torrent 路径）');
    }
    const result = await delegate(transmissionController.addTorrent, { body });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'DOWNLOAD_ADD_FAILED', (result.error && result.error.message) || '添加下载任务失败');
    }
    return ok(res, result.data);
  };

  /**
   * POST /api/control/downloads/action  { action: start|stop|remove, ids: [] }
   */
  downloadAction = async (req, res) => {
    const body = req.body || {};
    const action = String(body.action || '').toLowerCase();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!['start', 'stop', 'remove'].includes(action)) {
      return fail(res, 400, 'ACTION_INVALID', 'action 仅支持 start / stop / remove');
    }
    if (ids.length === 0) {
      return fail(res, 400, 'IDS_REQUIRED', 'ids 不能为空');
    }
    const method = action === 'start' ? transmissionController.startTorrents
      : action === 'stop' ? transmissionController.stopTorrents
        : transmissionController.removeTorrents;
    const result = await delegate(method, { body: { ...body, ids } });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'DOWNLOAD_ACTION_FAILED', (result.error && result.error.message) || '操作下载任务失败');
    }
    return ok(res, result.data);
  };

  /**
   * GET /api/control/docker/status
   */
  dockerStatus = async (req, res) => {
    const result = await delegate(dockerController.getStatus, { method: 'GET', url: '/api/docker/status', timeoutMs: 20000 });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'DOCKER_STATUS_FAILED', (result.error && result.error.message) || '获取 Docker 状态失败');
    }
    return ok(res, result.data);
  };

  /**
   * GET /api/control/docker/containers?all=1
   */
  dockerContainers = async (req, res) => {
    const result = await delegate(dockerController.listContainers, {
      method: 'GET',
      url: '/api/docker/containers/list',
      query: req.query || {},
      timeoutMs: 20000,
    });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'DOCKER_LIST_FAILED', (result.error && result.error.message) || '获取容器列表失败');
    }
    return ok(res, result.data);
  };

  /**
   * GET /api/control/docker/images
   */
  dockerImages = async (req, res) => {
    const result = await delegate(dockerController.listImages, {
      method: 'GET',
      url: '/api/docker/images/list',
      query: req.query || {},
      timeoutMs: 20000,
    });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'DOCKER_IMAGES_FAILED', (result.error && result.error.message) || '获取镜像列表失败');
    }
    return ok(res, result.data);
  };

  /**
   * POST /api/control/docker/container  { id, action: start|stop|restart }
   */
  dockerContainerAction = async (req, res) => {
    const body = req.body || {};
    const id = String(body.id || body.containerId || '').trim();
    const action = String(body.action || '').toLowerCase();
    if (!id) return fail(res, 400, 'ID_REQUIRED', '缺少容器 id');
    if (!['start', 'stop'].includes(action)) {
      return fail(res, 400, 'ACTION_INVALID', 'action 仅支持 start / stop');
    }
    const method = action === 'start' ? dockerController.startContainer : dockerController.stopContainer;
    const result = await delegate(method, { body: { ...body, id }, timeoutMs: 30000 });
    if (!result.ok) {
      return fail(res, result.statusCode, (result.error && result.error.code) || 'DOCKER_ACTION_FAILED', (result.error && result.error.message) || `容器 ${action} 失败`);
    }
    return ok(res, result.data);
  };
}

module.exports = new ControlController();
module.exports.ControlController = ControlController;
module.exports.formatBytes = formatBytes;
module.exports.isAbsoluteLikePath = isAbsoluteLikePath;
