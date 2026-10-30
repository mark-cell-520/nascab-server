const path = require('path');
const { isPathInside: _isPathInside, isUnderAnyRoot: _isUnderAnyRoot } = require('../../../../utils/pathBoundaryUtil');

/**
 * 把"用户有权访问的根目录列表"翻译成 book_index 的查询条件。
 *
 * 这段逻辑原来在 4 个文件里各抄了一份（bookListService / bookCustomListService /
 * bookCollectionService / bookHistoryService），四份实现一模一样却互相不知道对方存在，
 * 改一处漏三处——photo 那边已经吃过这个亏（[[photo-path-query-util]] 就是为此抽出来的）。
 * 这里统一收敛到一处，四个调用方都改成 require 它。
 *
 * 语义（保持与原实现完全一致，避免行为回归）：
 * - paths 为空 → `1 = 0`，一行都不返回
 * - 每条路径 p：命中 `b.path = p`（p 本身就是个文件或目录行）或以 `p + sep` 开头
 * - 另外把"没有扩展名的路径"按 (dirname, basename) 精确匹配一次，
 *   覆盖 path 存的是父目录、filename 存的是自身名字的那种目录行
 */
function applyBookIndexPathPrefixFilter(query, paths) {
  const list = Array.isArray(paths) ? paths.map(p => String(p || '').trim()).filter(Boolean) : [];
  if (list.length === 0) {
    query.whereRaw('1 = 0');
    return;
  }

  const sep = path.sep;
  const folderExactPairs = [];
  for (const raw of list) {
    const p = raw.endsWith(sep) ? raw.slice(0, -1) : raw;
    if (!p) continue;
    if (path.extname(p)) continue;
    const parent = path.dirname(p);
    const name = path.basename(p);
    if (!parent || !name) continue;
    folderExactPairs.push({ parent, name });
  }

  query.where(builder => {
    for (const p of list) {
      const prefix = p.endsWith(sep) ? p : `${p}${sep}`;
      builder.orWhere(function () {
        this.where('b.path', p).orWhere('b.path', 'like', `${prefix}%`);
      });
    }
    for (const pair of folderExactPairs) {
      builder.orWhere(function () {
        this.where('b.is_file', 0).andWhere('b.path', pair.parent).andWhere('b.filename', pair.name);
      });
    }
  });
}

/**
 * 判断 child 是否真的在 parent 目录树下（含"恰好等于"）。
 *
 * 原来的判法到处是 `child.startsWith(parent)`：'/data/books2' 会被判成在 '/data/books'
 * 里面，于是"我的珍藏"能收录源目录之外的书、越权路径也能通过校验。
 * 已改到 utils/pathBoundaryUtil 统一实现，这里只做转发，保持既有调用方不变。
 */
const isPathInside = _isPathInside;

/**
 * 判断 filePath 是否落在 roots 里任意一个根目录之下（含"恰好等于某个根"）。
 * 同样已收敛到 utils/pathBoundaryUtil。
 */
const isUnderAnyRoot = _isUnderAnyRoot;

module.exports = {
  applyBookIndexPathPrefixFilter,
  isPathInside,
  isUnderAnyRoot,
};
