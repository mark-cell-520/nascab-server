const path = require('path');
const config = require('../../../../config/config');

function parseCount(row) {
  if (!row) return 0;
  const v = row.count ?? row['count(*)'] ?? row['COUNT(*)'] ?? row.total ?? row['total'];
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseFileHashArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(v => String(v)).filter(Boolean);
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(v => String(v)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function rawShowExt(item) {
  if (!item || !item.ext) return '';
  const ext = String(item.ext || '');
  if (config.rawImgTypeList && config.rawImgTypeList.includes(ext)) {
    return ext.toUpperCase().replace('.', '');
  }
  const rawFilename = item.raw_filename ? String(item.raw_filename) : '';
  if (rawFilename && rawFilename.includes('.')) {
    return `${ext.toUpperCase().replace('.', '')} +${path.extname(rawFilename).toUpperCase().replace('.', '')}`;
  }
  return '';
}

class SimilarService {
  constructor(knex) {
    this.knex = knex;
  }

  /**
   * 自愈：删掉已经凑不齐 2 张有效照片的分组。
   *
   * photo_similar 的 similar_file_hash 存的是 JSON 数组，必须解析出来再回查
   * photo_index 才知道还剩几张有效照片（照片被删、进回收站、type 变了都会让分组失效），
   * 所以没法用一条 SQL 表达。这张表是「相似组」表，行数在几十到几千之间，全量扫一遍
   * 的开销可以接受，而且换来 listSimilarGroups 的 total 是准的。
   *
   * 之前 total 直接 count(*) photo_similar，这些僵尸行也被算进去：前端显示「共 N 组」
   * 却只列出几条，往后翻还是空页。先清再数，total 就和 items 对上了。
   */
  async pruneInvalidGroups() {
    const rows = await this.knex('photo_similar')
      .select('id', 'similar_file_hash')
      .catch(() => []);
    if (!rows || rows.length === 0) return 0;

    const deadIds = [];
    const candidates = [];
    for (const r of rows) {
      const id = Number(r && r.id) || 0;
      if (!id) continue;
      const hashes = parseFileHashArray(r && r.similar_file_hash);
      if (hashes.length < 2) {
        deadIds.push(id);
        continue;
      }
      candidates.push({ id, hashes });
    }

    if (candidates.length > 0) {
      const allHashes = [...new Set(candidates.flatMap(c => c.hashes))];
      const photoRows = await this.knex('photo_index')
        .whereIn('file_hash', allHashes)
        .andWhere({ is_file: 1, in_trash: 0, type: 1 })
        .select('file_hash')
        .catch(() => []);
      // 用集合而不是行数：同一个 hash 在数组里重复出现只代表一张照片，
      // 按行数会把「一张照片」当成「两张」留在列表里，UI 上显示成一对相同照片。
      const aliveHashes = new Set((photoRows || []).map(p => String(p && p.file_hash ? p.file_hash : '')));
      for (const c of candidates) {
        // 先去重再数：数组里同一个 hash 出现两次也只算一张。原来直接 c.hashes.filter(...).length，
        // [H0,H0] 会被数成 2 张而逃过自愈，可下面的列表循环用 whereIn 回查只会得到 1 行，
        // 于是同一行在 prune 阶段判「有效」、在列表阶段判「无效」删掉 —— total 比 items 多 1。
        const alive = [...new Set(c.hashes)].filter(h => aliveHashes.has(String(h))).length;
        if (alive < 2) deadIds.push(c.id);
      }
    }

    if (deadIds.length === 0) return 0;
    let deleted = 0;
    for (let i = 0; i < deadIds.length; i += 500) {
      const chunk = deadIds.slice(i, i + 500);
      deleted += Number(await this.knex('photo_similar').whereIn('id', chunk).del().catch(() => 0)) || 0;
    }
    return deleted;
  }

  async listSimilarGroups(params = {}) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(params.pageSize ?? params.page_size) || 20));
    const offset = (page - 1) * pageSize;

    // 先自愈再统计，否则 total 会把失效分组算进去（见 pruneInvalidGroups 注释）
    await this.pruneInvalidGroups();

    const totalRow = await this.knex('photo_similar')
      .count({ count: '*' })
      .first()
      .catch(() => null);
    const total = parseCount(totalRow);

    const rows = await this.knex('photo_similar')
      .select('id', 'index_id', 'similar_file_hash', 'create_time')
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .catch(() => []);

    const items = [];
    for (const r of rows) {
      const id = Number(r && r.id) || 0;
      if (!id) continue;

      const fileHashes = parseFileHashArray(r && r.similar_file_hash);
      if (fileHashes.length === 0) {
        await this.knex('photo_similar')
          .where({ id })
          .del()
          .catch(() => {});
        continue;
      }

      const photoRows = await this.knex('photo_index')
        .whereIn('file_hash', fileHashes)
        .andWhere({ is_file: 1, in_trash: 0, type: 1 })
        .select('id', 'path', 'filename', 'size', 'is_lvp', 'type', 'width', 'height', 'original_date', 'original_time', 'duration', 'file_hash', 'live_filename', 'raw_filename', 'ext')
        .orderBy('original_time', 'desc')
        .orderBy('id', 'desc')
        .catch(() => []);

      if (!photoRows || photoRows.length < 2) {
        await this.knex('photo_similar')
          .where({ id })
          .del()
          .catch(() => {});
        continue;
      }

      const photos = photoRows.map(p => ({
        ...p,
        fullpath: path.join(p.path, p.filename),
        is_favorite: 0,
        raw_show_ext: rawShowExt(p),
      }));

      items.push({
        id,
        index_id: Number(r && r.index_id) || 0,
        file_hashes: fileHashes,
        photos,
        create_time: r && r.create_time ? r.create_time : null,
      });
    }

    return {
      items,
      pagination: {
        total,
        page,
        pageSize,
      },
    };
  }

  async batchDeleteSimilarRecords(ids = []) {
    const cleanIds = (Array.isArray(ids) ? ids : []).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
    if (cleanIds.length === 0) return 0;
    const deleted = await this.knex('photo_similar')
      .whereIn('id', cleanIds)
      .del()
      .catch(() => 0);
    return Number(deleted) || 0;
  }

  async resetSimilarScan() {
    await this.knex.transaction(async trx => {
      await trx('photo_similar')
        .del()
        .catch(() => {});
      await trx('photo_index')
        .where({ type: 1, is_file: 1, in_trash: 0 })
        .whereNotNull('phash')
        .andWhere('phash', '!=', '')
        .update({ gen_phash: 1 })
        .catch(() => {});

      await trx('photo_index')
        .where({ type: 1, is_file: 1, in_trash: 0 })
        .where(builder => builder.whereNull('phash').orWhere('phash', ''))
        .update({ gen_phash: 0 })
        .catch(() => {});
    });
    return true;
  }
}

module.exports = SimilarService;
