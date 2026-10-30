const ResponseUtil = require('../../../apiUtils/responseUtil');
const Logger = require('../../../../utils/logger');
const PlacesService = require('./placesService');
const { getUserLanguage } = require('../../../../utils/i18nUtil');
const tableConfig = require('../../../../db/table/tableConfig');
const photoTimeLineService = require('../timeline/photoTimeLineService');
const userUtil = require('../../../../utils/userUtil');

// 配置值写进库只是半个开关，主进程那边还得起/停对应 worker。
// 原来是 catch (_) {}：IPC 发失败时地点识别不会被重新拉起，
// 用户点了「重新识别」，拿到 success，然后什么都没有发生。
// process.send 在没有 IPC channel 时是 undefined（主进程由 supervisord 直接拉起）。
function notifyMain(message, where) {
  if (!process.send) return;
  try {
    process.send(message);
  } catch (err) {
    Logger.error(`[places/${where}] notify main process failed: ${err && err.message ? err.message : err}`);
  }
}

// 读失败时仍然降级成 0（不能让整个地点页 500），但必须留日志：
// 原来是裸 catch (_) { return 0 }，读崩了和「用户主动关掉地点识别」
// 在前端看起来一模一样，地点页直接空了且查不出原因。
async function getEnableByKey(key) {
  try {
    const raw = await tableConfig.getConfigByKey(key);
    return raw === '1' ? 1 : 0;
  } catch (err) {
    Logger.error(`[places/list] read ${key} failed, fallback to 0: ${err && err.message ? err.message : err}`);
    return 0;
  }
}

class PlacesController {
  async listPlaces(req, res) {
    try {
      const placeEnable = await getEnableByKey('ai_place_enable');
      if (placeEnable !== 1) {
        return ResponseUtil.success(
          req,
          res,
          {
            placeEnable,
            items: [],
            pagination: { total: 0, page: 1, pageSize: 0 },
          },
          'common.SUCCESS',
          200
        );
      }
      const locale = getUserLanguage(req);
      let validPaths;
      if (req.user && !userUtil.isAdmin(req.user)) {
        const validPathsRaw = await photoTimeLineService.getValidPaths(req.user);
        validPaths = (validPathsRaw || []).map(p => (p ? String(p) : '')).filter(Boolean);
      }
      const service = new PlacesService(req.dbPhoto);
      const result = await service.listPlaces({ ...(req.body || {}), locale, ...(validPaths !== undefined ? { validPaths } : {}) });
      return ResponseUtil.success(req, res, { placeEnable, ...result }, 'common.SUCCESS', 200);
    } catch (error) {
      Logger.error(`[places/list] failed: ${error && error.stack ? error.stack : error}`);
      const statusCode = error.statusCode || 500;
      return ResponseUtil.error(req, res, 'common.ERROR', statusCode);
    }
  }

  async setPlaceStatus(req, res) {
    try {
      const service = new PlacesService(req.dbPhoto);
      const result = await service.updatePlaceStatus(req.body || {});
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (e) {
      Logger.error(`[places/setPlaceStatus] failed: ${e && e.stack ? e.stack : e}`);
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : msgKey === 'common.NOT_FOUND' ? 404 : msgKey === 'common.PARAM_ERROR' ? 400 : 500;
      return ResponseUtil.error(req, res, msgKey, statusCode);
    }
  }

  async resetPlaces(req, res) {
    try {
      const service = new PlacesService(req.dbPhoto);
      const result = await service.resetPlacesRecognition();
      const placeEnable = await getEnableByKey('ai_place_enable');
      if (placeEnable === 1) {
        notifyMain({ type: 'toggleAiPlace', data: { enable: 1 } }, 'resetPlaces');
      }
      return ResponseUtil.success(
        req,
        res,
        { ok: true, ...result },
        'common.SUCCESS',
        200
      );
    } catch (e) {
      Logger.error(`[places/resetPlaces] failed: ${e && e.stack ? e.stack : e}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }
}

module.exports = new PlacesController();
