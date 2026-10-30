const dbUtil = require('../dbUtil');
const knexUtil = require('../knexUtil');
const Logger = require('../../utils/logger');

// 消息"已读"原来只有 message.read_status 一个全局标志：任何一个用户点一下已读，
// 所有人的未读角标一起清零，别人再也看不到这条消息是新的。
// 已读状态改成按 (uid, message_id) 单独记账，message.read_status 保留为
// "全局已阅"标记（读取时仍然尊重，但不再由 markAsRead 覆写）。
class tableMessageRead {
  constructor() {
    this.tableName = 'message_read';
  }

  async createTable(connection = null) {
    let knex;
    if (connection && connection.knex) {
      knex = connection.knex;
    } else {
      knex = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
    }
    const exists = await knex.schema.hasTable(this.tableName);
    if (!exists) {
      await knex.schema.createTable(this.tableName, table => {
        table.increments('id').primary();
        table.integer('uid').notNullable().defaultTo(0);
        table.integer('message_id').notNullable().defaultTo(0);
        table.timestamp('read_time').defaultTo(knex.fn.now());
      });
      Logger.info(`✅ message_read table created`);
    }
  }

  async createIndexes(connection = null) {
    let knex;
    if (connection && connection.knex) {
      knex = connection.knex;
    } else {
      knex = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
    }
    const idxUnique = 'idx_message_read_uid_msg_unique';
    const existing = await knex.raw("SELECT name FROM sqlite_master WHERE type='index' AND name=?", [idxUnique]);
    if (existing.length === 0 || (existing.rows && existing.rows.length === 0)) {
      await knex.schema.alterTable(this.tableName, table => {
        table.unique(['uid', 'message_id'], idxUnique);
      });
      Logger.info(`✅ message_read unique index (uid, message_id) created`);
    }
  }
}

module.exports = new tableMessageRead();
