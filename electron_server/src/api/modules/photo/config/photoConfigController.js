const ResponseUtil = require('../../../apiUtils/responseUtil');
const tableConfig = require('../../../../db/table/tableConfig');
const Logger = require('../../../../utils/logger');

// enable 只认这几种写法。原来是「不是 1 就一律当 0」：
// 请求体里缺 enable、被网关/代理改成别的值、或者上游传了个字符串开关名，
// 接口都会回 {enable:0} + success —— 用户点的是「开启」，
// AI 开关却被关掉，而且前端收到 success 后还照着关掉的状态渲染，
// 两边一起错，从 UI 上完全看不出原因。
function parseEnable(body) {
  const v = body && body.enable;
  if (v === 1 || v === '1' || v === true || v === 'true') return 1;
  if (v === 0 || v === '0' || v === false || v === 'false') return 0;
  return null;
}

// 6 个 AI 开关路由共用。解析失败时直接回 400 并返回 null，调用方 `if (enable === null) return;`
function requireEnable(req, res) {
  const enable = parseEnable(req && req.body);
  if (enable === null) {
    ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
    return null;
  }
  return enable;
}

// min_show_count：0 是合法值（前端把「全部显示」当 0），负数和小数不是。
// 原来是「算不出来就写 0」，传个 'abc' 会静默变成 0 存进库，
// 人脸分组的下限就这么被悄悄改了。
function parseMinShowCount(body) {
  const raw = body && (body.min_show_count ?? body.minShowCount ?? body.value);
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return null;
  return n;
}

async function getEnableByKey(key) {
  const raw = await tableConfig.getConfigByKey(key);
  return raw === '1' ? 1 : 0;
}

// 读取开关值，未设置时默认为 1（开启）
async function getEnableByKeyDefault1(key) {
  const raw = await tableConfig.getConfigByKey(key);
  if (raw === null || raw === undefined) return 1;
  return raw === '0' ? 0 : 1;
}

async function getMinShowCount() {
  const raw = await tableConfig.getConfigByKey('ai_face_min_show_count');
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function buildProgress(done, total) {
  const safeTotal = total > 0 ? total : 0;
  const safeDone = done > 0 ? Math.min(done, safeTotal) : 0;
  const percent = safeTotal > 0 ? Math.floor((safeDone * 100) / safeTotal) : 0;
  return { done: safeDone, total: safeTotal, percent };
}

function parseInt0(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// 配置值写进库只是半个开关，主进程那边还得起/停对应 worker。
// 原来是 catch (_) {}：IPC 发失败时库里是新的、worker 还是旧的，
// 用户看到开关生效了，OCR/人脸/相似度扫描一个都没动。
// 注意 process.send 在没有 IPC channel 时是 undefined（主进程由 supervisord 直接拉起），
// channel 关闭时才抛 ERR_IPC_CHANNEL_CLOSED，两种情况都要留日志。
function notifyMain(message, where) {
  if (!process.send) return;
  try {
    process.send(message);
  } catch (err) {
    Logger.error(`[photoConfig/${where}] notify main process failed: ${err && err.message ? err.message : err}`);
  }
}

const previewSizeConfigKey = 'photo_preview_size';
const allowedPreviewSizes = new Set(['origin', '8000', '7000', '6000', '5000', '4000', '3000', '2000', '1000']);

function normalizePreviewSizeStored(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return 'origin';
  if (s === 'origin') return 'origin';
  const n = Math.floor(Number(s));
  if (!Number.isFinite(n) || n <= 0) return 'origin';
  const normalized = String(n);
  return allowedPreviewSizes.has(normalized) ? normalized : 'origin';
}

function normalizePreviewSizeInput(body) {
  const raw = body && (body.size ?? body.previewSize ?? body.value);
  // 原来空值/缺字段都当成 'origin'：请求体没带 size 也会被静默设成「原图」。
  // 读侧（normalizePreviewSizeStored）宽松是对的——没配过就用默认值；
  // 写侧必须严格，否则一次畸形的请求就把用户的预览设置改掉了。
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'origin' || lower === 'original') return 'origin';
  const n = Math.floor(Number(lower));
  if (!Number.isFinite(n) || n <= 0) return null;
  const normalized = String(n);
  return allowedPreviewSizes.has(normalized) ? normalized : null;
}

async function getAiProgress(knexPhoto) {
  if (!knexPhoto) {
    return {
      total: 0,
      face: buildProgress(0, 0),
      place: buildProgress(0, 0),
      ocr: buildProgress(0, 0),
    };
  }

  const row = await knexPhoto('photo_index')
    .where('is_file', 1)
    .andWhere('in_trash', 0)
    .select(
      knexPhoto.raw('COUNT(1) as total'),
      knexPhoto.raw('SUM(CASE WHEN gen_faces = 1 THEN 1 ELSE 0 END) as face_done'),
      knexPhoto.raw('SUM(CASE WHEN gen_place = 1 THEN 1 ELSE 0 END) as place_done'),
      knexPhoto.raw('SUM(CASE WHEN gen_ocr = 1 THEN 1 ELSE 0 END) as ocr_done')
    )
    .first();

  const total = parseCount(row && row.total);
  const faceDone = parseCount(row && row.face_done);
  const placeDone = parseCount(row && row.place_done);
  const ocrDone = parseCount(row && row.ocr_done);

  return {
    total,
    face: buildProgress(faceDone, total),
    place: buildProgress(placeDone, total),
    ocr: buildProgress(ocrDone, total),
  };
}

async function getSimilarProgress(knexPhoto) {
  if (!knexPhoto) {
    return {
      scan: { running: false, ...buildProgress(0, 0) },
      compare: { running: false, ...buildProgress(0, 0) },
    };
  }

  const scanRow = await knexPhoto('photo_index')
    .where({ is_file: 1, in_trash: 0, type: 1 })
    .select(knexPhoto.raw('COUNT(1) as total'), knexPhoto.raw('SUM(CASE WHEN gen_phash >= 1 THEN 1 ELSE 0 END) as done'))
    .first()
    .catch(() => null);

  const scanTotal = parseInt0(scanRow && scanRow.total);
  const scanDone = parseInt0(scanRow && scanRow.done);

  const [scanRunningRaw, compareRunningRaw, compareTotalRaw, compareDoneRaw] = await Promise.all([
    tableConfig.getConfigByKey('ai_similar_scan_running').catch(err => {
      // 原来静默降级成 '0'：读失败时前端看到「扫描空闲」，而扫描可能正在跑
      Logger.error('[photoConfig/similarProgress] read ai_similar_scan_running failed, fallback to 0');
      return '0';
    }),
    tableConfig.getConfigByKey('ai_similar_compare_running').catch(err => {
      Logger.error('[photoConfig/similarProgress] read ai_similar_compare_running failed, fallback to 0');
      return '0';
    }),
    tableConfig.getConfigByKey('ai_similar_compare_total').catch(err => {
      Logger.error('[photoConfig/similarProgress] read ai_similar_compare_total failed, fallback to 0');
      return '0';
    }),
    tableConfig.getConfigByKey('ai_similar_compare_done').catch(err => {
      Logger.error('[photoConfig/similarProgress] read ai_similar_compare_done failed, fallback to 0');
      return '0';
    }),
  ]);

  const compareTotal = parseInt0(compareTotalRaw);
  const compareDone = parseInt0(compareDoneRaw);

  return {
    scan: {
      running: String(scanRunningRaw) === '1',
      ...buildProgress(scanDone, scanTotal),
    },
    compare: {
      running: String(compareRunningRaw) === '1',
      ...buildProgress(compareDone, compareTotal),
    },
  };
}

class PhotoConfigController {
  async getAiConfig(req, res) {
    try {
      const [ocrEnable, petEnable, faceEnable, placeEnable, similarEnable, faceMinShowCount, aiProgress, similarProgress, gpuPrefer] = await Promise.all([
        getEnableByKey('ai_ocr_enable'),
        getEnableByKey('ai_pet_enable'),
        getEnableByKey('ai_face_enable'),
        getEnableByKey('ai_place_enable'),
        getEnableByKey('ai_similar_enable'),
        getMinShowCount(),
        getAiProgress(req && req.dbPhoto),
        getSimilarProgress(req && req.dbPhoto),
        getEnableByKeyDefault1('ai_gpu_prefer'),
      ]);
      return ResponseUtil.success(
        req,
        res,
        {
          ocrEnable,
          petEnable,
          faceEnable,
          placeEnable,
          similarEnable,
          faceMinShowCount,
          aiProgress,
          similarProgress,
          gpuPrefer,
        },
        'common.SUCCESS',
        200
      );
    } catch (err) {
      // 原来是裸 catch：九个配置项 + 两组进度任一项读失败，都只回一句「发生错误」，
      // 日志里连是哪一项读崩了都不知道。
      Logger.error(`[photoConfig/getAiConfig] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async setAiOcrEnable(req, res) {
    try {
      const enable = requireEnable(req, res);
      if (enable === null) return;
      const ok = await tableConfig.setConfigByKey('ai_ocr_enable', String(enable));
      // 原来完全不看返回值：写库失败照样回 success，UI 状态和后端配置从此不一致
      if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
      notifyMain({ type: 'toggleAiOcr', data: { enable } }, 'setAiOcrEnable');
      return ResponseUtil.success(req, res, { enable }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/setAiOcrEnable] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async setAiPetEnable(req, res) {
    try {
      const enable = requireEnable(req, res);
      if (enable === null) return;
      const ok = await tableConfig.setConfigByKey('ai_pet_enable', String(enable));
      if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
      notifyMain({ type: 'toggleAiPet', data: { enable } }, 'setAiPetEnable');
      return ResponseUtil.success(req, res, { enable }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/setAiPetEnable] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async setAiFaceEnable(req, res) {
    try {
      const enable = requireEnable(req, res);
      if (enable === null) return;
      const ok = await tableConfig.setConfigByKey('ai_face_enable', String(enable));
      if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
      notifyMain({ type: 'toggleAiFace', data: { enable } }, 'setAiFaceEnable');
      return ResponseUtil.success(req, res, { enable }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/setAiFaceEnable] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async setAiPlaceEnable(req, res) {
    try {
      const enable = requireEnable(req, res);
      if (enable === null) return;
      const ok = await tableConfig.setConfigByKey('ai_place_enable', String(enable));
      if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
      notifyMain({ type: 'toggleAiPlace', data: { enable } }, 'setAiPlaceEnable');
      return ResponseUtil.success(req, res, { enable }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/setAiPlaceEnable] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async setAiSimilarEnable(req, res) {
    try {
      const enable = requireEnable(req, res);
      if (enable === null) return;
      const ok = await tableConfig.setConfigByKey('ai_similar_enable', String(enable));
      if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
      notifyMain({ type: 'toggleAiSimilar', data: { enable } }, 'setAiSimilarEnable');
      return ResponseUtil.success(req, res, { enable }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/setAiSimilarEnable] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async setAiFaceMinShowCount(req, res) {
    try {
      const minShowCount = parseMinShowCount(req && req.body);
      if (minShowCount === null) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }
      const ok = await tableConfig.setConfigByKey('ai_face_min_show_count', String(minShowCount));
      if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
      return ResponseUtil.success(req, res, { faceMinShowCount: minShowCount }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/setAiFaceMinShowCount] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async getPreviewConfig(req, res) {
    try {
      const uid = req && req.user && req.user.id ? Number(req.user.id) : 0;
      // 原来是 common.ERROR：401 在前端弹的是「发生错误」，用户不知道该去登录
      if (!uid) return ResponseUtil.error(req, res, 'auth.AUTHENTICATION_REQUIRED', 401);
      const raw = await tableConfig.getConfigByKey(previewSizeConfigKey, uid).catch(() => null);
      const previewSize = normalizePreviewSizeStored(raw);
      return ResponseUtil.success(req, res, { previewSize }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/getPreviewConfig] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async setPreviewSize(req, res) {
    try {
      const uid = req && req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.error(req, res, 'auth.AUTHENTICATION_REQUIRED', 401);

      const normalized = normalizePreviewSizeInput(req && req.body);
      // 原来是 common.ERROR：尺寸不合法时报「发生错误」而不是「参数错误」
      if (normalized == null) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);

      if (normalized === 'origin') {
        // 原来是 catch(() => {}) 后照样回 origin 成功：删失败时前端显示「原图」，
        // 服务端却仍按旧的压缩尺寸下发，用户看到的是货不对板的大图。
        const ok = await tableConfig.deleteConfigByKey(previewSizeConfigKey, uid).catch(() => false);
        if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
        return ResponseUtil.success(req, res, { previewSize: 'origin' }, 'common.SUCCESS', 200);
      }

      const ok = await tableConfig.setConfigByKey(previewSizeConfigKey, normalized, uid);
      if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
      return ResponseUtil.success(req, res, { previewSize: normalized }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/setPreviewSize] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }

  async setAiGpuPrefer(req, res) {
    try {
      const enable = requireEnable(req, res);
      if (enable === null) return;
      const ok = await tableConfig.setConfigByKey('ai_gpu_prefer', String(enable));
      if (!ok) return ResponseUtil.error(req, res, 'common.ERROR', 500);
      notifyMain({ type: 'toggleAiGpu', data: { enable } }, 'setAiGpuPrefer');
      return ResponseUtil.success(req, res, { gpuPrefer: enable }, 'common.SUCCESS', 200);
    } catch (err) {
      Logger.error(`[photoConfig/setAiGpuPrefer] failed: ${err && err.stack ? err.stack : err}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }
}

module.exports = new PhotoConfigController();
