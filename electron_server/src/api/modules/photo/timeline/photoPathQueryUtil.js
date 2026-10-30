const path = require('path');
const { intersectPaths: _intersectPaths } = require('../../../../utils/pathBoundaryUtil');

function parsePathListText(text) {
  if (!text) return [];
  try {
    const arr = JSON.parse(String(text));
    return Array.isArray(arr) ? arr.map(v => String(v || '').trim()).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

// 原来这里两个分支都是裸 startsWith，'/data/music2' 会命中 '/data/music'，
// 请求里塞个兄弟目录就能越权；已改到 utils/pathBoundaryUtil 统一实现。
const intersectPaths = _intersectPaths;

function applyPathPrefixFilter(query, pathColumn, paths) {
  const list = Array.isArray(paths) ? paths.map(p => String(p || '').trim()).filter(Boolean) : [];
  if (list.length === 0) {
    query.whereRaw('1 = 0');
    return;
  }
  query.where(builder => {
    for (const p of list) {
      builder.orWhere(function () {
        this.where(pathColumn, p).orWhere(pathColumn, 'like', `${p}${path.sep}%`);
      });
    }
  });
}

module.exports = {
  parsePathListText,
  intersectPaths,
  applyPathPrefixFilter,
};
