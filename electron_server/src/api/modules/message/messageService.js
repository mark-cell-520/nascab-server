// 原来的实现有几个会直接让"消息中心"这个功能废掉的问题：
// 1. read_status 是 message 表上的一个全局标志。任何人点一下"已读"（甚至点"全部已读"），
//    所有其他用户的未读角标一起清零——消息永远显示成已读，新消息来了也看不出来。
// 2. delete/clear 对非管理员只加了 `is_public = 1 OR uid = 自己` 的条件，
//    等于任何一个普通用户都能删掉管理员发的公开广播、一次清空全部广播。
// 3. keyword 搜索直接拼进 LIKE，`%`/`_` 会变成通配符；而且只搜 message 不搜 title。
// 现在已读状态按用户记到 message_read 表，删除/清空按属主鉴权，LIKE 通配符转义。
class MessageService {
  constructor(knex) {
    this.knex = knex;
    this.table = 'message';
    this.readTable = 'message_read';
  }

  paramError(messageKey = 'common.PARAM_ERROR') {
    const err = new Error(messageKey);
    err.statusCode = 400;
    return err;
  }

  forbidden(messageKey = 'auth.PERMISSION_DENIED') {
    const err = new Error(messageKey);
    err.statusCode = 403;
    return err;
  }

  notFound(messageKey = 'message.MESSAGE_NOT_FOUND') {
    const err = new Error(messageKey);
    err.statusCode = 404;
    return err;
  }

  /**
   * action 字段数据格式（存储在 DB 为 JSON 字符串，接口返回为对象）：
   * - 不处理：null / undefined / {} / {"type":"none"}
   * - 跳转外部网页：{"type":"openUrl","url":"https://example.com"}
   * - 打开内部窗口/应用：{"type":"openApp","app":"folder"}
   * 非对象非 JSON 字符串的入参（数字、布尔、坏 JSON）原来会被存成 "1"/"true" 这种
   * 假 JSON，前端解析失败后整条消息的点跳转就没了，这里统一归一成 null。
   */
  normalizeAction(action) {
    if (action === null || action === undefined) return null;
    if (typeof action === 'string') {
      const s = action.trim();
      if (!s) return null;
      try {
        return JSON.stringify(JSON.parse(s));
      } catch (_) {
        return null;
      }
    }
    if (typeof action === 'object' && !Array.isArray(action)) {
      try {
        return JSON.stringify(action);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  toInt(value, dflt = 0) {
    if (value === null || value === undefined || value === '') return dflt;
    const n = Number(value);
    return Number.isFinite(n) ? n : dflt;
  }

  async addMessage({ uid = 0, title = '', message, action = null, level = 0, isPublic = 1 }) {
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new Error('message.MESSAGE_REQUIRED');
    }

    const safeTitle = typeof title === 'string' ? title.trim() : '';

    // level 原来是 `Number(level) || 0`：负数能原样存进去，前端按 level 过滤时
    // 这些消息哪个分组都算不上，等于凭空消失。
    const levelNum = this.toInt(level, 0);
    const safeLevel = levelNum > 0 ? Math.floor(levelNum) : 0;

    // isPublic 原来按 `Number(isPublic) !== 0` 判断：字符串 '0' 会被算成公开，
    // 客户端一个手滑就把本该私发的消息广播给全站。
    const publicNum = this.toInt(isPublic, 1);
    const safePublic = publicNum === 0 ? 0 : 1;

    const actionJson = this.normalizeAction(action);

    const row = {
      uid: Number(uid) || 0,
      title: safeTitle,
      message: message.trim(),
      action: actionJson,
      read_status: 0,
      level: safeLevel,
      is_public: safePublic,
      create_time: new Date(),
    };

    const inserted = await this.knex(this.table).insert(row);
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    let actionObj = null;
    if (row.action && typeof row.action === 'string') {
      try {
        actionObj = JSON.parse(row.action);
      } catch (_) {
        actionObj = null;
      }
    }
    return { id, ...row, action: actionObj };
  }

  /**
   * SQLite 的 LIKE 默认没有转义符，`%`/`_` 会被当成通配符：搜 "100%" 会把所有消息都匹配上。
   * 这里显式指定 escape '\' 并把这两个字符反转义。
   */
  likePattern(keyword) {
    const escaped = String(keyword).replace(/[\\%_]/g, ch => '\\' + ch);
    return `%${escaped}%`;
  }

  async getMessages({ uid = 0, page = 1, pageSize = 20, level = null, keyword = null, isAdmin = false }) {
    const userId = Number(uid) || 0;
    const pageNum = Math.max(1, this.toInt(page, 1));
    const size = Math.max(1, Math.min(100, this.toInt(pageSize, 20)));
    const offset = (pageNum - 1) * size;

    let query = this.knex(this.table);

    if (isAdmin) {
      // 管理员能看到全部消息（公开 + 所有人的私有通知）
      query = query.where(function () {
        this.where('is_public', 1).orWhere('is_public', 0);
      });
    } else {
      query = query.where(function () {
        this.where('is_public', 1).orWhere('uid', userId);
      });
    }

    const levelNum = level === null || level === undefined || level === '' ? null : Number(level);
    if (levelNum !== null && Number.isFinite(levelNum)) {
      query = query.where('level', Math.floor(levelNum));
    }

    if (keyword && typeof keyword === 'string' && keyword.trim()) {
      const pattern = this.likePattern(keyword.trim());
      // 原来只搜 message 正文，搜标题永远搜不到——消息中心基本都是靠标题认消息的。
      query = query.where(function () {
        this.whereRaw("message like ? escape '\\'", [pattern]).orWhereRaw("title like ? escape '\\'", [pattern]);
      });
    }

    const total = await query.clone().count('* as count').first();
    const rows = await query.orderBy('create_time', 'desc').limit(size).offset(offset);

    // 已读状态按用户查：message.read_status 是"全局已阅"，message_read 是这个用户自己点过的。
    const ids = (rows || []).map(r => Number(r && r.id)).filter(n => Number.isFinite(n) && n > 0);
    const readSet = new Set();
    if (ids.length > 0) {
      const readRows = await this.knex(this.readTable).where('uid', userId).whereIn('message_id', ids).select('message_id');
      for (const r of readRows || []) readSet.add(Number(r.message_id));
    }

    const items = (rows || []).map(r => {
      const title = r && typeof r.title === 'string' ? r.title : '';
      let actionObj = null;
      if (r && r.action && typeof r.action === 'string') {
        try {
          actionObj = JSON.parse(r.action);
        } catch (_) {
          actionObj = null;
        }
      } else if (r && r.action && typeof r.action === 'object') {
        actionObj = r.action;
      }
      const globallyRead = Number(r && r.read_status) === 1;
      return {
        ...r,
        title,
        read_status: globallyRead || readSet.has(Number(r && r.id)) ? 1 : 0,
        action: actionObj,
      };
    });

    const totalCount = total ? Number(total.count) : 0;
    return {
      items,
      total: totalCount,
      page: pageNum,
      pageSize: size,
      totalPages: Math.ceil(totalCount / size),
    };
  }

  /** 当前用户可见的消息 id 集合 */
  async visibleMessageIds({ uid = 0, isAdmin = false }) {
    const userId = Number(uid) || 0;
    let query = this.knex(this.table).select('id');
    if (!isAdmin) {
      query = query.where(function () {
        this.where('is_public', 1).orWhere('uid', userId);
      });
    }
    const rows = await query;
    return (rows || []).map(r => Number(r.id)).filter(n => Number.isFinite(n) && n > 0);
  }

  async markAsRead({ uid = 0, messageId = null, isAdmin = false }) {
    const userId = Number(uid) || 0;
    const msgId = messageId === null || messageId === undefined || messageId === '' ? 0 : Number(messageId);

    let ids;
    if (msgId > 0) {
      const row = await this.knex(this.table).where('id', msgId).first();
      if (!row) throw this.notFound();
      // 非管理员只能标自己可见的消息：私有通知是别人的，点一下就去读它本身就是越权。
      if (!isAdmin && Number(row.is_public) !== 1 && Number(row.uid) !== userId) {
        throw this.forbidden();
      }
      ids = [msgId];
    } else {
      // 全部已读：只标记当前用户可见的消息
      ids = await this.visibleMessageIds({ uid: userId, isAdmin });
    }

    if (ids.length === 0) return { updated: 0 };

    // onConflict ignore：连点两下"已读"会撞 (uid, message_id) 唯一索引，
    // 原来是裸 update 所以没这个问题，换成插入后必须防一手。
    await this.knex(this.readTable)
      .insert(ids.map(id => ({ uid: userId, message_id: id })))
      .onConflict(['uid', 'message_id'])
      .ignore();

    const counted = await this.knex(this.readTable).where('uid', userId).whereIn('message_id', ids).count('* as count').first();
    return { updated: counted ? Number(counted.count) : 0 };
  }

  async deleteMessage({ uid = 0, messageId = null, isAdmin = false }) {
    const userId = Number(uid) || 0;
    const msgId = messageId === null || messageId === undefined || messageId === '' ? 0 : Number(messageId);
    if (!msgId) throw this.paramError('message.MESSAGE_ID_REQUIRED');

    const row = await this.knex(this.table).where('id', msgId).first();
    if (!row) return { deleted: false };

    // 原来是 `is_public = 1 OR uid = 自己`：普通用户能把管理员的公开广播删掉，
    // 一条广播发出来不到一分钟就能被任何一个用户清掉。
    if (!isAdmin && Number(row.uid) !== userId) {
      throw this.forbidden();
    }

    const affected = await this.knex(this.table).where('id', msgId).del();
    await this.knex(this.readTable).where('message_id', msgId).del();
    return { deleted: affected > 0 };
  }

  async clearMessages({ uid = 0, level = null, isAdmin = false }) {
    const userId = Number(uid) || 0;

    let query = this.knex(this.table);
    // 非管理员只清自己的消息。原来带 `is_public = 1`，等于一键清空全站广播。
    if (!isAdmin) query = query.where('uid', userId);

    const levelNum = level === null || level === undefined || level === '' ? null : Number(level);
    if (levelNum !== null && Number.isFinite(levelNum)) {
      query = query.where('level', Math.floor(levelNum));
    }

    const ids = (await query.clone().select('id')).map(r => Number(r.id)).filter(n => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return { deleted: 0 };

    const affected = await this.knex(this.table).whereIn('id', ids).del();
    // 顺手清掉已读记录，否则下次同 id 复用时会继承上一个用户的已读状态
    await this.knex(this.readTable).whereIn('message_id', ids).del();
    return { deleted: affected };
  }

  async getUnreadCount({ uid = 0, isAdmin = false }) {
    const userId = Number(uid) || 0;

    let query = this.knex(this.table).where('read_status', 0);

    if (isAdmin) {
      query = query.where(function () {
        this.where('is_public', 1).orWhere('is_public', 0);
      });
    } else {
      query = query.where(function () {
        this.where('is_public', 1).orWhere('uid', userId);
      });
    }

    // 扣掉当前用户自己已经点过已读的
    const readTable = this.readTable;
    query = query.whereNotIn('id', function () {
      this.select('message_id').from(readTable).where('uid', userId);
    });

    const result = await query.count('* as count').first();
    return result ? Number(result.count) : 0;
  }
}

module.exports = {
  MessageService,
};
