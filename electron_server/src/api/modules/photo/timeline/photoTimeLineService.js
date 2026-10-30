const knexUtil = require('../../../../db/knexUtil');
const dbUtil = require('../../../../db/dbUtil');
const path = require('path');
const fs = require('fs');
const config = require('../../../../config/config');
const userUtil = require('../../../../utils/userUtil');
const smartAlbumFilterUtil = require('../smartAlbum/photoSmartAlbumFilterUtil');
const photoPathQueryUtil = require('./photoPathQueryUtil');
const geohash = require('ngeohash');
const { createFavoriteOps } = require('./photoTimeLineFavoriteOps');
const { createTrashOps } = require('./photoTimeLineTrashOps');
const tableConfig = require('../../../../db/table/tableConfig');
const { ensureNodejiebaDictLoaded } = require('../../../../utils/nodejiebaInit');
const nodejieba = require('nodejieba');
const Logger = require('../../../../utils/logger');
const indexFields = [
  'id',
  'camera',
  'path',
  'filename',
  'is_file',
  'original_time',
  'original_date',
  'is_lvp',
  'is_merge_lvp',
  'live_filename',
  'raw_filename',
  'size',
  'type',
  'duration',
  'geohash',
  'geohash5',
  'ext',
  'file_hash',
];

function tokenizeForOcrMatch(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  ensureNodejiebaDictLoaded();
  const tokens = nodejieba.cut(raw);
  if (!Array.isArray(tokens) || tokens.length === 0) return '';

  const uniq = [];
  const seen = new Set();
  for (const token of tokens) {
    const t = String(token || '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/["']/g, '')
      .trim();
    if (!t) continue;
    if (!/[\p{L}\p{N}]/u.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
  }
  if (uniq.length === 0) return '';

  return uniq.map(t => `${t.replace(/\*+$/g, '')}*`).join(' AND ');
}
class PhotoTimeLineService {
  constructor() {
    this.dbPath = dbUtil.DB_PATHS.PHOTO_DB;
    this.favoriteOps = createFavoriteOps({ getKnex: () => this.getKnex() });
    this.trashOps = createTrashOps({
      getKnex: () => this.getKnex(),
      getValidPaths: user => this.getValidPaths(user),
      indexFields,
    });
  }

  getKnex() {
    return knexUtil.getInstance(this.dbPath);
  }

  parseTimeInput(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isFinite(t) ? value : null;
    }
    if (typeof value === 'number') {
      const d = new Date(value);
      const t = d.getTime();
      return Number.isFinite(t) ? d : null;
    }
    const n = Number(value);
    if (Number.isFinite(n)) {
      const d = new Date(n);
      const t = d.getTime();
      return Number.isFinite(t) ? d : null;
    }
    const d = new Date(String(value));
    const t = d.getTime();
    return Number.isFinite(t) ? d : null;
  }

  /**
   * 获取用户有权限的路径列表 来源路径和被授权路径的交集 管理员返回所有来源路径
   * @param {Object} user 用户对象
   * @returns {Promise<string[]>} 路径列表
   */
  async getValidPaths(user) {
    const knex = this.getKnex();
    const uid = user.id;

    // 1. 获取所有照片源
    const sources = await knex('photo_source').select('path');
    const sourcePaths = sources.map(s => s.path);

    // 如果是管理员，拥有所有权限
    if (userUtil.isAdmin(user)) {
      return sourcePaths;
    }

    // 2. 获取用户权限目录
    const mainKnex = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
    const permissions = await mainKnex('user_permission')
      .where({
        uid: uid,
        action: 'view', // 假设 'view' 是查看权限
        res_type: 'file',
      })
      .select('res_path');

    const permissionPaths = permissions.map(p => p.res_path);

    // 3. 计算交集
    // 用户的权限路径必须在照片源路径之下，或者照片源路径在用户权限路径之下
    const validPaths = [];

    for (const pPath of permissionPaths) {
      for (const sPath of sourcePaths) {
        if (pPath.startsWith(sPath) || sPath.startsWith(pPath)) {
          // 取更长（更具体）的那个路径作为限制
          // 例如 source: /A, perm: /A/B -> valid: /A/B
          // 例如 source: /A/B, perm: /A -> valid: /A/B
          validPaths.push(pPath.length > sPath.length ? pPath : sPath);
        }
      }
    }

    // 去重
    return [...new Set(validPaths)];
  }

  async getValidPathsByParams(params, user) {
    const validPaths = await this.getValidPaths(user);

    // 智能相册筛选：存在性/归属必须在这里校验。各入口都是先拿 validPaths、为空就提前
    // 返回空结果，之后才进 buildBaseQuery；若只放在 buildBaseQuery 里，那些没有任何
    // 可见路径的用户会拿到 200 空列表而不是 404/403，与下面的合集筛选不对称。
    const smartAlbumId = Number(params && params.smart_album_id);
    if (Number.isFinite(smartAlbumId) && smartAlbumId > 0) {
      await this._ensureSmartAlbumAccess(params, user);
    }

    // 合集筛选 没有合集就返回有效路径
    const collectionId = Number(params && params.collection_id);
    if (!Number.isFinite(collectionId) || collectionId <= 0) return validPaths;
    const knex = this.getKnex();
    const collection = await knex('photo_collection').where({ id: collectionId }).first();
    if (!collection) {
      const err = new Error('common.NOT_FOUND');
      err.statusCode = 404;
      throw err;
    }

    const uid = user && user.id;
    if (user && !userUtil.isAdmin(user) && uid && Number(collection.uid) !== Number(uid)) {
      const err = new Error('auth.PERMISSION_DENIED');
      err.statusCode = 403;
      throw err;
    }

    const collectionPaths = photoPathQueryUtil.parsePathListText(collection.path_list);
    return photoPathQueryUtil.intersectPaths(validPaths, collectionPaths);
  }

  /**
   * 校验智能相册的存在性与归属，返回相册行
   */
  async _ensureSmartAlbumAccess(params, user) {
    const smartAlbumId = Number(params && params.smart_album_id);
    const knex = this.getKnex();
    const smartAlbum = await knex('photo_smart_album').where({ id: smartAlbumId }).first();
    if (!smartAlbum) {
      const err = new Error('common.NOT_FOUND');
      err.statusCode = 404;
      throw err;
    }
    const uid = user && user.id;
    if (user && !userUtil.isAdmin(user) && uid && Number(smartAlbum.uid) !== Number(uid)) {
      const err = new Error('auth.PERMISSION_DENIED');
      err.statusCode = 403;
      throw err;
    }
    return smartAlbum;
  }

  /**
   * 构建基础查询构建器
   * @param {Object} params 查询参数
   * @param {string[]} validPaths 有效路径列表
   * @returns {Promise<{query: Object}>} knex query builder wrapper
   */
  async buildBaseQuery(params, validPaths, user) {
    const knex = this.getKnex();
    const query = knex('photo_index').where('photo_index.is_file', 1).where('photo_index.in_trash', 0);
    const uid = user && user.id;

    const faceId = Number(params && params.face_id);
    if (Number.isFinite(faceId) && faceId > 0) {
      query
        .join('photo_face2filehash as pff', function () {
          this.on('photo_index.file_hash', '=', 'pff.file_hash');
        })
        .join('photo_faces as pf', 'pf.face_id', 'pff.face_id')
        .where('pf.face_id', faceId);
    }

    let placeName = params && (params.place_name ?? params.placeName) ? String(params.place_name ?? params.placeName).trim() : '';
    if (placeName) {
      query.join('photo_places2filehash as ppf', function () {
        this.on('photo_index.file_hash', '=', 'ppf.file_hash');
      });
      query.where('ppf.place_name', placeName);
    }

    // 收藏筛选
    if (params.list_type === 'favorite' && uid) {
      query.join('photo_favorite', 'photo_index.file_hash', 'photo_favorite.file_hash').where('photo_favorite.uid', uid);
    }

    // 普通相册筛选
    const albumId = Number(params.album_id);
    if (Number.isFinite(albumId) && albumId > 0) {
      query.join('photo_album_index as pai', function () {
        this.on('photo_index.file_hash', '=', 'pai.file_hash').andOnVal('pai.album_id', '=', albumId);
      });

      if (user && !userUtil.isAdmin(user) && uid) {
        query.whereExists(function () {
          this.select(1)
            .from('photo_album as pa')
            .where('pa.id', albumId)
            .where(qb => {
              qb.where('pa.uid', uid)
                .orWhere('pa.is_public', 1)
                .orWhereExists(function () {
                  this.select(1).from('photo_album_share as pas').whereRaw('pas.album_id = pa.id').where('pas.uid', uid);
                });
            });
        });
      }
    }

    // 路径过滤
    let finalPaths = validPaths;
    if (params.sourceList && Array.isArray(params.sourceList) && params.sourceList.length > 0) {
      finalPaths = photoPathQueryUtil.intersectPaths(validPaths, params.sourceList);
    }

    if (finalPaths.length === 0) {
      // 如果没有有效路径，这就应该返回空，这里用一个不可能的条件
      query.whereRaw('1 = 0');
    } else {
      photoPathQueryUtil.applyPathPrefixFilter(query, 'photo_index.path', finalPaths);
    }

    // 搜索过滤
    if (params.search) {
      const search = params.search.trim();
      if (search) {
        const aiOcrEnable = await tableConfig.getConfigByKey('ai_ocr_enable');
        query.where(builder => {
          builder.where('photo_index.path', 'like', `%${search}%`).orWhere('photo_index.filename', 'like', `%${search}%`).orWhere('photo_index.camera', 'like', `%${search}%`);
          if (aiOcrEnable === '1') {
            const matchQuery = tokenizeForOcrMatch(search);
            const finalQuery =
              matchQuery ||
              `${String(search)
                .replace(/[\s\u3000]+/g, '')
                .replace(/["']/g, '')
                .trim()}*`;
            if (finalQuery !== '*') {
              builder.orWhereRaw('photo_index.file_hash IN (SELECT file_hash FROM photo_info_fts WHERE ocr MATCH ?)', [finalQuery]);
            }
          }
        });
      }
    }

    if (params.geohash) {
      const geohashPrefix = String(params.geohash).trim();
      if (geohashPrefix) {
        query.where('photo_index.geohash', 'like', `${geohashPrefix}%`);
      }
    }

    // 类型筛选
    // type: 1=Photo, 2=Video
    // is_lvp: 1=LivePhoto
    if (params.fileType) {
      // fileType: 'photo', 'video', 'livephoto'
      if (params.fileType === 'photo') {
        query.where('photo_index.type', 1);
      } else if (params.fileType === 'video') {
        query.where('photo_index.type', 2);
      } else if (params.fileType === 'livephoto') {
        query.where('photo_index.is_lvp', 1);
      }
    }

    if (params.loadTheDay === true || params.loadTheDay === 1) {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      query.where('photo_index.original_date', 'like', `%-${mm}-${dd}`);
    }

    const year = Number(params && params.year);
    if (Number.isFinite(year) && year > 0) {
      query.where('photo_index.original_date', 'like', `${year}-%`);
    }

    // 智能相册筛选
    const smartAlbumId = Number(params.smart_album_id);
    if (Number.isFinite(smartAlbumId) && smartAlbumId > 0) {
      // 存在性/归属校验在 getValidPathsByParams 里已经做过（那里的提前返回会早于本函数），
      // 这里再兜底一次，避免绕过 getValidPathsByParams 直接调 buildBaseQuery 时漏掉权限检查。
      const smartAlbum = await this._ensureSmartAlbumAccess(params, user);

      const filterContent = smartAlbumFilterUtil.parseFilterContentText(smartAlbum.filter_content);
      smartAlbumFilterUtil.applySmartAlbumFilter(query, smartAlbum.type, filterContent, 'photo_index');
    }

    return { query };
  }

  async getTimelineYearList(params, user) {
    const validPaths = await this.getValidPathsByParams(params, user);
    if (!validPaths || validPaths.length === 0) {
      return { items: [] };
    }

    const knex = this.getKnex();
    const { query } = await this.buildBaseQuery(params || {}, validPaths, user);
    const base = query.clone().clearSelect().clearOrder();

    base.whereNotNull('photo_index.original_date').andWhere('photo_index.original_date', '!=', '');

    const yearExpr = 'substr(photo_index.original_date, 1, 4)';
    const selectFields = indexFields.map(f => `photo_index.${f}`);

    base.select([
      knex.raw(`${yearExpr} as year`),
      knex.raw(`count(*) over (partition by ${yearExpr}) as year_photo_count`),
      ...selectFields,
      knex.raw(`row_number() over (partition by ${yearExpr} order by photo_index.original_time desc, photo_index.id desc) as rn`),
    ]);

    const rows = await knex.from(base.as('t')).select('*').where('rn', 1).orderByRaw('CAST(year as INTEGER) desc');

    const items = rows
      .filter(r => r && String(r.year || '').trim())
      .map(r => {
        const year = Number(r.year);
        const count = Number(r.year_photo_count);
        return {
          year: Number.isFinite(year) ? year : 0,
          count: Number.isFinite(count) ? count : 0,
          cover: {
            ...r,
            fullpath: path.join(r.path, r.filename),
          },
        };
      })
      .filter(e => e.year > 0);

    return { items };
  }

  async getVisiblePhotoTotalCount(params, user) {
    const validPaths = await this.getValidPathsByParams(params, user);
    if (!validPaths || validPaths.length === 0) {
      return { total: 0 };
    }

    const { query } = await this.buildBaseQuery(params || {}, validPaths, user);
    const row = await query.clone().count({ total: '*' }).first();
    const total = Number(row && row.total);
    return { total: Number.isFinite(total) ? total : 0 };
  }

  /**
   * 获取时间轴日期列表
   * @param {Object} params 参数
   * @param {Object} user 用户
   */
  async getTimelineDateList(params, user) {
    const validPaths = await this.getValidPathsByParams(params, user);
    if (validPaths.length === 0) {
      return { items: [], validPaths: [] };
    }

    const { query } = await this.buildBaseQuery(params, validPaths, user);

    // 按 original_date 分组
    // sort: 'asc' | 'desc'
    const sortOrder = params.sort === 'asc' ? 'asc' : 'desc';

    const result = await query.select('photo_index.original_date').count('* as date_photo_count').groupBy('photo_index.original_date').orderBy('photo_index.original_date', sortOrder);
    const items = result.filter(item => item.original_date); // 过滤掉日期为空的
    // 检测路径有效性
    const validPathsWithStatus = validPaths.map(p => ({
      path: p,
      valid: fs.existsSync(p),
    }));

    return { items, validPaths: validPathsWithStatus };
  }

  /**
   * 获取时间轴照片列表
   * @param {Object} params 参数
   * @param {Object} user 用户
   */
  async getTimelinePhotoList(params, user) {
    const validPaths = await this.getValidPathsByParams(params, user);
    if (validPaths.length === 0) {
      return { list: [], total: 0 };
    }

    const knex = this.getKnex();
    const uid = user.id;
    const { query } = await this.buildBaseQuery(params, validPaths, user);

    const startTime = this.parseTimeInput(params.startTime);
    const endTime = this.parseTimeInput(params.endTime);
    if (startTime && endTime) {
      const [start, end] = startTime.getTime() <= endTime.getTime() ? [startTime, endTime] : [endTime, startTime];
      query.whereBetween('photo_index.original_time', [start.getTime(), end.getTime()]);
    } else if (startTime) {
      // 只给了下界：取该时刻起（含）之后的照片，而不是把整段查询丢弃成空列表
      query.where('photo_index.original_time', '>=', startTime.getTime());
    } else if (endTime) {
      // 只给了上界：取该时刻止（含）之前的照片
      query.where('photo_index.original_time', '<=', endTime.getTime());
    }
    // 两个边界都没有时不加时间过滤，按其它条件（search/geohash/album/face/year...）查询

    // 排序：普通列表按拍摄时间排，收藏列表按收藏时间排（与影音库一致）
    const sortOrder = params.sort === 'asc' ? 'asc' : 'desc';
    if (params.list_type === 'favorite') {
      // 收藏列表：优先按收藏时间排序，其次按拍摄时间作为辅助排序
      query.orderBy('photo_favorite.create_time', sortOrder).orderBy('photo_index.original_time', sortOrder);
    } else {
      // 其它列表仍按拍摄时间排序
      query.orderBy('photo_index.original_time', sortOrder); // 辅助排序
    }

    const selectFields = indexFields.map(f => `photo_index.${f}`);

    if (params.list_type === 'favorite') {
      query.select([...selectFields, knex.raw('1 as is_favorite')]);
    } else {
      query.leftJoin('photo_favorite', function () {
        this.on('photo_index.file_hash', '=', 'photo_favorite.file_hash').andOnVal('photo_favorite.uid', '=', uid);
      });
      query.select([...selectFields, knex.raw('CASE WHEN photo_favorite.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite')]);
    }
    const list = await query;

    // 原始文件扩展名 + 原始文件扩展名（大写）用于前端展示
    function rawShowExt(item) {
      if (!item.ext) return '';
      //索引是单独的raw 返回raw扩展名
      if (config.rawImgTypeList.includes(item.ext)) {
        return item.ext.toUpperCase().replace('.', '');
      }
      if (item.raw_filename && item.raw_filename.length > 0 && item.raw_filename.indexOf('.') > -1) {
        //索引是jpg加raw 返回JPG+RAW
        return `${item.ext.toUpperCase().replace('.', '')} +${path.extname(item.raw_filename).toUpperCase().replace('.', '')}`;
      }
      return '';
    }
    // 最终返回的photoList
    let photoList = list.map(item => ({
      ...item,
      fullpath: path.join(item.path, item.filename), // 添加 fullpath
      raw_show_ext: rawShowExt(item),
    }));
    return photoList;
  }

  getBoundsPrecisionByZoom(zoom) {
    const z = Number(zoom);
    if (!Number.isFinite(z)) return 2;
    if (z <= 4) return 2;
    if (z <= 6) return 3;
    if (z <= 8) return 4;
    return 5;
  }

  /**
   * 估算一个矩形在给定精度下会被切成多少个 geohash 格子。
   *
   * ngeohash 的精度 p 把全球切成 32^p 个格子，格子沿纬度/经度均匀分布，
   * 所以盒子数 ≈ 32^p × (纬度跨度/180) × (经度跨度/360)。
   * 实测校准过：全球 p2=1024、p5=31,703,040，中国 p5=1,125,978，均与公式吻合。
   */
  estimateBBoxCount(bounds, precision) {
    const p = Math.max(1, Math.min(9, Number(precision) || 0));
    if (!p) return 0;
    const dLat = Math.max(0, Math.min(180, bounds.maxLat - bounds.minLat));
    const dLng = Math.max(0, Math.min(360, bounds.maxLng - bounds.minLng));
    if (dLat === 0 || dLng === 0) return 0;
    return Math.ceil(Math.pow(32, p) * (dLat / 180) * (dLng / 360));
  }

  /**
   * 先按上面的估算挑精度，再去真正调用 geohash.bboxes。
   *
   * 原来是「先 bboxes 再看 length 超没超上限」：
   *   let hashes = geohash.bboxes(...);
   *   while (precision > 2 && hashes.length > maxReturnCount) { precision -= 1; hashes = geohash.bboxes(...); }
   * 内存峰值发生在 bboxes 内部——数组已经完整生成之后才比较长度。也就是说
   * 一个 zoom>8 的全屏请求会先把几千万个字符串建出来再扔掉，
   * 实测全球 p5 = 31,703,040 个格子（约 2 GB 字符串），进程直接被打爆。
   * 现在先用估算把精度降下来，bboxes 每次调用都是安全的；
   * 调用后仍保留长度兜底，防止 ngeohash 的行为与估算不符。
   */
  chooseBoundsPrecision(bounds, requestedPrecision, maxReturnCount) {
    let precision = Number.isFinite(requestedPrecision) ? Math.floor(requestedPrecision) : 2;
    precision = Math.max(2, Math.min(6, precision));
    const limit = Math.max(1, Number(maxReturnCount) || 1);
    // 留一倍余量：估算值贴近真实值，但 ngeohash 对边界格子的处理略多
    while (precision > 2 && this.estimateBBoxCount(bounds, precision) * 2 > limit) {
      precision -= 1;
    }
    return precision;
  }

  normalizeBounds(params) {
    const minLat = Number(params && params.minLat);
    const minLng = Number(params && params.minLng);
    const maxLat = Number(params && params.maxLat);
    const maxLng = Number(params && params.maxLng);

    if (![minLat, minLng, maxLat, maxLng].every(Number.isFinite)) return null;

    const lowLat = Math.max(-90, Math.min(minLat, maxLat));
    const highLat = Math.min(90, Math.max(minLat, maxLat));
    const lowLng = Math.max(-180, Math.min(minLng, maxLng));
    const highLng = Math.min(180, Math.max(minLng, maxLng));

    return { minLat: lowLat, minLng: lowLng, maxLat: highLat, maxLng: highLng };
  }

  async getBoundsPhoto(params, user) {
    const bounds = this.normalizeBounds(params);
    if (!bounds) return { mapPhoto: [], precision: this.getBoundsPrecisionByZoom(params && params.zoom), hash_count: 0 };

    const requestedMaxReturnCount = Number(params && params.maxReturnCount);
    const maxReturnCount = Number.isFinite(requestedMaxReturnCount) && requestedMaxReturnCount > 0 ? Math.min(requestedMaxReturnCount, 2000) : 500;

    const validPaths = await this.getValidPathsByParams(params, user);
    if (!validPaths || validPaths.length === 0) {
      return { mapPhoto: [], precision: this.chooseBoundsPrecision(bounds, this.getBoundsPrecisionByZoom(params && params.zoom), maxReturnCount), hash_count: 0 };
    }

    let precision = this.chooseBoundsPrecision(bounds, this.getBoundsPrecisionByZoom(params && params.zoom), maxReturnCount);
    let hashes = geohash.bboxes(bounds.minLat, bounds.minLng, bounds.maxLat, bounds.maxLng, precision) || [];
    while (precision > 2 && hashes.length > maxReturnCount) {
      precision -= 1;
      hashes = geohash.bboxes(bounds.minLat, bounds.minLng, bounds.maxLat, bounds.maxLng, precision) || [];
    }

    const { query: baseQuery } = await this.buildBaseQuery(params, validPaths, user);
    const selectFields = [
      'photo_index.id',
      'photo_index.file_hash',
      'photo_index.path',
      'photo_index.filename',
      'photo_index.type',
      'photo_index.duration',
      'photo_index.original_time',
      'photo_index.geohash',
      'photo_index.latitude',
      'photo_index.longitude',
    ];

    const mapPhoto = [];
    const seenIds = new Set();
    let failedHashes = 0;
    const geoColumn = precision >= 2 && precision <= 6 ? `photo_index.geohash${precision}` : 'photo_index.geohash';

    for (const h of hashes) {
      if (mapPhoto.length >= maxReturnCount) break;
      // 原来是 `.first().catch(() => null)`：单个格子的查询失败（索引缺失、
      // 数据库锁、磁盘错误）被静默吞掉，地图上那块区域就是空的，
      // 日志里一个字符都没有，谁也查不出照片为什么"没了"。
      // 现在失败会计数并在最后统一 Logger.warn 一次（格子可能上千个，
      // 逐条打日志会把 combined.log 刷满）。
      let row = null;
      try {
        row = await baseQuery
          .clone()
          .whereNotNull(geoColumn)
          .andWhere(geoColumn, '!=', '')
          .andWhere(geoColumn, h)
          .andWhereRaw('NOT (photo_index.latitude = 0 AND photo_index.longitude = 0)')
          .orderBy('photo_index.original_time', 'desc')
          .orderBy('photo_index.id', 'desc')
          .select(selectFields)
          .first();
      } catch (error) {
        failedHashes += 1;
        if (failedHashes === 1) {
          Logger.warn(`[photo/map] 网格 ${h} 的照片查询失败`, { error: error && error.message ? error.message : error });
        }
        continue;
      }

      if (!row || !row.id) continue;
      const id = Number(row.id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      mapPhoto.push({ ...row, fullpath: path.join(row.path, row.filename) });
    }

    if (failedHashes > 0) {
      Logger.warn(`[photo/map] ${failedHashes}/${hashes.length} 个网格的照片查询失败`, { precision: precision });
    }

    return { mapPhoto, precision, hash_count: hashes.length };
  }

  /**
   * 批量收藏/取消收藏
   * @param {Object} user 用户
   * @param {string[]} file_hashes 文件哈希列表
   * @param {boolean} is_favorite 目标状态：true=收藏，false=取消收藏
   */
  async batchFavorite(user, file_hashes, is_favorite) {
    return this.favoriteOps.batchFavorite(user, file_hashes, is_favorite);
  }

  /**
   * 切换收藏状态
   * @param {Object} user 用户
   * @param {string} file_hash 文件哈希
   */
  async toggleFavorite(user, file_hash) {
    return this.favoriteOps.toggleFavorite(user, file_hash);
  }

  /**
   * 批量将照片放入回收站或从回收站移出
   * @param {number[]} ids 照片ID列表
   * @param {boolean} in_trash 是否放入回收站
   * @param {Object} user 当前用户，用于非管理员的删除权限校验
   */
  async batchTrash(ids, in_trash, user) {
    return this.trashOps.batchTrash(ids, in_trash, user);
  }

  /**
   * 获取回收站内的照片列表
   * @param {Object} params 查询参数
   * @param {Object} user 用户
   */
  async getTrashPhotoList(params, user) {
    return this.trashOps.getTrashPhotoList(params, user);
  }

  /**
   * 从回收站中删除（物理删除）
   * @param {number[]} ids 照片ID列表
   * @param {boolean} recycle 是否放入系统回收站
   * @param {Object} user 用户信息
   * @param {Object} options 删除选项
   * @param {number} options.deleteLivePhotoFile 是否删除关联的livephoto文件
   * @param {number} options.deleteRawFile 是否删除关联的raw文件
   */
  async deleteFromTrash(ids, recycle = false, user, options = {}) {
    return this.trashOps.deleteFromTrash(ids, recycle, user, options);
  }

  /**
   * 从回收站中恢复
   * @param {number[]} ids 照片ID列表
   * @param {Object} user 用户信息，非管理员只能恢复自己可见照片源内的照片
   */
  async restoreFromTrash(ids, user) {
    return this.trashOps.restoreFromTrash(ids, user);
  }

  async restoreAllFromTrash(user) {
    return this.trashOps.restoreAllFromTrash(user);
  }

  /**
   * 清空回收站
   * @param {Object} user 用户
   * @param {boolean} recycle 是否放入系统回收站
   * @param {Object} options 删除选项
   * @param {number} options.deleteLivePhotoFile 是否删除关联的livephoto文件
   * @param {number} options.deleteRawFile 是否删除关联的raw文件
   */
  async emptyTrash(user, recycle = false, options = {}) {
    return this.trashOps.emptyTrash(user, recycle, options);
  }
}

module.exports = new PhotoTimeLineService();
