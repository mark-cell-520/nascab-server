const dbUtil = require('../dbUtil');
const knexUtil = require('../knexUtil');
const Logger = require('../../utils/logger');

class tableVideoPlayPreference {
  constructor() {
    this.tableName = 'video_play_preference';
  }

  async createTable(connection = null) {
    let knex;
    if (connection && connection.knex) {
      knex = connection.knex;
    } else {
      knex = knexUtil.getInstance(dbUtil.DB_PATHS.VIDEO_DB);
    }
    const exists = await knex.schema.hasTable(this.tableName);
    if (!exists) {
      await knex.schema.createTable(this.tableName, table => {
        table.increments('id').primary();
        table.integer('uid').notNullable();
        table.text('file_hash').notNullable();
        table.integer('playback_position').defaultTo(0);
        table.string('subtitle_label').nullable();
        table.string('audio_label').nullable();
        // 清晰度偏好：档位 key（original/1080p/720p/...），见 utils/videoQualityUtil
        table.string('quality').nullable();
        // 字幕偏好：emb:<ffprobe 流号> 或 ext:<字幕文件名>，见 utils/mediaTrackLabelUtil
        table.string('subtitle_ref').nullable();
        // 音轨偏好：在音频流中的序号（对应 stream-mp4 的 audioMapIndex）
        table.integer('audio_index').nullable();
        // 倍速偏好：白名单内的字符串，如 '1.5'
        table.string('speed').nullable();
        table.timestamp('last_watched_at').defaultTo(knex.fn.now());
      });
      Logger.info(`✅ video_play_preference table created`);
    } else {
      await this._addMissingColumns(knex);
    }
  }

  /** 老库补列：SQLite 的 ADD COLUMN 是即插即用的，不用重建表 */
  async _addMissingColumns(knex) {
    let cols = [];
    try {
      const info = await knex.raw(`PRAGMA table_info(${this.tableName})`);
      cols = Array.isArray(info) ? info : (info && info.rows) || [];
    } catch (_) {
      return;
    }
    const have = new Set((cols || []).map(c => String(c && c.name)));
    // 列名 → DDL 片段。逐列 ALTER，缺哪列补哪列，重复执行是幂等的。
    const wanted = [
      ['quality', 'TEXT NULL'],
      ['subtitle_ref', 'TEXT NULL'],
      ['audio_index', 'INTEGER NULL'],
      ['speed', 'TEXT NULL'],
    ];
    for (const [name, ddl] of wanted) {
      if (have.has(name)) continue;
      try {
        await knex.raw(`ALTER TABLE ${this.tableName} ADD COLUMN ${name} ${ddl}`);
        Logger.info(`✅ video_play_preference 增加 ${name} 列`);
      } catch (e) {
        Logger.warn(`video_play_preference 增加 ${name} 列失败: ${e && e.message ? e.message : e}`);
      }
    }
  }

  async createIndexes(connection = null) {
    let knex;
    if (connection && connection.knex) {
      knex = connection.knex;
    } else {
      knex = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
    }
    const idxName = 'idx_preference_uid_hash_unique';
    const existing = await knex.raw("SELECT name FROM sqlite_master WHERE type='index' AND name=?", [idxName]);
    if (existing.length === 0) {
      await knex.schema.alterTable(this.tableName, table => {
        table.unique(['uid', 'file_hash'], idxName);
      });
      Logger.info(`✅ video_play_preference unique index created`);
    }
  }
}

module.exports = new tableVideoPlayPreference();
