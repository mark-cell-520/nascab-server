const path = require('path');
const { getTranslation } = require('../../../../utils/i18nUtil');
const photoPathQueryUtil = require('../timeline/photoPathQueryUtil');
const Logger = require('../../../../utils/logger');

class PlacesService {
  constructor(knex) {
    this.knex = knex;
  }

  async listPlaces(params = {}) {
    // 原来是 status || filter || 'visible'：传进来的值不认时两个过滤分支都不进，
    // 结果是把用户主动隐藏的地点也一起返回（前端分类页默认就是「只看未隐藏」）。
    // 不认识的过滤条件按「只看未隐藏」处理，和缺省一致。
    const rawStatus = params.status || params.filter || 'visible';
    const knownStatus = new Set(['visible', 'visiable', 'hide', 'hidden']);
    const status = knownStatus.has(String(rawStatus)) ? String(rawStatus) : 'visible';
    const locale = params && params.locale ? String(params.locale) : 'zh-CN';
    const validPaths = Array.isArray(params.validPaths) ? params.validPaths.filter(Boolean) : [];

    if (Object.prototype.hasOwnProperty.call(params, 'validPaths') && validPaths.length === 0) {
      return {
        items: [],
        pagination: { total: 0, page: 1, pageSize: 0 },
      };
    }

    let rowsQuery = this.knex('photo_places').select('place_name', 'photo_count', 'is_hide', 'create_time', 'update_time');

    if (validPaths.length > 0) {
      const allowedPlaceNamesQuery = this.knex('photo_places2filehash as p2')
        .join('photo_index as p', 'p.file_hash', 'p2.file_hash')
        .where('p.is_file', 1)
        .where('p.in_trash', 0)
        .select('p2.place_name');
      photoPathQueryUtil.applyPathPrefixFilter(allowedPlaceNamesQuery, 'p.path', validPaths);
      rowsQuery = rowsQuery.whereIn('place_name', allowedPlaceNamesQuery);
    }

    if (status === 'visible' || status === 'visiable') {
      rowsQuery = rowsQuery.andWhere('is_hide', 0);
    } else if (status === 'hide' || status === 'hidden') {
      rowsQuery = rowsQuery.andWhere('is_hide', 1);
    }

    // 原来 .catch(() => [])：查库失败时地点列表直接是空的，页面显示「还没有地点」，
    // 而库里明明有数据。日志必须有，否则这种空列表和真的没数据分不开。
    const rows = await rowsQuery.orderBy('photo_count', 'desc').catch(err => {
      Logger.error(`[places/list] query photo_places failed: ${err && err.message ? err.message : err}`);
      return [];
    });

    const items = Array.isArray(rows) ? rows : [];
    const total = items.length;
    const placeNames = items
      .map(it => (it && it.place_name ? String(it.place_name) : ''))
      .map(n => n.trim())
      .filter(Boolean);
    const coverByPlaceKey = new Map();

    if (placeNames.length > 0) {
      let coverRows = [];
      if (validPaths.length > 0) {
        let qb = this.knex('photo_places2filehash as p2')
          .join('photo_index as p', 'p.file_hash', 'p2.file_hash')
          .andWhere('p.is_file', 1)
          .andWhere('p.in_trash', 0)
          .whereIn('p2.place_name', placeNames);
        photoPathQueryUtil.applyPathPrefixFilter(qb, 'p.path', validPaths);
        const allCoverCandidates = await qb
          .select('p2.place_name as place_key', 'p2.file_hash as file_hash', 'p.path as path', 'p.filename as filename', 'p.original_time as original_time', 'p.id as photo_id', 'p2.id as p2_id')
          .orderBy('p.original_time', 'desc')
          .orderBy('p.id', 'desc')
          .orderBy('p2.id', 'desc')
          .catch(err => {
            Logger.error(`[places/list] query place covers failed: ${err && err.message ? err.message : err}`);
            return [];
          });
        for (const r of allCoverCandidates) {
          const key = r && r.place_key !== undefined && r.place_key !== null ? String(r.place_key) : '';
          if (!key || coverByPlaceKey.has(key)) continue;
          coverByPlaceKey.set(key, {
            file_hash: r && r.file_hash ? String(r.file_hash) : '',
            path: r && r.path ? String(r.path) : '',
            filename: r && r.filename ? String(r.filename) : '',
            fullpath: r && r.path && r.filename ? path.join(r.path, r.filename) : '',
          });
        }
      } else {
        const placeholders = placeNames.map(() => '?').join(',');
        const keyColumn = 'place_name';
        const sql = `
        SELECT ${keyColumn} AS place_key, file_hash, path, filename
        FROM (
          SELECT
            p2.${keyColumn} AS place_key,
            p2.file_hash AS file_hash,
            p.path AS path,
            p.filename AS filename,
            ROW_NUMBER() OVER (
              PARTITION BY p2.${keyColumn}
              ORDER BY p.original_time DESC, p.id DESC, p2.id DESC
            ) AS rn
          FROM photo_places2filehash AS p2
          JOIN photo_index AS p ON p.file_hash = p2.file_hash
          WHERE p2.${keyColumn} IN (${placeholders})
            AND p.is_file = 1
            AND p.in_trash = 0
        )
        WHERE rn = 1
      `;
        const paramsList = placeNames;
        try {
          const raw = await this.knex.raw(sql, paramsList);
          coverRows = Array.isArray(raw) ? raw : [];
        } catch (err) {
          // 窗口函数老版本 SQLite 不支持，回退到普通 join + 前端取首条是有意为之，
          // 但原来裸 catch(_) 让「SQL 写错」和「SQLite 太老」共用同一条静默路径
          Logger.error(`[places/list] window-function cover query failed, fallback to plain join: ${err && err.message ? err.message : err}`);
          let qb = this.knex('photo_places2filehash as p2').join('photo_index as p', 'p.file_hash', 'p2.file_hash').andWhere('p.is_file', 1).andWhere('p.in_trash', 0);

          qb = qb.whereIn('p2.place_name', placeNames);

          coverRows = await qb
            .select('p2.place_name as place_key', 'p2.file_hash as file_hash', 'p.path as path', 'p.filename as filename', 'p.original_time as original_time', 'p.id as photo_id', 'p2.id as p2_id')
            .orderBy('p.original_time', 'desc')
            .orderBy('p.id', 'desc')
            .orderBy('p2.id', 'desc')
            .catch(err2 => {
              Logger.error(`[places/list] fallback cover query failed: ${err2 && err2.message ? err2.message : err2}`);
              return [];
            });
        }
      }

      if (validPaths.length === 0) {
        for (const r of coverRows) {
          const key = r && r.place_key !== undefined && r.place_key !== null ? String(r.place_key) : '';
          if (!key) continue;
          if (coverByPlaceKey.has(key)) continue;
          const coverPath = r && r.path ? String(r.path) : '';
          const coverFilename = r && r.filename ? String(r.filename) : '';
          const fullpath = coverPath && coverFilename ? path.join(coverPath, coverFilename) : '';
          coverByPlaceKey.set(key, {
            file_hash: r && r.file_hash ? String(r.file_hash) : '',
            path: coverPath,
            filename: coverFilename,
            fullpath: fullpath || '',
          });
        }
      }
    }

    const enriched = items.map(it => {
      const { place_name: _pn, ...rest } = it || {};
      const rawName = it && it.place_name ? String(it.place_name) : '';
      const coverKey = rawName;
      const cover = coverByPlaceKey.get(coverKey) || null;
      const keyByName = rawName ? `places365.${rawName}` : '';
      const translatedByName = keyByName ? getTranslation(keyByName, locale) : '';
      const localizedName = (translatedByName && translatedByName !== keyByName ? translatedByName : '') || rawName;
      return {
        ...rest,
        place_name_raw: rawName,
        place_name: localizedName,
        is_hide: Number(it && it.is_hide ? it.is_hide : 0) || 0,
        cover,
      };
    });

    return {
      items: enriched,
      pagination: {
        total,
        page: 1,
        pageSize: total,
      },
    };
  }

  async updatePlaceStatus(params = {}) {
    const rawPlaceName = params.place_name ?? params.placeName ?? params.place_name_raw;
    const placeName = rawPlaceName ? String(rawPlaceName).trim() : '';
    const rawStatus = params.status ?? params.state ?? params.is_hide ?? params.isHide;
    if (!placeName) {
      const err = new Error('common.PARAM_ERROR');
      err.statusCode = 400;
      throw err;
    }
    let isHide = null;
    if (rawStatus === 'hide' || rawStatus === 'hidden' || rawStatus === 1 || rawStatus === '1' || rawStatus === true) {
      isHide = 1;
    } else if (rawStatus === 'visible' || rawStatus === 'visiable' || rawStatus === 0 || rawStatus === '0' || rawStatus === false) {
      isHide = 0;
    }
    if (isHide === null) {
      const err = new Error('common.PARAM_ERROR');
      err.statusCode = 400;
      throw err;
    }
    const existed = await this.knex('photo_places')
      .where({ place_name: placeName })
      .first('place_name', 'is_hide');
    // 原来是 .catch(() => null)：读库失败时回的是 404「地点不存在」，
    // 运维照这个消息去查数据，而地点明明还在，只是库被锁了。
    if (!existed) {
      const err = new Error('common.NOT_FOUND');
      err.statusCode = 404;
      throw err;
    }
    await this.knex('photo_places')
      .where({ place_name: placeName })
      .update({ is_hide: isHide, update_time: this.knex.fn.now() });
    // 原来是 .catch(() => {}) 后无条件 return true：更新失败时前端照样收到
    // success，开关弹回原值，用户再点一次还是「成功」，这个地点永远改不掉。
    // 回读一次确认，写没写进去不猜。
    const after = await this.knex('photo_places').where({ place_name: placeName }).first('is_hide');
    if (!after || Number(after.is_hide) !== isHide) {
      const err = new Error('common.ERROR');
      err.statusCode = 500;
      throw err;
    }
    return { place_name: placeName, is_hide: isHide };
  }

  async resetPlacesRecognition() {
    // 原来是三步各带一个 .catch(() => 0)：gen_place 重置失败时，
    // 后面两步照删，接口照样回 {ok:true, resetCount:0}。
    // 结果是照片的「地点已识别」标记还留着、地点关联却被清空，
    // 照片页的地点标签直接消失，而前端显示「重新识别已开始」。
    // 事务里不再吞错，任一步失败整体回滚。
    return this.knex.transaction(async trx => {
      // whereNot('gen_place', 0) 会生成 `gen_place <> 0`，SQL 里 NULL <> 0 是 NULL，
      // 整行被过滤掉——没跑过地点识别的照片永远排不上队，用户点几次「重新识别」都没反应。
      const resetQuery = trx('photo_index').where(qb => {
        qb.whereNot('gen_place', 0).orWhereNull('gen_place');
      });
      const resetCount = await resetQuery.update({ gen_place: 0 });
      const clearedRelationCount = await trx('photo_places2filehash').del();
      const clearedPlaceCount = await trx('photo_places').del();

      return {
        resetCount: Number(resetCount) || 0,
        clearedRelationCount: Number(clearedRelationCount) || 0,
        clearedPlaceCount: Number(clearedPlaceCount) || 0,
      };
    });
  }
}

module.exports = PlacesService;
