const path = require('path');
const userUtil = require('../../../../utils/userUtil');
const Logger = require('../../../../utils/logger');
const { applyBookIndexPathPrefixFilter, isPathInside } = require('../util/bookPathQueryUtil');

function _parsePathList(pathListText) {
  if (!pathListText) return [];
  try {
    const arr = JSON.parse(String(pathListText));
    return Array.isArray(arr) ? arr.map(v => String(v || '').trim()).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

// 原实现在本文件里抄了一份（与 bookListService / bookCustomListService / bookHistoryService
// 三份完全相同），已抽到 ../util/bookPathQueryUtil 统一维护。
const _applyBookIndexPathPrefixFilter = applyBookIndexPathPrefixFilter;

function _sqlIsUniqueViolation(err) {
  const msg = err && err.message ? String(err.message).toLowerCase() : '';
  return msg.includes('unique') || msg.includes('constraint');
}

class BookCollectionService {
  // 原来是 `return user.id`：JWT 中间件偶发没挂上 req.user（或内部调用漏传）时
  // 直接 TypeError，控制器转成 500，而真正的问题是"没登录"。统一归一成 0，
  // 由调用方按未登录处理。
  _uid(user) {
    const uid = user && user.id ? Number(user.id) : 0;
    return Number.isFinite(uid) && uid > 0 ? uid : 0;
  }

  async _getCollectionById(knexBook, collectionId) {
    const id = Number(collectionId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return knexBook('book_collection').where({ id }).first();
  }

  async _getSourcePaths(knexBook) {
    const sources = await knexBook('book_source').select('path');
    return (sources || []).map(s => (s && s.path ? String(s.path).trim() : '')).filter(Boolean);
  }

  async _validateAndNormalizePaths(knexBook, pathList) {
    const input = Array.isArray(pathList) ? pathList : [];
    const cleaned = input.map(p => String(p || '').trim()).filter(Boolean);
    const uniq = [...new Set(cleaned)];
    if (uniq.length === 0) {
      const err = new Error('common.PARAM_ERROR');
      err.statusCode = 400;
      throw err;
    }

    const sourcePaths = await this._getSourcePaths(knexBook);
    if (sourcePaths.length === 0) {
      const err = new Error('book.BOOK_SOURCE_LIST_EMPTY');
      err.statusCode = 400;
      throw err;
    }

    // 原来是 `p.startsWith(s)`：'/data/books2' 会被判成在源目录 '/data/books' 底下，
    // 于是"我的珍藏"能收录源目录之外的书，等于绕过了 bookSourceService 的边界校验。
    // 必须补上分隔符边界。
    const invalid = uniq.find(p => !sourcePaths.some(s => isPathInside(s, p)));
    if (invalid) {
      const err = new Error('book.BOOK_SOURCE_OUT_OF_RANGE');
      err.statusCode = 400;
      err.args = { path: invalid };
      throw err;
    }

    return uniq;
  }

  async _ensureCollectionAccess({ knexBook, collectionId, user }) {
    const uid = this._uid(user);
    const collection = await this._getCollectionById(knexBook, collectionId);
    if (!collection) {
      const err = new Error('common.NOT_FOUND');
      err.statusCode = 404;
      throw err;
    }

    if (userUtil.isAdmin(user)) {
      return { collection, role: 'admin' };
    }

    if (Number(collection.uid) !== Number(uid)) {
      const err = new Error('auth.PERMISSION_DENIED');
      err.statusCode = 403;
      throw err;
    }

    return { collection, role: 'owner' };
  }

  async _getCollectionPreviews(knexBook, pathList) {
    const prefixes = Array.isArray(pathList) ? pathList.filter(Boolean) : [];
    if (prefixes.length === 0) return [];

    const rows = await knexBook('book_index as b')
      .whereIn('b.show_type', ['book', 'series'])
      .modify(qb => _applyBookIndexPathPrefixFilter(qb, prefixes))
      .select('b.id', 'b.path', 'b.filename', 'b.file_hash', 'b.show_type', 'b.cover_state', 'b.create_time')
      .select(
        knexBook.raw(
          `
          case
            when b.show_type = 'series' then (
              select path || ? || filename
              from book_index as s
              where s.show_type = 'subbook'
                and s.is_file = 1
                and s.path = (b.path || ? || b.filename)
              order by s.id asc
              limit 1
            )
            else ''
          end as first_file_path
          `,
          [path.sep, path.sep]
        )
      )
      .orderBy('b.create_time', 'desc')
      .orderBy('b.id', 'desc')
      .limit(4)
      .catch(err => {
        // 预览图查询失败不该把整个珍藏列表拖成 500，但也不能一声不吭地返回空——
        // 那样用户看到的是"珍藏里有书但没封面"，完全看不出是数据库出了问题。
        Logger.error('book collection previews failed:', err);
        return [];
      });

    return (rows || []).map(r => ({
      id: Number(r && r.id) || 0,
      file_hash: r && r.file_hash ? String(r.file_hash) : '',
      show_type: r && r.show_type ? String(r.show_type) : '',
      cover_state: Number(r && r.cover_state) || 0,
      full_path: r && r.path && r.filename ? path.join(String(r.path), String(r.filename)) : '',
      first_file_path: r && r.first_file_path ? String(r.first_file_path) : '',
    }));
  }

  async listCollections({ knexBook }, params, user) {
    const uid = this._uid(user);
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(params.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const keyword = String(params.keyword || '').trim();

    const sortFieldInput = String(params.sortField || 'create_time');
    const sortOrderInput = String(params.sortOrder || 'desc').toLowerCase();
    const sortOrder = sortOrderInput === 'asc' ? 'asc' : 'desc';
    const sortField = sortFieldInput === 'name' || sortFieldInput === 'create_time' ? sortFieldInput : 'create_time';

    // SQLite 的 LIKE 默认没有转义符，`%`/`_` 会被当通配符：珍藏名里带 "100%" 或 "a_b"
    // 时搜索会匹配到一堆不相干的珍藏。bookCustomListService 那边早就转义了，这里漏了。
    const base = knexBook('book_collection as c')
      .modify(qb => {
        if (keyword) {
          const escaped = keyword.replace(/[\\%_]/g, ch => '\\' + ch);
          qb.whereRaw("c.name LIKE ? ESCAPE '\\'", [`%${escaped}%`]);
        }
        qb.where('c.uid', uid);
      })
      .select('c.id', 'c.uid', 'c.name', 'c.path_list', 'c.create_time')
      .orderBy(`c.${sortField}`, sortOrder)
      .orderBy('c.id', 'desc');

    const [{ count }] = await base.clone().clearSelect().clearOrder().count('* as count');
    const items = await base.clone().offset(offset).limit(pageSize);

    const enriched = await Promise.all(
      (items || []).map(async row => {
        const pathList = _parsePathList(row.path_list);
        const previews = await this._getCollectionPreviews(knexBook, pathList);
        return {
          id: row.id,
          uid: row.uid,
          name: row.name,
          path_list: pathList,
          create_time: row.create_time,
          previews,
        };
      })
    );

    return {
      items: enriched,
      pagination: {
        total: Number(count || 0),
        page,
        pageSize,
      },
    };
  }

  async getCollection({ knexBook }, collectionId, user) {
    const { collection } = await this._ensureCollectionAccess({ knexBook, collectionId, user });
    return {
      id: collection.id,
      uid: collection.uid,
      name: collection.name,
      path_list: _parsePathList(collection.path_list),
      create_time: collection.create_time,
    };
  }

  async createCollection({ knexBook }, payload, user) {
    const uid = this._uid(user);
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('common.PARAM_ERROR');

    const normalizedPaths = await this._validateAndNormalizePaths(knexBook, payload.path_list);

    const dup = await knexBook('book_collection').where({ uid, name }).first();
    if (dup) {
      const err = new Error('book.BOOK_COLLECTION_NAME_EXISTS');
      err.statusCode = 409;
      throw err;
    }

    // book_collection 上有 (uid, name) 唯一索引。两个标签页同时建同名珍藏时，
    // 上面的预查查不到冲突， insert 会直接撞约束变成 500 + common.ERROR，
    // 用户看到的是"出错了"而不是"名字重了"。这里把唯一冲突翻成 409。
    try {
      const [id] = await knexBook('book_collection').insert({
        uid,
        name,
        path_list: JSON.stringify(normalizedPaths),
        create_time: new Date(),
      });
      return this.getCollection({ knexBook }, id, user);
    } catch (e) {
      if (_sqlIsUniqueViolation(e)) {
        const err = new Error('book.BOOK_COLLECTION_NAME_EXISTS');
        err.statusCode = 409;
        throw err;
      }
      throw e;
    }
  }

  async updateCollection({ knexBook }, payload, user) {
    const collectionId = Number(payload.id);
    if (!Number.isFinite(collectionId) || collectionId <= 0) throw new Error('common.PARAM_ERROR');

    const { collection } = await this._ensureCollectionAccess({ knexBook, collectionId, user });

    const name = String(payload.name || '').trim();
    if (!name) throw new Error('common.PARAM_ERROR');

    const normalizedPaths = await this._validateAndNormalizePaths(knexBook, payload.path_list);

    const uid = this._uid(user);
    const dup = await knexBook('book_collection').where({ uid, name }).andWhereNot({ id: collection.id }).first();
    if (dup) {
      const err = new Error('book.BOOK_COLLECTION_NAME_EXISTS');
      err.statusCode = 409;
      throw err;
    }

    // 和 createCollection 同一回事：预查之后、update 之前撞上唯一索引，
    // 不接住就变成 500 + common.ERROR。
    try {
      const affected = await knexBook('book_collection')
        .where({ id: collection.id })
        .update({
          name,
          path_list: JSON.stringify(normalizedPaths),
        });
      if (!affected) {
        const err = new Error('common.NOT_FOUND');
        err.statusCode = 404;
        throw err;
      }
    } catch (e) {
      if (_sqlIsUniqueViolation(e)) {
        const err = new Error('book.BOOK_COLLECTION_NAME_EXISTS');
        err.statusCode = 409;
        throw err;
      }
      throw e;
    }

    return true;
  }

  async deleteCollection({ knexBook }, payload, user) {
    const collectionId = Number(payload.id);
    if (!Number.isFinite(collectionId) || collectionId <= 0) throw new Error('common.PARAM_ERROR');

    const { collection } = await this._ensureCollectionAccess({ knexBook, collectionId, user });
    const affected = await knexBook('book_collection').where({ id: collection.id }).delete();
    return { affected };
  }
}

module.exports = new BookCollectionService();
