const ResponseUtil = require('../../../apiUtils/responseUtil');
const PhotoSourceService = require('./photoSourceService');
const FileUtil = require('../../../../utils/fileUtil');
const Logger = require('../../../../utils/logger');
const config = require('../../../../config/config');
const fs = require('fs');

// service 层抛出的 message 分两类：一类是 i18n 键（photo.PHOTO_SOURCE_EXISTS /
// common.NOT_FOUND），ResponseUtil.error 会原样透传；另一类是数据库异常
// （SQLITE_CONSTRAINT: UNIQUE constraint failed...），ResponseUtil 的
// isUserFacingMessage 会把它换成 common.ERROR。所以 message/code 本来就是干净的，
// 真正脏的是下面两件事，都得先认出「这不是键」才知道该走哪条分支：
//   1) 状态码：冲突（EXISTS/PARENT_EXISTS）该回 409，回 400 前端会当成参数错误重试；
//   2) 日志：非键的 message 一定是意外，不打日志就只剩前端一句「发生错误」。
const LOCALE_KEY_RE = /^[a-z][a-zA-Z0-9]*\.[A-Z][A-Z0-9_]+$/;

function localeKeyOf(err, fallback = 'common.ERROR') {
  const msg = err && err.message ? String(err.message) : '';
  return LOCALE_KEY_RE.test(msg) ? msg : fallback;
}

function logUnexpected(where, err) {
  Logger.error(`[photoSource/${where}] unexpected error: ${err && err.stack ? err.stack : err}`);
}

async function stopPhotoIndexWorkerBeforeDelete(timeoutMs = 8000) {
  const waitStopped = new Promise(resolve => {
    if (typeof process.send !== 'function') return resolve(false);

    const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    let done = false;
    const timer = setTimeout(
      () => {
        if (done) return;
        done = true;
        process.removeListener('message', onMessage);
        resolve(false);
      },
      Math.max(1000, Number(timeoutMs || 0) || 0)
    );

    const onMessage = message => {
      if (!message || message.type !== 'stopPhotoIndexWorkerResponse') return;
      if (!message.data || message.data.requestId !== requestId) return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.removeListener('message', onMessage);
      resolve(!!message.data.stopped);
    };
    process.on('message', onMessage);

    try {
      process.send({ type: 'stopPhotoIndexWorker', data: { requestId } });
    } catch (_) {
      clearTimeout(timer);
      process.removeListener('message', onMessage);
      resolve(false);
    }
  });

  return await waitStopped;
}

class PhotoSourceController {
  async listSources(req, res) {
    try {
      const service = new PhotoSourceService(req.dbPhoto);
      const list = await service.listSources();
      const enriched = await Promise.all(
        (list || []).map(async row => {
          const p = row && row.path ? String(row.path) : '';
          let exists = false;
          if (p) {
            try {
              const stat = await fs.promises.stat(p);
              exists = !!(stat && stat.isDirectory());
            } catch (_) {}
          }
          return { ...row, exists };
        })
      );
      return ResponseUtil.success(req, res, enriched, 'photo.PHOTO_SOURCE_LIST_SUCCESS', 200);
    } catch (err) {
      // 原来是裸 catch：前端只看到「获取失败」，日志里一个字都没有
      logUnexpected('list', err);
      return ResponseUtil.error(req, res, 'photo.PHOTO_SOURCE_LIST_FAILED', 500);
    }
  }

  async addSource(req, res) {
    try {
      const service = new PhotoSourceService(req.dbPhoto);
      const { path } = req.body || {};
      // path 不是字符串时 FileUtil.isProtectedPath / fs.existsSync 都会静悄悄地当 falsy 处理，
      // 最后落到「文件夹不存在」—— 空路径明明是参数问题，不该报成 404。
      if (typeof path !== 'string' || !path.trim()) {
        return ResponseUtil.error(req, res, 'validation.VALIDATION_ERROR', 400);
      }
      // 检查系统关键目录
      if (FileUtil.isProtectedPath(path)) {
        return ResponseUtil.error(req, res, 'file.SYSTEM_PROTECTED_PATH', 403);
      }
      // 检查目录是否存在。relocateSource 用 stat().isDirectory() 卡掉了「把文件当来源」，
      // 这里却只 existsSync：传一个文件路径会 201 成功入库，
      // 而 photoIndexWorker 的 runTask 看到不是目录就直接把任务删掉，
      // 于是 UI 里多出一个永远扫不出照片的来源。
      let stat = null;
      try {
        stat = fs.statSync(path);
      } catch (_) {
        stat = null;
      }
      if (!stat || !stat.isDirectory()) {
        return ResponseUtil.error(req, res, 'file.FOLDER_NOT_EXIST', 404);
      }

      const result = await service.addSource(path);
      const statusCode = result.action === 'insert' ? 201 : 200;
      const messageKey = result.action === 'insert' ? 'photo.PHOTO_SOURCE_ADD_SUCCESS' : 'photo.PHOTO_SOURCE_UPDATE_SUCCESS';

      const scanPath = result && result.row && result.row.path ? String(result.row.path) : '';
      if (scanPath) {
        try {
          const exists = await req.dbPhoto('photo_scan_task').where({ scan_path: scanPath }).first();
          if (!exists) {
            await req.dbPhoto('photo_scan_task').insert({
              scan_path: scanPath,
              remark: 'source_add',
              create_time: new Date(),
            });
          }
          if (process.send) {
            process.send({ type: 'startPhotoIndexWorker', data: { scanPath } });
          }
        } catch (err) {
          // 原来是 catch (_) {}：扫描任务没入队也照样返回 201，
          // 前端以为加好了，实际上一次都不会扫，用户看到的是「来源加了但是没有照片」。
          // 来源行已经写进库了，回滚不掉，只能把失败原因写清楚，让运维能定位。
          logUnexpected('add/queueScan', err);
        }
      }
      if (process.send) {
        try {
          process.send({ type: 'resetPhotoWatchWorker' });
        } catch (_) {}
      }

      return ResponseUtil.success(req, res, result.row, messageKey, statusCode);
    } catch (err) {
      const msgKey = localeKeyOf(err, 'common.ERROR');
      const statusCode = msgKey === 'photo.PHOTO_SOURCE_EXISTS' || msgKey === 'photo.PHOTO_SOURCE_PARENT_EXISTS' ? 409 : 400;
      if (msgKey === 'common.ERROR') logUnexpected('add', err);
      if (err && err.args) {
        return ResponseUtil.errorWithArgs(req, res, msgKey, err.args, statusCode);
      }
      return ResponseUtil.error(req, res, msgKey, statusCode);
    }
  }

  async scanSource(req, res) {
    try {
      const rawPath = req.body && req.body.path !== undefined ? req.body.path : req.body && req.body.scan_path !== undefined ? req.body.scan_path : '';
      const input = rawPath === undefined || rawPath === null ? '' : String(rawPath).trim();
      if (!input) {
        return ResponseUtil.error(req, res, 'validation.VALIDATION_ERROR', 400);
      }

      let scanPaths = [];
      if (input === 'all') {
        const rows = await req
          .dbPhoto('photo_source')
          .select('path')
          .catch(() => []);
        scanPaths = (rows || []).map(r => (r && r.path ? String(r.path) : '')).filter(Boolean);
      } else {
        const scanPath = input;
        const row = await req.dbPhoto('photo_source').where({ path: scanPath }).first('id');
        if (!row || !row.id) {
          return ResponseUtil.error(req, res, 'common.NOT_FOUND', 404);
        }
        scanPaths = [scanPath];
      }

      const unique = Array.from(new Set((scanPaths || []).map(p => (p ? String(p) : '')).filter(Boolean)));
      if (unique.length === 0) {
        return ResponseUtil.success(req, res, { inserted: 0 }, 'common.SUCCESS', 200);
      }

      const remark = input === 'all' ? 'source_scan_all' : 'source_scan';
      const inserted = await req.dbPhoto.transaction(async trx => {
        const existingRows = await trx('photo_scan_task')
          .select('scan_path')
          .whereIn('scan_path', unique)
          .catch(() => []);
        const existing = new Set();
        for (const r of existingRows || []) {
          const s = r && r.scan_path ? String(r.scan_path) : '';
          if (s) existing.add(s);
        }

        const toInsert = [];
        for (const p of unique) {
          if (!existing.has(p)) {
            toInsert.push({
              scan_path: p,
              remark,
              create_time: new Date(),
            });
          }
        }

        if (toInsert.length === 0) return 0;
        await trx('photo_scan_task').insert(toInsert);
        return toInsert.length;
      });

      if (process.send) {
        try {
          process.send({ type: 'startPhotoIndexWorker', data: { scanPath: input } });
        } catch (err) {
          logUnexpected('scan/startWorker', err);
        }
      }

      return ResponseUtil.success(req, res, { inserted }, 'common.SUCCESS', 200);
    } catch (err) {
      logUnexpected('scan', err);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async deleteSource(req, res) {
    try {
      await stopPhotoIndexWorkerBeforeDelete();
      const service = new PhotoSourceService(req.dbPhoto);
      const { id, path } = req.body || {};
      const affected = await service.deleteSource({ id, path });
      if (process.send) {
        try {
          process.send({ type: 'resetPhotoWatchWorker' });
        } catch (_) {}
      }
      if (process.send) {
        try {
          process.send({ type: 'startPhotoIndexWorker', data: {} });
        } catch (_) {}
      }
      return ResponseUtil.success(req, res, { affected }, 'photo.PHOTO_SOURCE_DELETE_SUCCESS', 200);
    } catch (err) {
      const msgKey = localeKeyOf(err, 'common.ERROR');
      if (msgKey === 'common.ERROR') logUnexpected('delete', err);
      return ResponseUtil.error(req, res, msgKey, 400);
    }
  }

  async updateSource(req, res) {
    try {
      const service = new PhotoSourceService(req.dbPhoto);
      const id = req.params && req.params.id;
      const row = await service.updateSource(id, req.body || {});
      if (process.send) {
        try {
          process.send({ type: 'resetPhotoWatchWorker' });
        } catch (_) {}
      }
      return ResponseUtil.success(req, res, row, 'photo.PHOTO_SOURCE_UPDATE_SUCCESS', 200);
    } catch (err) {
      const msgKey = localeKeyOf(err, 'common.ERROR');
      const statusCode = msgKey === 'common.NOT_FOUND' ? 404 : 400;
      if (msgKey === 'common.ERROR') logUnexpected('update', err);
      return ResponseUtil.error(req, res, msgKey, statusCode);
    }
  }

  async relocateSource(req, res) {
    try {
      const service = new PhotoSourceService(req.dbPhoto);
      const id = req.params && req.params.id;
      const { new_path: newPath } = req.body || {};
      if (FileUtil.isProtectedPath(newPath)) {
        return ResponseUtil.error(req, res, 'file.SYSTEM_PROTECTED_PATH', 403);
      }
      if (!newPath) {
        return ResponseUtil.error(req, res, 'validation.VALIDATION_ERROR', 400);
      }

      let stat;
      try {
        stat = await fs.promises.stat(String(newPath));
      } catch (_) {
        stat = null;
      }
      if (!stat || !stat.isDirectory()) {
        return ResponseUtil.error(req, res, 'file.FOLDER_NOT_EXIST', 400);
      }

      const result = await service.relocateSource(id, newPath);

      if (process.send) {
        try {
          process.send({ type: 'resetPhotoWatchWorker' });
        } catch (_) {}
      }

      return ResponseUtil.success(req, res, result, 'photo.PHOTO_SOURCE_RELOCATE_SUCCESS', 200);
    } catch (err) {
      const msgKey = localeKeyOf(err, 'common.ERROR');
      // relocate 的冲突（EXISTS / PARENT_EXISTS）和 addSource 一样是 409：
      // 回 400 前端会当成参数错误，让用户改路径重试，而真正该做的是先删掉旧来源。
      const statusCode =
        msgKey === 'common.NOT_FOUND'
          ? 404
          : msgKey === 'photo.PHOTO_SOURCE_EXISTS' || msgKey === 'photo.PHOTO_SOURCE_PARENT_EXISTS'
            ? 409
            : 400;
      if (msgKey === 'common.ERROR') logUnexpected('relocate', err);
      if (err && err.args) {
        return ResponseUtil.errorWithArgs(req, res, msgKey, err.args, statusCode);
      }
      return ResponseUtil.error(req, res, msgKey, statusCode);
    }
  }

  async regenerateThumbnails(req, res) {
    try {
      // 将 photo_index 表的 gen_tiny 全部重置为 0
      await req.dbPhoto('photo_index')
        .where({ is_file: 1, in_trash: 0 })
        .whereIn('type', [1, 2])
        .update({ gen_tiny: 0 });

      // 将 video_index 表的 gen_tiny 全部重置为 0
      if (req.dbVideo) {
        await req.dbVideo('video_index')
          .where({ is_file: 1 })
          .whereIn('ext', Array.isArray(config.videoTypeList) ? config.videoTypeList : [])
          .update({ gen_tiny: 0 });
      }

      // 启动缩略图生成进程（若已在运行则跳过，会在下次轮询中自动处理新记录）
      if (process.send) {
        try {
          process.send({ type: 'startTinyImageWorker' });
        } catch (err) {
          logUnexpected('regenerateThumbnails/startWorker', err);
        }
      }

      return ResponseUtil.success(req, res, {}, 'common.SUCCESS', 200);
    } catch (err) {
      logUnexpected('regenerateThumbnails', err);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }
}

module.exports = new PhotoSourceController();
