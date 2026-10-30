const ResponseUtil = require('../../../apiUtils/responseUtil');
const Logger = require('../../../../utils/logger');
const GpsSupplementService = require('./gpsSupplementService');

class GpsSupplementController {
  async status(req, res) {
    try {
      const service = new GpsSupplementService(req.dbPhoto);
      const result = await service.getStatus();
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (e) {
      Logger.error(`[gps_add/status] failed: ${e && e.message ? e.message : e}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async startScan(req, res) {
    try {
      if (process.send) {
        try {
          process.send({ type: 'startGpsSupplementScan' });
        } catch (_) {}
      }
      const service = new GpsSupplementService(req.dbPhoto);
      const result = await service.getStatus();
      return ResponseUtil.success(req, res, { ok: true, ...result }, 'common.SUCCESS', 200);
    } catch (e) {
      Logger.error(`[gps_add/start_scan] failed: ${e && e.message ? e.message : e}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async apply(req, res) {
    try {
      const body = req.body || {};
      const batchId = Number(body.batchId ?? body.batch_id);
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      const selectedIdsRaw = Array.isArray(body.photoIds)
        ? body.photoIds
        : (Array.isArray(body.photo_ids) ? body.photo_ids : []);
      if (!batchId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }

      const service = new GpsSupplementService(req.dbPhoto);
      const affected = await service.applyBatchGps(
        batchId,
        latitude,
        longitude,
        selectedIdsRaw,
      );
      return ResponseUtil.success(req, res, { ok: true, affected }, 'common.SUCCESS', 200);
    } catch (e) {
      const statusCode = Number(e && e.statusCode) || 500;
      const errorKey = e && e.message ? String(e.message) : 'common.ERROR';
      // 500 一定是意外（数据库、写 EXIF 失败），必须留日志；400/404 是预检/参数类的预期返回，不打
      if (statusCode >= 500) {
        Logger.error(`[gps_add/apply] failed: ${e && e.stack ? e.stack : e}`);
      }
      return ResponseUtil.error(req, res, errorKey, statusCode);
    }
  }

  async skip(req, res) {
    try {
      const body = req.body || {};
      const batchId = Number(body.batchId ?? body.batch_id);
      if (!batchId) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }

      const service = new GpsSupplementService(req.dbPhoto);
      const ok = await service.skipBatch(batchId);
      if (!ok) {
        return ResponseUtil.error(req, res, 'common.NOT_FOUND', 404);
      }
      return ResponseUtil.success(req, res, { ok: true }, 'common.SUCCESS', 200);
    } catch (e) {
      Logger.error(`[gps_add/skip] failed: ${e && e.message ? e.message : e}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async reset(req, res) {
    try {
      const service = new GpsSupplementService(req.dbPhoto);
      const result = await service.resetAll();
      const status = await service.getStatus();
      return ResponseUtil.success(
        req,
        res,
        { ok: true, ...result, ...status },
        'common.SUCCESS',
        200
      );
    } catch (e) {
      Logger.error(`[gps_add/reset] failed: ${e && e.message ? e.message : e}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }
}

module.exports = new GpsSupplementController();
