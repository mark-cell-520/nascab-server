const knexUtil = require('../knexUtil');
const dbUtil = require('../dbUtil');
const Logger = require('../../utils/logger');

class tablePlayList2Index {
  constructor() {
    this.tableName = 'play_list2index';
  }

  async createTable(connection = null) {
    const knex = connection && connection.knex ? connection.knex : knexUtil.getInstance(dbUtil.DB_PATHS.MUSIC_DB);
    const tableExists = await knex.schema.hasTable(this.tableName);
    if (!tableExists) {
      await knex.schema.createTable(this.tableName, table => {
        table.integer('list_id').notNullable();
        table.integer('index_id').notNullable();
        // 播放顺序。没有这一列时「加入顺序」只能从 create_time 猜，
        // 而同一批插入的曲目 create_time 相同，顺序根本不稳定。
        table.integer('position').notNullable().defaultTo(0);
        table.timestamp('create_time').defaultTo(knex.fn.now());
      });
      Logger.info(`✅ Table ${this.tableName} created`);
    } else {
      await this._addMissingColumns(knex);
    }
  }

  /** 老库补列，并按加入顺序回填 position */
  async _addMissingColumns(knex) {
    let cols = [];
    try {
      const info = await knex.raw(`PRAGMA table_info(${this.tableName})`);
      cols = Array.isArray(info) ? info : (info && info.rows) || [];
    } catch (_) {
      return;
    }
    if (cols.some(c => String(c && c.name) === 'position')) return;
    try {
      await knex.raw(`ALTER TABLE ${this.tableName} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
      // 回填：按 list_id 分组，组内按 create_time + index_id 排 1..n
      await knex.raw(`
        UPDATE ${this.tableName} SET position = (
          SELECT COUNT(*) FROM ${this.tableName} AS t
          WHERE t.list_id = ${this.tableName}.list_id
            AND (t.create_time < ${this.tableName}.create_time
                 OR (t.create_time = ${this.tableName}.create_time AND t.index_id <= ${this.tableName}.index_id))
        )
      `);
      Logger.info(`✅ ${this.tableName} 增加 position 列并回填`);
    } catch (e) {
      Logger.warn(`${this.tableName} 增加 position 列失败: ${e && e.message ? e.message : e}`);
    }
  }

  async createIndexes(connection = null) {
    const knex = connection && connection.knex ? connection.knex : knexUtil.getInstance(dbUtil.DB_PATHS.MUSIC_DB);
    const existingIndexes = await knex.raw(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${this.tableName}'`);
    const indexNames = Array.isArray(existingIndexes) ? existingIndexes.map(row => row.name) : (existingIndexes?.rows || []).map(row => row.name);

    const targetIndexes = [
      { columns: ['list_id', 'index_id'], name: 'uidx_play_list2index_list_id_index_id', unique: true },
      { columns: ['list_id'], name: 'idx_play_list2index_list_id', unique: false },
      { columns: ['index_id'], name: 'idx_play_list2index_index_id', unique: false },
      { columns: ['create_time'], name: 'idx_play_list2index_create_time', unique: false },
      // 播放列表按 position 排序是热路径
      { columns: ['list_id', 'position'], name: 'idx_play_list2index_list_id_position', unique: false },
    ];

    for (const index of targetIndexes) {
      if (!indexNames.includes(index.name)) {
        await knex.schema.alterTable(this.tableName, table => {
          if (index.unique) {
            table.unique(index.columns, index.name);
          } else {
            table.index(index.columns, index.name);
          }
        });
        Logger.info(`✅ Created index ${index.name} on table ${this.tableName}`);
      }
    }
  }
}

module.exports = new tablePlayList2Index();
