const Logger = require('../../../../utils/logger');

class BookFavoriteService {
  constructor(knexBook) {
    this.knexBook = knexBook;
    this.tableName = 'book_favorite';
  }

  _getUid(user) {
    const uid = user && user.id ? Number(user.id) : 0;
    return uid > 0 ? uid : 0;
  }

  async addFavorite(user, indexId) {
    const uid = this._getUid(user);
    const safeIndexId = Number(indexId) || 0;
    if (!uid || !safeIndexId) return { is_favorite: false };

    const insertRow = {
      uid,
      index_id: safeIndexId,
      create_time: this.knexBook.fn.now(),
    };

    const q = this.knexBook(this.tableName).insert(insertRow);
    if (typeof q.onConflict === 'function') {
      await q.onConflict(['uid', 'index_id']).ignore().catch(err => {
        // onConflict 已经忽略了重复收藏，走到这里说明是真故障（库锁、磁盘满）。
        // 原来一声不吭，用户点完"收藏"图标不亮，服务端毫无痕迹可查。
        Logger.error('book favorite insert failed:', err);
        throw err;
      });
    } else {
      try {
        await q;
      } catch (err) {
        Logger.error('book favorite insert failed:', err);
        throw err;
      }
    }
    return { is_favorite: true };
  }

  async removeFavorite(user, indexId) {
    const uid = this._getUid(user);
    const safeIndexId = Number(indexId) || 0;
    if (!uid || !safeIndexId) return { is_favorite: false };

    await this.knexBook(this.tableName)
      .where({ uid, index_id: safeIndexId })
      .del()
      .catch(err => {
        // 原来 `catch(() => {})`：取消收藏失败时接口照样返回成功，
        // 用户以为取消了，刷新后收藏还在，且服务端无任何记录。
        Logger.error('book favorite delete failed:', err);
        throw err;
      });
    return { is_favorite: false };
  }

  async batchFavorite(user, indexIds, isFavorite) {
    const uid = this._getUid(user);
    const list = Array.isArray(indexIds) ? indexIds.map(v => Number(v) || 0).filter(v => v > 0) : [];
    const uniqueList = Array.from(new Set(list));
    if (!uid || uniqueList.length === 0) return;

    if (isFavorite) {
      const existingSet = await this.getFavoriteIndexIdSet(user, uniqueList);
      const toInsert = uniqueList
        .filter(id => !existingSet.has(id))
        .map(id => ({
          uid,
          index_id: id,
          create_time: this.knexBook.fn.now(),
        }));
      if (toInsert.length === 0) return;

      const q = this.knexBook(this.tableName).insert(toInsert);
      if (typeof q.onConflict === 'function') {
        await q.onConflict(['uid', 'index_id']).ignore().catch(err => {
          Logger.error('book favorite batch insert failed:', err);
          throw err;
        });
      } else {
        await q.catch(err => {
          Logger.error('book favorite batch insert failed:', err);
          throw err;
        });
      }
      return;
    }

    await this.knexBook(this.tableName)
      .where({ uid })
      .whereIn('index_id', uniqueList)
      .del()
      .catch(err => {
        Logger.error('book favorite batch delete failed:', err);
        throw err;
      });
  }

  async getFavoriteIndexIdSet(user, indexIds) {
    const uid = this._getUid(user);
    const list = Array.isArray(indexIds) ? indexIds.map(v => Number(v) || 0).filter(v => v > 0) : [];
    if (!uid || list.length === 0) return new Set();

    const rows = await this.knexBook(this.tableName)
      .where({ uid })
      .whereIn('index_id', list)
      .select('index_id')
      .catch(err => {
        // 读路径不往外抛（否则整个书籍列表会跟着 500），但必须留痕：
        // 静默返回空集会让"我的收藏"显示成一本都没有，完全看不出是库出了问题。
        Logger.error('book favorite read failed:', err);
        return [];
      });

    return new Set((rows || []).map(r => Number(r && r.index_id) || 0).filter(v => v > 0));
  }
}

module.exports = BookFavoriteService;
