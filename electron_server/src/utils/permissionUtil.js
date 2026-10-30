const tableUser = require('../db/table/tableUser');
const tableUserPermission = require('../db/table/tableUserPermission');
const path = require('path');
const userShareFolderUtil = require('./userShareFolderUtil');
const { normalizePathItem } = require('./appAccessScopeUtil');

function parseAnyOrArray(text) {
  if (text === undefined || text === null) return 'ANY';
  if (text === 'ANY') return 'ANY';
  if (Array.isArray(text)) {
    const list = text.map(v => String(v || '').trim()).filter(Boolean);
    return list.length > 0 ? list : 'ANY';
  }
  const raw = String(text || '').trim();
  if (!raw) return 'ANY';
  if (raw === 'ANY') return 'ANY';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const list = parsed.map(v => String(v || '').trim()).filter(Boolean);
      return list.length > 0 ? list : 'ANY';
    }
  } catch (_) {}
  return [raw];
}

/**
 * scoped 令牌专用：把库里的 allow_api / allow_path 解释成权限清单。
 *
 * parseAnyOrArray 对"没给值"一律返回 'ANY'（全放开），那是给 access 令牌用的
 * 兜底语义——普通令牌本来就不该被收窄。但 scoped 令牌反过来：它的全部意义就是
 * 比创建者本身的权限更窄。用户调 /api/user/token/scoped 时省略 allow_api
 * （或传 []、''、'[]'），normalizeAnyOrArray 会存成 'ANY'，于是一个"受限令牌"
 * 能调所有接口，创建者是 admin 时连管理接口一起放开，allow_path 同理能读所有路径。
 * 所以这里只有库里的值显式等于字符串 'ANY' 时才按全放开处理，其余空值一律收敛成
 * 空数组（什么都不允许）。
 */
function parseScopedAllow(text) {
  const explicitAny = typeof text === 'string' && text.trim() === 'ANY';
  const list = parseAnyOrArray(text);
  if (list === 'ANY') return explicitAny ? 'ANY' : [];
  return list;
}

function matchApi(allowedList, reqApi) {
  if (allowedList === 'ANY') return true;
  // 不是数组又没显式写 'ANY'，一律按不允许处理。原来这里是 return true，
  // 等于任何非预期形态（null / 对象 / 数字）都直接放行。
  if (!Array.isArray(allowedList)) return false;
  const api = String(reqApi || '').trim();
  if (!api) return false;
  for (const a of allowedList) {
    const rule = String(a || '').trim();
    if (!rule) continue;
    if (api === rule) return true;
    if (api.startsWith(rule.endsWith('/') ? rule : `${rule}/`)) return true;
  }
  return false;
}

/**
 * 统一权限校验工具函数
 * @param {object} knex - Knex实例（主库）
 * @param {{userId:number, type:string}} user - 当前登录用户信息
 * @param {string|string[]} action - 操作动作（view/download/update/delete/modify）
 * @param {string} resPath - 资源路径（绝对/规范化路径）
 * @param {string} resType - 资源类型（默认：file）
 * @returns {Promise<boolean>} 是否有权限
 */
async function hasPermission(knex, user, action, resPath, resType = tableUserPermission.RES_TYPES.FILE) {
  if (!knex) return false;
  if (!user) return false;

  const userType = typeof user.type === 'string' ? user.type.toLowerCase() : '';
  if (userType === tableUser.TYPE_SUPER_ADMIN || userType === tableUser.TYPE_ADMIN) return true;

  const normalizedPath = typeof resPath === 'string' && resPath.trim() ? normalizePathItem(resPath.trim()) : '';
  if (!normalizedPath) return false;

  const allowPathRaw = user.allow_path ?? user.allowPath ?? user.token_allow_path;
  const allowPath = parseAnyOrArray(allowPathRaw);
  if (allowPath !== 'ANY' && Array.isArray(allowPath)) {
    let ok = false;
    for (const p of allowPath) {
      const rulePath = typeof p === 'string' && p.trim() ? normalizePathItem(p.trim()) : '';
      if (!rulePath) continue;
      if (normalizedPath === rulePath || normalizedPath.startsWith(rulePath.endsWith(path.sep) ? rulePath : rulePath + path.sep)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  const uidRaw = user.id ?? user.userId ?? user.uid ?? user.user_id;
  const uid = Number(uidRaw);
  if (!Number.isFinite(uid) || uid <= 0) return false;

  const normalizedResType = typeof resType === 'string' && resType.trim() ? resType.trim() : tableUserPermission.RES_TYPES.FILE;

  const actions = Array.isArray(action) ? action.map(a => String(a || '').trim()).filter(Boolean) : [String(action || '').trim()].filter(Boolean);
  if (actions.length === 0) return false;

  const lowerActions = actions.map(a => a.toLowerCase());
  const isReadOnlyActions = lowerActions.every(a => a === 'view' || a === 'download');
  if (isReadOnlyActions) {
    const isUserShare = await userShareFolderUtil.isUserSharePath(normalizedPath);
    if (isUserShare) {
      if (lowerActions.includes('view')) return true;
      if (lowerActions.includes('download')) {
        const allowed = await userShareFolderUtil.isUserShareDownloadAllowed(normalizedPath);
        if (allowed) return true;
        return false;
      }
      return false;
    }
  }

  const query = knex('user_permission').where({
    uid,
    res_type: normalizedResType,
  });

  if (actions.length > 1) {
    query.whereIn('action', actions);
  } else {
    query.where({ action: actions[0] });
  }

  const rows = await query.select('res_path');

  for (const row of rows) {
    const rowPath = row && typeof row.res_path === 'string' && row.res_path.trim() ? normalizePathItem(row.res_path.trim()) : '';
    if (!rowPath) continue;

    if (normalizedPath === rowPath || normalizedPath.startsWith(rowPath.endsWith(path.sep) ? rowPath : rowPath + path.sep)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  hasPermission,
  parseAnyOrArray,
  parseScopedAllow,
  matchApi,
};
