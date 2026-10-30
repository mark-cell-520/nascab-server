const photoTimeLineService = require('./photoTimeLineService');
const Logger = require('../../../../utils/logger');
const ResponseUtil = require('../../../apiUtils/responseUtil');
const photoMapService = require('../map/photoMapService');

// 时间轴/回收站这些接口原来一律 `ResponseUtil.error(req, res, error.message, statusCode)`。
// error.message 绝大多数不是 message key，ResponseUtil 的 isUserFacingMessage 会把它
// 静默换成 common.ERROR 并只写一次日志——看起来"安全"，但只要消息里带一个中文字符
// （照片源叫 /boot/照片 就够了），整段原文就被判定成人话原样回给前端。
// 这里显式只放行已知 key，别的统一走 common.ERROR；细节靠 Logger.error 落盘排查。
const TRASH_MSG_KEYS = ['common.PARAM_ERROR', 'common.NOT_FOUND', 'auth.PERMISSION_DENIED', 'common.ERROR'];

function safeMsgKey(error) {
  const raw = error && error.message ? String(error.message) : '';
  return TRASH_MSG_KEYS.includes(raw) ? raw : 'common.ERROR';
}

function safeStatus(error) {
  const code = error && error.statusCode ? Number(error.statusCode) : 0;
  return Number.isFinite(code) && code >= 400 && code <= 599 ? code : 500;
}

class PhotoTimeLineController {
  async getPhotoTotalCount(req, res) {
    try {
      const { sourceList, collection_id } = req.body || {};
      const result = await photoTimeLineService.getVisiblePhotoTotalCount(
        {
          sourceList,
          collection_id,
        },
        req.user
      );
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (error) {
      Logger.error('getPhotoTotalCount error:', error);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  async getTimelineYearList(req, res) {
    try {
      const result = await photoTimeLineService.getTimelineYearList(req.body || {}, req.user);
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (error) {
      Logger.error('getTimelineYearList error:', error);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 获取时间轴日期列表
   */
  async getTimelineDateList(req, res) {
    try {
      const { sort, fileType, search, geohash, sourceList, list_type, album_id, collection_id, smart_album_id, loadTheDay, face_id, place_name, year } = req.body;
      const result = await photoTimeLineService.getTimelineDateList(
        {
          sort,
          fileType,
          search,
          geohash,
          sourceList,
          list_type,
          album_id,
          collection_id,
          smart_album_id,
          loadTheDay,
          face_id: face_id,
          place_name: place_name,
          year,
        },
        req.user
      );
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (error) {
      Logger.error('getTimelineDateList error:', error);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 获取时间轴照片列表
   */
  async getTimelinePhotoList(req, res) {
    try {
      // 参数: page, pageSize, fileType,original_time,
      // sort: 'asc' | 'desc' 数据根据original_time的排序方式
      // dataTimeType(1为获取时间戳originalTime之前的(包含时间戳),2为获取时间戳originalTime之后的)
      const { pageSize, sort, fileType, originalTime, startTime, endTime, search, geohash, sourceList, list_type, album_id, collection_id, smart_album_id, loadTheDay, face_id, place_name, year } =
        req.body;

      const result = await photoTimeLineService.getTimelinePhotoList(
        {
          pageSize,
          sort,
          fileType,
          originalTime,
          startTime,
          endTime,
          search,
          geohash,
          sourceList,
          list_type,
          album_id,
          collection_id,
          smart_album_id,
          loadTheDay,
          face_id: face_id,
          place_name: place_name,
          year,
        },
        req.user
      );

      const photoList = Array.isArray(result) ? result : [];

      let locale = '';
      try {
        locale = typeof req.getLocale === 'function' ? String(req.getLocale() || '') : '';
      } catch (_) {
        locale = '';
      }

      const dateOrder = [];
      const dateToMeta = new Map();
      const maxPerDate = 3;

      for (const row of photoList) {
        const date = row && row.original_date ? String(row.original_date).trim() : '';
        if (!date) continue;

        let meta = dateToMeta.get(date);
        if (!meta) {
          meta = { geohash5List: [], geohash5Set: new Set(), cameraList: [], cameraSet: new Set() };
          dateToMeta.set(date, meta);
          dateOrder.push(date);
        }

        const rawGeohash5 = row && row.geohash5 ? String(row.geohash5).trim() : '';
        const fallbackGeohash = row && row.geohash ? String(row.geohash).trim() : '';
        const geohash5 = rawGeohash5 || (fallbackGeohash ? fallbackGeohash.slice(0, 5) : '');
        if (geohash5 && meta.geohash5List.length < maxPerDate && !meta.geohash5Set.has(geohash5)) {
          meta.geohash5Set.add(geohash5);
          meta.geohash5List.push(geohash5);
        }

        const camera = row && row.camera ? String(row.camera).trim() : '';
        if (camera && meta.cameraList.length < maxPerDate && !meta.cameraSet.has(camera)) {
          meta.cameraSet.add(camera);
          meta.cameraList.push(camera);
        }
      }

      const allGeohash5 = [];
      const geohash5Seen = new Set();
      for (const [, meta] of dateToMeta.entries()) {
        for (const h of meta.geohash5List) {
          if (!h || geohash5Seen.has(h)) continue;
          geohash5Seen.add(h);
          allGeohash5.push(h);
        }
      }

      const geohash5ToGeo = new Map();
      await Promise.all(
        allGeohash5.map(async h => {
          const geo = await photoMapService.getLocationStr({ dbGeo: req.dbGeo, locale }, h);
          geohash5ToGeo.set(h, geo || '');
        })
      );

      const dateInfoList = dateOrder.map(date => {
        const meta = dateToMeta.get(date);
        const geoList = [];
        const geoSet = new Set();
        if (meta && Array.isArray(meta.geohash5List)) {
          for (const h of meta.geohash5List) {
            const geo = geohash5ToGeo.get(h) || '';
            const g = geo.trim();
            if (!g || geoSet.has(g)) continue;
            geoSet.add(g);
            geoList.push(g);
          }
        }
        return {
          original_date: date,
          geo: geoList.join('、'),
          camera: meta && Array.isArray(meta.cameraList) ? meta.cameraList.join('、') : '',
        };
      });

      return ResponseUtil.success(req, res, { photoList, dateInfoList }, 'common.SUCCESS', 200);
    } catch (error) {
      Logger.error('getTimelinePhotoList error:', error);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 批量收藏/取消收藏
   */
  async batchFavorite(req, res) {
    try {
      const { file_hashes, is_favorite } = req.body;
      if (!Array.isArray(file_hashes)) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }
      await photoTimeLineService.batchFavorite(req.user, file_hashes, is_favorite);
      return ResponseUtil.success(req, res, null, 'common.SUCCESS');
    } catch (error) {
      Logger.error(`[photo/favorite/batch] failed: ${error && error.stack ? error.stack : error}`);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 切换收藏状态
   */
  async toggleFavorite(req, res) {
    try {
      const { file_hash } = req.body;
      if (!file_hash) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }
      const result = await photoTimeLineService.toggleFavorite(req.user, file_hash);
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (error) {
      Logger.error(`[photo/favorite/toggle] failed: ${error && error.stack ? error.stack : error}`);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 批量将照片放入回收站
   */
  async batchTrash(req, res) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }
      await photoTimeLineService.batchTrash(ids, true, req.user);
      return ResponseUtil.success(req, res, null, 'photo.TRASH_ADD_SUCCESS', 200);
    } catch (error) {
      Logger.error(`[photo/trash/add] failed: ${error && error.stack ? error.stack : error}`);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 获取回收站内的照片列表
   */
  async getTrashPhotoList(req, res) {
    try {
      const { page, pageSize, fileType, search, sortField, sortOrder } = req.body;
      const result = await photoTimeLineService.getTrashPhotoList(
        {
          page,
          pageSize,
          fileType,
          search,
          sortField,
          sortOrder,
        },
        req.user
      );
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (error) {
      // 原来是 `ResponseUtil.error(req, res, error.message || 'common.ERROR', 500)`：
      // 排序字段/分页参数能炸出 SQLite 报错，这里把整条 SQL 连宿主机绝对路径一起
      // 回给了前端。现在只放行已知的 message key。
      Logger.error(`[photo/trash/list] failed: ${error && error.stack ? error.stack : error}`);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 从回收站中恢复照片
   */
  async restoreFromTrash(req, res) {
    try {
      const { ids, restore_all } = req.body || {};
      if (restore_all) {
        await photoTimeLineService.restoreAllFromTrash(req.user);
        return ResponseUtil.success(req, res, null, 'photo.TRASH_RESTORE_SUCCESS', 200);
      }
      if (!Array.isArray(ids)) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      await photoTimeLineService.restoreFromTrash(ids, req.user);
      return ResponseUtil.success(req, res, null, 'photo.TRASH_RESTORE_SUCCESS', 200);
    } catch (error) {
      Logger.error(`[photo/trash/restore] failed: ${error && error.stack ? error.stack : error}`);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 从回收站中删除（物理删除）
   */
  async deleteFromTrash(req, res) {
    try {
      const { ids, recycle = false, delete_livephoto_file = 0, delete_raw_file = 0 } = req.body;
      if (!Array.isArray(ids)) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }
      await photoTimeLineService.deleteFromTrash(ids, recycle, req.user, {
        deleteLivePhotoFile: delete_livephoto_file,
        deleteRawFile: delete_raw_file,
      });
      return ResponseUtil.success(req, res, null, 'photo.TRASH_DELETE_SUCCESS', 200);
    } catch (error) {
      Logger.error(`[photo/trash/delete] failed: ${error && error.stack ? error.stack : error}`);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  /**
   * 清空回收站
   */
  async emptyTrash(req, res) {
    try {
      const { recycle = false, delete_livephoto_file = 0, delete_raw_file = 0 } = req.body;
      await photoTimeLineService.emptyTrash(req.user, recycle, {
        deleteLivePhotoFile: delete_livephoto_file,
        deleteRawFile: delete_raw_file,
      });
      return ResponseUtil.success(req, res, null, 'photo.TRASH_EMPTY_SUCCESS', 200);
    } catch (error) {
      Logger.error(`[photo/trash/empty] failed: ${error && error.stack ? error.stack : error}`);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }

  async getBoundsPhoto(req, res) {
    try {
      const { minLat, minLng, maxLat, maxLng, zoom, fileType, search, sourceList, list_type, album_id, collection_id, smart_album_id, loadTheDay, maxReturnCount } = req.body || {};
      const result = await photoTimeLineService.getBoundsPhoto(
        {
          minLat,
          minLng,
          maxLat,
          maxLng,
          zoom,
          fileType,
          search,
          sourceList,
          list_type,
          album_id,
          collection_id,
          smart_album_id,
          loadTheDay,
          maxReturnCount,
        },
        req.user
      );
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (error) {
      Logger.error('getBoundsPhoto error:', error);
      return ResponseUtil.error(req, res, safeMsgKey(error), safeStatus(error));
    }
  }
}

module.exports = new PhotoTimeLineController();
