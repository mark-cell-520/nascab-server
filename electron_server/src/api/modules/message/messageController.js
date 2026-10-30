const ResponseUtil = require('../../apiUtils/responseUtil');
const { MessageService } = require('./messageService');
const tableUser = require('../../../db/table/tableUser');
const Logger = require('../../../utils/logger');

// 原来每个 catch 都是 `ResponseUtil.error(req, res, e.message, statusCode)`。
// e.message 基本不是 message key，ResponseUtil.isUserFacingMessage 会把带中文的原文
// 当成人话原样回给前端——SQLite/knex 的报错连表名、SQL、宿主机绝对路径一起漏出去。
// 这里显式只放行已知 key，细节靠 Logger.error 落盘排查。
const MSG_KEYS = [
  'common.PARAM_ERROR',
  'common.NOT_FOUND',
  'auth.PERMISSION_DENIED',
  'message.MESSAGE_REQUIRED',
  'message.MESSAGE_ID_REQUIRED',
  'message.MESSAGE_NOT_FOUND',
  'common.ERROR',
];

function safeMsgKey(error) {
  const raw = error && error.message ? String(error.message) : '';
  return MSG_KEYS.includes(raw) ? raw : 'common.ERROR';
}

function safeStatus(error) {
  const code = error && error.statusCode ? Number(error.statusCode) : 0;
  return Number.isFinite(code) && code >= 400 && code <= 599 ? code : 500;
}

// 原来 add 的越权判断是 `isPublic === 0 || level > 0`，严格相等让字符串 '0' 直接穿透，
// 负数 level 也照样放行。这里统一按数值归一后再判断。
function toNum(value, dflt) {
  if (value === null || value === undefined || value === '') return dflt;
  const n = Number(value);
  return Number.isFinite(n) ? n : dflt;
}

class MessageController {
  async list(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const query = req.query || {};
      const page = query.page || 1;
      const pageSize = query.pageSize || 20;
      const level = query.level;
      const keyword = query.keyword;

      const userType = req.user.type || '';
      const isAdmin = userType === tableUser.TYPE_SUPER_ADMIN || userType === tableUser.TYPE_ADMIN;

      const service = new MessageService(req.dbMain);
      const result = await service.getMessages({
        uid,
        page,
        pageSize,
        level,
        keyword,
        isAdmin,
      });

      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (e) {
      Logger.error('message/list error:', e);
      return ResponseUtil.error(req, res, safeMsgKey(e), safeStatus(e));
    }
  }

  async add(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const title = body.title ?? '';
      const message = body.message;
      const action = body.action ?? null;
      const level = body.level ?? 0;
      const isPublic = body.isPublic ?? 1;

      if (!message || typeof message !== 'string' || !message.trim()) {
        return ResponseUtil.error(req, res, 'message.MESSAGE_REQUIRED', 400);
      }

      const userType = req.user.type || '';
      const isAdmin = userType === tableUser.TYPE_SUPER_ADMIN || userType === tableUser.TYPE_ADMIN;

      // 普通用户只能发公开的 level 0 纯文本消息：
      // - isPublic 传 '0'（字符串）原来是公开的，现在按数值判定
      // - level 传负数原来能穿透 `level > 0`，现在只要不是 0 就拒
      const isPublicNum = toNum(isPublic, 1);
      const levelNum = toNum(level, 0);
      if (!isAdmin && (isPublicNum === 0 || levelNum !== 0 || (action !== null && action !== undefined))) {
        return ResponseUtil.forbidden(req, res);
      }

      const service = new MessageService(req.dbMain);
      const result = await service.addMessage({
        uid,
        title,
        message,
        action,
        level: levelNum,
        isPublic: isPublicNum,
      });

      return ResponseUtil.success(req, res, result, 'message.ADD_SUCCESS', 201);
    } catch (e) {
      Logger.error('message/add error:', e);
      return ResponseUtil.error(req, res, safeMsgKey(e), safeStatus(e));
    }
  }

  async markAsRead(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const messageId = body.messageId;

      const userType = req.user.type || '';
      const isAdmin = userType === tableUser.TYPE_SUPER_ADMIN || userType === tableUser.TYPE_ADMIN;

      const service = new MessageService(req.dbMain);
      const result = await service.markAsRead({
        uid,
        messageId,
        isAdmin,
      });

      return ResponseUtil.success(req, res, result, 'message.MARK_READ_SUCCESS', 200);
    } catch (e) {
      Logger.error('message/markAsRead error:', e);
      return ResponseUtil.error(req, res, safeMsgKey(e), safeStatus(e));
    }
  }

  async delete(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const messageId = body.messageId;

      if (!messageId) {
        return ResponseUtil.error(req, res, 'message.MESSAGE_ID_REQUIRED', 400);
      }

      const userType = req.user.type || '';
      const isAdmin = userType === tableUser.TYPE_SUPER_ADMIN || userType === tableUser.TYPE_ADMIN;

      const service = new MessageService(req.dbMain);
      const result = await service.deleteMessage({
        uid,
        messageId,
        isAdmin,
      });

      if (!result.deleted) {
        return ResponseUtil.error(req, res, 'message.MESSAGE_NOT_FOUND', 404);
      }

      return ResponseUtil.success(req, res, result, 'message.DELETE_SUCCESS', 200);
    } catch (e) {
      Logger.error('message/delete error:', e);
      return ResponseUtil.error(req, res, safeMsgKey(e), safeStatus(e));
    }
  }

  async clear(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const level = body.level;

      const userType = req.user.type || '';
      const isAdmin = userType === tableUser.TYPE_SUPER_ADMIN || userType === tableUser.TYPE_ADMIN;

      const service = new MessageService(req.dbMain);
      const result = await service.clearMessages({
        uid,
        level,
        isAdmin,
      });

      return ResponseUtil.success(req, res, result, 'message.CLEAR_SUCCESS', 200);
    } catch (e) {
      Logger.error('message/clear error:', e);
      return ResponseUtil.error(req, res, safeMsgKey(e), safeStatus(e));
    }
  }

  async getUnreadCount(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const userType = req.user.type || '';
      const isAdmin = userType === tableUser.TYPE_SUPER_ADMIN || userType === tableUser.TYPE_ADMIN;

      const service = new MessageService(req.dbMain);
      const count = await service.getUnreadCount({
        uid,
        isAdmin,
      });

      return ResponseUtil.success(req, res, { count }, 'common.SUCCESS', 200);
    } catch (e) {
      Logger.error('message/unreadCount error:', e);
      return ResponseUtil.error(req, res, safeMsgKey(e), safeStatus(e));
    }
  }
}

module.exports = new MessageController();
