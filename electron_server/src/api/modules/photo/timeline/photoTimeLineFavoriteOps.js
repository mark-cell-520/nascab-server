// 收藏操作。photo_favorite 上有 (uid, file_hash) 唯一索引，所以批量插入/切换收藏
// 都要按"可能撞唯一约束"来写；同时 is_favorite 必须显式给出——原来 `if (is_favorite)`
// 让缺省参数静默走成"取消收藏"。
function paramError() {
  const err = new Error('common.PARAM_ERROR');
  err.statusCode = 400;
  return err;
}

function normalizeHashes(file_hashes) {
  if (!Array.isArray(file_hashes) || file_hashes.length === 0) throw paramError();
  const seen = new Set();
  const out = [];
  for (const raw of file_hashes) {
    if (typeof raw !== 'string') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw paramError();
      // file_hash 是字符串列，数字型入参会让 knex 绑成数字再被 SQLite 转型，
      // 与照片索引里的 hash 永远对不上——收藏"成功"了但列表里看不到。
      continue;
    }
    const h = raw.trim();
    if (!h) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  if (out.length === 0) throw paramError();
  return out;
}

function createFavoriteOps({ getKnex }) {
  async function batchFavorite(user, file_hashes, is_favorite) {
    const knex = getKnex();
    const uid = user.id;

    // 原来是 `if (!file_hashes || file_hashes.length === 0) return;`：空数组静默返回，
    // 接口照样回成功，调用方据此把本地状态改成"已收藏"/"已取消"，两边立刻不一致。
    const hashes = normalizeHashes(file_hashes);

    // is_favorite 原来是 `if (is_favorite)`：客户端漏传/传 null 时静默走取消收藏分支，
    // 用户点"收藏"结果收藏被清掉了。
    if (is_favorite !== true && is_favorite !== false && is_favorite !== 1 && is_favorite !== 0 && is_favorite !== 'true' && is_favorite !== 'false') {
      throw paramError();
    }
    const favorite = is_favorite === true || is_favorite === 1 || is_favorite === 'true';

    if (favorite) {
      const existing = await knex('photo_favorite').where({ uid }).whereIn('file_hash', hashes).select('file_hash');
      const existingHashes = new Set(existing.map(e => e.file_hash));
      // 去重：同一批里出现重复 hash 时，原来会拿到两条完全相同的 insert 行，
      // 直接撞 (uid, file_hash) 唯一索引 → SQLITE_CONSTRAINT → 整个批量收藏 500。
      // 客户端目前用 Set 去重，但服务端不能靠客户端自觉。
      const toInsert = hashes.filter(h => !existingHashes.has(h)).map(h => ({ uid, file_hash: h }));

      if (toInsert.length > 0) {
        // onConflict ignore：查重与插入之间仍有窗口，两个客户端同时收藏同一张
        // 照片时另一个会撞唯一索引。原来是裸 insert，撞了就是 500。
        await knex('photo_favorite').insert(toInsert).onConflict(['uid', 'file_hash']).ignore();
      }
      return;
    }

    await knex('photo_favorite').where({ uid }).whereIn('file_hash', hashes).del();
  }

  async function toggleFavorite(user, file_hash) {
    const knex = getKnex();
    const uid = user.id;

    const existing = await knex('photo_favorite').where({ uid: uid, file_hash }).first();

    if (existing) {
      await knex('photo_favorite').where({ id: existing.id }).del();
      return { is_favorite: false };
    }

    // 原来是裸 insert：先查后插之间有窗口，连点两下收藏按钮（或两个标签页同时操作）
    // 就会撞 (uid, file_hash) 唯一索引，返回 500 而照片其实已经收藏好了。
    await knex('photo_favorite')
      .insert({
        uid: uid,
        file_hash,
      })
      .onConflict(['uid', 'file_hash'])
      .ignore();
    return { is_favorite: true };
  }

  return {
    batchFavorite,
    toggleFavorite,
  };
}

module.exports = { createFavoriteOps };
