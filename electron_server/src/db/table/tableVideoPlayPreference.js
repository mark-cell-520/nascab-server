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
    const has = cols.some(c => String(c && c.name) === 'quality');
    if (has) return;
    try {
      await knex.raw(`ALTER TABLE ${this.tableName} ADD COLUMN quality TEXT NULL`);
      Logger.info(`✅ video_play_preference 增加 quality 列`);
    } catch (e) {
      Logger.warn(`video_play_preference 增加 quality 列失败: ${e && e.message ? e.message : e}`);
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
