const ResponseUtil = require('../../../apiUtils/responseUtil');
const PlayListService = require('./playListService');

class PlayListController {
  async list(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const service = new PlayListService(req.dbMusic);
      const result = await service.listLists(req.body || {}, user);
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 500;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  async get(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const listId = req.body && (req.body.list_id ?? req.body.listId ?? req.body.id);
      if (!listId) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);

      const service = new PlayListService(req.dbMusic);
      const result = await service.getList({ listId, user });
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 500;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  async create(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const name = req.body && req.body.name;
      if (!name) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);

      const service = new PlayListService(req.dbMusic);
      const result = await service.createList({ name, user });
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 201);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 400;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  async update(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const listId = req.body && (req.body.list_id ?? req.body.listId ?? req.body.id);
      const name = req.body && req.body.name;
      if (!listId || !name) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);

      const service = new PlayListService(req.dbMusic);
      const result = await service.updateList({ listId, name, user });
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 400;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  async delete(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const listId = req.body && (req.body.list_id ?? req.body.listId ?? req.body.id);
      if (!listId) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);

      const service = new PlayListService(req.dbMusic);
      const ok = await service.deleteList({ listId, user });
      return ResponseUtil.success(req, res, ok, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 400;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  async addIndexes(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const listId = body.list_id ?? body.listId ?? body.id;
      const indexIds = body.index_ids ?? body.indexIds ?? body.index_id ?? body.indexId;
      if (!listId || !indexIds) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);

      const service = new PlayListService(req.dbMusic);
      const ok = await service.addListIndexes({ listId, indexIds, user });
      return ResponseUtil.success(req, res, ok, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 400;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  async removeIndexes(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const listId = body.list_id ?? body.listId ?? body.id;
      const indexIds = body.index_ids ?? body.indexIds ?? body.index_id ?? body.indexId;
      if (!listId || !indexIds) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);

      const service = new PlayListService(req.dbMusic);
      const ok = await service.removeListIndexes({ listId, indexIds, user });
      return ResponseUtil.success(req, res, ok, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 400;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  /** 按给定顺序重排整个播放列表 */
  async reorderIndexes(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const listId = body.list_id ?? body.listId ?? body.id;
      const indexIds = body.index_ids ?? body.indexIds;
      if (!listId || !Array.isArray(indexIds)) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }

      const service = new PlayListService(req.dbMusic);
      const ok = await service.reorderIndexes({ listId, indexIds, user });
      return ResponseUtil.success(req, res, ok, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 400;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  /** 把一首曲目移到指定位置（0 基） */
  async moveIndex(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const listId = body.list_id ?? body.listId ?? body.id;
      const indexId = body.index_id ?? body.indexId;
      const toPosition = body.to_position ?? body.toPosition ?? body.position;
      if (!listId || indexId === undefined || toPosition === undefined) {
        return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);
      }

      const service = new PlayListService(req.dbMusic);
      const ok = await service.moveIndex({ listId, indexId, toPosition, user });
      return ResponseUtil.success(req, res, ok, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 400;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }

  /** 清空播放列表的曲目（不动歌单本身） */
  async clearIndexes(req, res) {
    try {
      const user = req.user;
      const uid = user && user.id ? Number(user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const listId = body.list_id ?? body.listId ?? body.id;
      if (!listId) return ResponseUtil.error(req, res, 'common.PARAM_ERROR', 400);

      const service = new PlayListService(req.dbMusic);
      const ok = await service.clearIndexes({ listId, user });
      return ResponseUtil.success(req, res, ok, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? e.message : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 400;
      return ResponseUtil.error(req, res, msgKey === 'common.ERROR' ? 'common.ERROR' : msgKey, statusCode);
    }
  }
}

module.exports = new PlayListController();
