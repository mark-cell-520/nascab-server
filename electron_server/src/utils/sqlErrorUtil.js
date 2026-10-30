/**
 * SQLite / knex 错误分类工具。
 *
 * 项目里 better-sqlite3 走 knex，唯一索引冲突抛出的错误带上
 * err.code = 'SQLITE_CONSTRAINT_UNIQUE'（2067）或
 * 'SQLITE_CONSTRAINT_PRIMARYKEY'（1555），errno 同名，message 形如
 * "UNIQUE constraint failed: photo_album.uid, photo_album.name"。
 *
 * 只在 message 里匹配 'constraint' 是不够的：FOREIGN KEY / CHECK / NOT NULL
 * 失败的 message 同样带 "constraint failed"，把它们也当成"名字重复"返回，
 * 会把真正的外键/字段错误伪装成 409，问题被藏起来。
 */
function isUniqueViolation(err) {
  if (!err) return false;

  const code = String(err.code || '').toUpperCase();
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return true;
  }
  if (err.errno === 2067 || err.errno === 1555) return true;

  // 某些驱动/包装层会把 code 归一成 SQLITE_CONSTRAINT，此时退回 message 判断，
  // 但必须确认说的是 unique / primary key，而不是外键或 check。
  if (code === 'SQLITE_CONSTRAINT') {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('primary key')) return true;
    // 外层包装（knex 有时套一层 Error）会带上 cause / originalError
    if (err.cause) return isUniqueViolation(err.cause);
    if (err.originalError) return isUniqueViolation(err.originalError);
  }

  // 完全没有 code 时（例如 service 自己 throw 出来的包装错误），也看 cause
  if (!code && (err.cause || err.originalError)) {
    return isUniqueViolation(err.cause || err.originalError);
  }
  return false;
}

module.exports = { isUniqueViolation };
