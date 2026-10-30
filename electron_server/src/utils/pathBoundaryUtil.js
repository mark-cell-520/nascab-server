const path = require('path');

/**
 * 跨模块的"路径包含关系"判定。
 *
 * 这套逻辑原来在 6 个文件里各写一遍，而且写错的方式一模一样：
 * 全部是裸 `child.startsWith(parent)`，于是 '/data/music2' 会被判成在 '/data/music'
 * 里面。后果是 media/book/photo 三边的 getValidPaths 会把用户够不着的兄弟目录
 * 当合法根目录下发，收藏夹/合集路径校验也能被绕过（越权读）。
 * 这里统一收敛到一处，所有调用方改为 require 它。
 */

function _trimStr(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

/**
 * 判断 child 是否真的在 parent 目录树下（含"恰好等于"）。
 * 必须补分隔符边界，否则 '/data/books2' 会算进 '/data/books'。
 */
function isPathInside(parent, child) {
  const p = _trimStr(parent);
  const c = _trimStr(child);
  if (!p || !c) return false;
  if (p === c) return true;
  const sep = path.sep;
  const pWithSep = p.endsWith(sep) ? p : `${p}${sep}`;
  return c.startsWith(pWithSep);
}

/**
 * 判断 filePath 是否落在 roots 里任意一个根目录之下（含"恰好等于某个根"）。
 */
function isUnderAnyRoot(filePath, roots) {
  const resolved = filePath ? path.resolve(String(filePath)) : '';
  if (!resolved) return false;
  const list = Array.isArray(roots) ? roots.map(p => path.resolve(String(p || ''))).filter(Boolean) : [];
  const sep = path.sep;
  for (const root of list) {
    if (resolved === root) return true;
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (resolved.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * 求"用户可见根目录"与"请求里带的路径列表"的交集。
 *
 * 原来两个分支都是裸 startsWith：请求里塞一个 '/data/music2'（合法根是 '/data/music'）
 * 也能命中，等于把权限收窄的请求反转成越权。改成 isPathInside 后，
 * 只有真的存在父子关系时才保留较深的那一条。
 */
function intersectPaths(validPaths, limitPaths) {
  const base = (Array.isArray(validPaths) ? validPaths : []).map(_trimStr).filter(Boolean);
  const limit = (Array.isArray(limitPaths) ? limitPaths : []).map(_trimStr).filter(Boolean);
  const intersected = [];
  for (const vp of base) {
    for (const sp of limit) {
      if (isPathInside(vp, sp)) {
        intersected.push(sp);
      } else if (isPathInside(sp, vp)) {
        intersected.push(vp);
      }
    }
  }
  return [...new Set(intersected)];
}

module.exports = {
  isPathInside,
  isUnderAnyRoot,
  intersectPaths,
};
