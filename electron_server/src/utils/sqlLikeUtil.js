/**
 * SQLite LIKE 通配符转义。
 *
 * SQLite 的 LIKE 默认没有转义符，用户输入里的 `%` 和 `_` 会被当成通配符：
 * 搜 "100%" 会匹配所有内容，搜 "a_b" 会额外匹配 "axb"。
 * 各模块原先各自抄了一份 _escapeLikeValue（book / music / video / playlist），
 * 这里抽成公共实现，配套 ESCAPE '\' 使用。
 */
function escapeLikeValue(input) {
  return String(input === undefined || input === null ? '' : input)
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

/**
 * 生成 `%关键字%` 的 contains 匹配模式，配合 ESCAPE '\' 使用。
 */
function likeContainsPattern(input) {
  return `%${escapeLikeValue(input)}%`;
}

module.exports = { escapeLikeValue, likeContainsPattern };
