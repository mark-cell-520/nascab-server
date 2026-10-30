const fs = require('fs');
const path = require('path');
const geohash = require('ngeohash');
const Logger = require('../../../../utils/logger');
const ResponseUtil = require('../../../apiUtils/responseUtil');
const { parseExifDate, getTimeFromFileName, pickEarliestMs, getImageBasicInfo, normalizeLatLon } = require('../../../../workers/photoIndex/photoIndexUtil');
const { isPathInRoot } = require('../../../../utils/appAccessScopeUtil');
const photoMapService = require('../map/photoMapService');

let exifr;
try {
  exifr = require('exifr');
} catch (_) {
  exifr = null;
}

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toISOStringOrNull(ms) {
  const t = asNumber(ms);
  if (!t) return null;
  try {
    return new Date(t).toISOString();
  } catch {
    return null;
  }
}

function pickExifValue(exif, keys) {
  if (!exif) return null;
  for (const k of keys) {
    const v = exif[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    return v;
  }
  return null;
}

function buildExifSummary(exif) {
  if (!exif) return null;
  const res = {};
  const add = (key, v) => {
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && !v.trim()) return;
    res[key] = v;
  };

  add('make', pickExifValue(exif, ['Make']));
  add('model', pickExifValue(exif, ['Model']));
  add('lensModel', pickExifValue(exif, ['LensModel', 'Lens']));
  add('fNumber', pickExifValue(exif, ['FNumber']));
  add('apertureValue', pickExifValue(exif, ['ApertureValue']));
  add('exposureTime', pickExifValue(exif, ['ExposureTime']));
  add('shutterSpeedValue', pickExifValue(exif, ['ShutterSpeedValue']));
  add('exposureProgram', pickExifValue(exif, ['ExposureProgram']));
  add('exposureCompensation', pickExifValue(exif, ['ExposureCompensation', 'ExposureBiasValue']));
  add('iso', pickExifValue(exif, ['ISO', 'ISOSpeedRatings']));
  add('focalLength', pickExifValue(exif, ['FocalLength']));
  add('focalLengthIn35mm', pickExifValue(exif, ['FocalLengthIn35mmFormat']));
  add('flash', pickExifValue(exif, ['Flash']));
  add('whiteBalance', pickExifValue(exif, ['WhiteBalance']));
  add('meteringMode', pickExifValue(exif, ['MeteringMode']));
  add('software', pickExifValue(exif, ['Software']));
  add('orientation', pickExifValue(exif, ['Orientation']));

  const dt = pickExifValue(exif, ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'DateCreated', 'CreationDate']);
  add('dateTime', dt);

  const lat = pickExifValue(exif, ['latitude', 'GPSLatitude', 'gpsLatitude', 'Latitude']);
  const lng = pickExifValue(exif, ['longitude', 'GPSLongitude', 'gpsLongitude', 'Longitude']);
  const gps = normalizeLatLon(lat, lng);
  if (gps.latitude && gps.longitude) {
    add('latitude', gps.latitude);
    add('longitude', gps.longitude);
  }

  return Object.keys(res).length > 0 ? res : null;
}

async function readExif(fullPath) {
  if (!exifr) return null;
  return exifr.parse(fullPath, true).catch(() => null);
}

async function readFileDetail(fullPath, filename) {
  let stat;
  try {
    stat = await fs.promises.stat(fullPath);
  } catch {
    return null;
  }
  // 目录的 stat 一样成功，只是 sharp 读不出宽高、归 0。原来不分辨是不是文件，
  // 属性面板就拿到一个 size=4096、width=0、height=0 的「照片」，
  // 调用方看着还以为是张坏图，实际传进来的是个目录。
  if (!stat.isFile()) return null;

  const size = asNumber(stat.size) || 0;
  const mtimeMs = asNumber(stat.mtimeMs);
  const ctimeMs = asNumber(stat.ctimeMs);
  const birthtimeMs = asNumber(stat.birthtimeMs);
  const createTimeMs = birthtimeMs || ctimeMs || null;

  const wh = await getImageBasicInfo(fullPath);
  const exif = await readExif(fullPath);

  let lat = 0;
  let lng = 0;
  let camera = null;
  let originalTimeMs = null;

  if (exif) {
    originalTimeMs =
      parseExifDate(exif.DateTimeOriginal) || parseExifDate(exif.CreateDate) || parseExifDate(exif.ModifyDate) || parseExifDate(exif.DateCreated) || parseExifDate(exif.CreationDate) || null;
    if (exif.Model) camera = String(exif.Model);

    const rawLat = exif.latitude ?? exif.GPSLatitude ?? exif.gpsLatitude;
    const rawLng = exif.longitude ?? exif.GPSLongitude ?? exif.gpsLongitude;
    const gps = normalizeLatLon(rawLat, rawLng);
    lat = gps.latitude;
    lng = gps.longitude;
  }

  originalTimeMs = getTimeFromFileName(originalTimeMs, filename);
  if (!originalTimeMs) originalTimeMs = pickEarliestMs(stat);

  const nowYear = new Date().getFullYear();
  const oy = new Date(originalTimeMs).getFullYear();
  if (!oy || oy < 1970 || oy > nowYear + 1) {
    originalTimeMs = pickEarliestMs(stat);
  }

  return {
    size,
    width: wh.width || 0,
    height: wh.height || 0,
    mtime: toISOStringOrNull(mtimeMs),
    ctime: toISOStringOrNull(ctimeMs),
    createTime: toISOStringOrNull(createTimeMs),
    originalTime: toISOStringOrNull(originalTimeMs),
    camera,
    latitude: lat,
    longitude: lng,
    exif: buildExifSummary(exif),
    exifRaw: exif || null,
  };
}

// properties/get 只应该回答「照片源里的文件」。路由上的 requirePermission 对超管/管理员
// 是直接放行的，控制器内部原来没有任何路径范围校验：拿管理员 token 就能读到宿主上任意
// 文件的 size/mtime/exif（/etc/passwd 也一样），目录也会被当成一张照片返回 200。
// 这里按 photo_source 收口。源列表读不出来时一律拒绝——宁可真查不到，也不把范围放开，
// 否则一次库抖动就把这个口子重新打开。
async function isInsidePhotoSource(dbPhoto, fullpath) {
  let rows;
  try {
    rows = await dbPhoto('photo_source').select('path');
  } catch (err) {
    Logger.error(`[photoProperties/get] read photo_source failed: ${err && err.message ? err.message : err}`);
    return false;
  }
  const roots = (rows || []).map(r => (r && r.path ? String(r.path) : '')).filter(Boolean);
  return roots.some(root => isPathInRoot(fullpath, root));
}

class PhotoPropertiesController {
  async get(req, res) {
    try {
      const rawPath = (req.body && req.body.path ? String(req.body.path) : '').trim();
      if (!rawPath) {
        // 原来是 common.ERROR：参数缺失和「读文件失败」在前端是同一句「发生错误」，
        // 调用方没法区分该补参数还是该查文件
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }

      const fullpath = path.normalize(rawPath);
      const dirPath = path.dirname(fullpath);
      const filename = path.basename(fullpath);
      if (!dirPath || !filename) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }

      const inside = await isInsidePhotoSource(req.dbPhoto, fullpath);
      if (!inside) {
        Logger.error(`[photoProperties/get] path outside photo source: ${fullpath}`);
        return ResponseUtil.error(req, res, 'auth.PERMISSION_DENIED', 403);
      }

      // 原来是 .catch(() => null)：读 photo_index 失败时整个 photoIndex 段静默变成 null，
      // 属性面板上的拍摄时间/相机/GPS 就地消失，看起来像「这张照片就没这些信息」
      const indexRow = await req
        .dbPhoto('photo_index')
        .where({ path: dirPath, filename })
        .first('id', 'path', 'filename', 'file_hash', 'size', 'width', 'height', 'ctime', 'mtime', 'original_time', 'camera', 'latitude', 'longitude', 'geohash', 'ext', 'type', 'live_filename', 'raw_filename')
        .catch(err => {
          Logger.error(`[photoProperties/get] read photo_index failed (${dirPath}/${filename}): ${err && err.message ? err.message : err}`);
          return null;
        });

      const fileDetail = await readFileDetail(fullpath, filename);
      if (!fileDetail) {
        // 原来是 common.ERROR：文件不存在/读不出来时回的是「发生错误」，
        // 前端不知道该提示「文件已不在原位置」
        return ResponseUtil.error(req, res, 'common.NOT_FOUND', 404);
      }

      const latFromIndex = indexRow ? asNumber(indexRow.latitude) || 0 : 0;
      const lngFromIndex = indexRow ? asNumber(indexRow.longitude) || 0 : 0;
      const gpsFinal = normalizeLatLon(fileDetail.latitude || latFromIndex, fileDetail.longitude || lngFromIndex);
      const hasGps = gpsFinal && gpsFinal.latitude && gpsFinal.longitude;

      let locale = '';
      try {
        locale = typeof req.getLocale === 'function' ? String(req.getLocale() || '') : '';
      } catch (_) {
        locale = '';
      }

      let geo = '';
      if (hasGps) {
        const hash = (indexRow && indexRow.geohash ? String(indexRow.geohash) : '') || geohash.encode(gpsFinal.latitude, gpsFinal.longitude, 8);
        if (hash) {
          // 原来是 .catch(() => '')：逆地理失败时地址栏空着，看起来像「这张照片没定位信息」，
          // 而 GPS 坐标明明就在同一份响应里
          geo = await photoMapService.getLocationStr({ dbGeo: req.dbGeo, locale }, hash).catch(err => {
            Logger.error(`[photoProperties/get] reverse geocode failed: ${err && err.message ? err.message : err}`);
            return '';
          });
        }
      }

      const data = {
        fullpath,
        dirPath,
        filename,
        size: fileDetail.size,
        width: fileDetail.width,
        height: fileDetail.height,
        createTime: fileDetail.createTime,
        ctime: fileDetail.ctime,
        mtime: fileDetail.mtime,
        originalTime: fileDetail.originalTime,
        exif: fileDetail.exif,
        latitude: gpsFinal.latitude,
        longitude: gpsFinal.longitude,
        geo,
        photoIndex: indexRow
          ? {
              id: indexRow.id,
              fileHash: indexRow.file_hash,
              camera: indexRow.camera,
              geohash: indexRow.geohash,
              ext: indexRow.ext,
              type: indexRow.type,
              liveFilename: indexRow.live_filename,
              rawFilename: indexRow.raw_filename,
              originalTime: indexRow.original_time ? new Date(indexRow.original_time).toISOString() : null,
              ctime: indexRow.ctime ? new Date(indexRow.ctime).toISOString() : null,
              mtime: indexRow.mtime ? new Date(indexRow.mtime).toISOString() : null,
            }
          : null,
      };

      return ResponseUtil.success(req, res, data, 'common.SUCCESS', 200);
    } catch (error) {
      // 原来是 Logger.error('photo properties error:', error)：日志里没有路由名，
      // 照片模块好几个 controller 都是这个前缀，出问题时定位不到是哪一个
      Logger.error(`[photoProperties/get] failed: ${error && error.stack ? error.stack : error}`);
      const statusCode = error && error.statusCode ? Number(error.statusCode) : 500;
      // 原来直接回 error.message：不是 message key 的消息会被 ResponseUtil 静默替换成
      // common.ERROR 并只写一次日志，这里显式只放行已知 key
      const rawMsg = error && error.message ? String(error.message) : '';
      const msgKey = rawMsg === 'common.PARAM_ERROR' || rawMsg === 'common.NOT_FOUND' || rawMsg === 'common.ERROR' ? rawMsg : 'common.ERROR';
      return ResponseUtil.error(req, res, msgKey, statusCode);
    }
  }
}

module.exports = new PhotoPropertiesController();
