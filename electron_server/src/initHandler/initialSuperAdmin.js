const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const knexUtil = require('../db/knexUtil');
const dbUtil = require('../db/dbUtil');
const tableConfig = require('../db/table/tableConfig');
const tableUser = require('../db/table/tableUser');
const jwtUtil = require('../utils/jwtUtil');
const Logger = require('../utils/logger');
const runtimeFlags = require('../utils/runtimeFlags');
const config = require('../config/config');

let packageJson = {};
try {
  packageJson = require(path.join(__dirname, '../../package.json'));
} catch (_) {}

function generateCredential(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function toClientPasswordObfuscated(value) {
  return `b64:${Buffer.from(String(value), 'utf8').toString('base64')}`;
}

/** 超级管理员用户名的合法格式（与 authValidation.validateCreateSuperAdmin 保持一致） */
const ADMIN_USERNAME_RE = /^[a-zA-Z0-9_]+$/;

/**
 * 读取部署者通过环境变量指定的首个超级管理员
 * NASCAB_ADMIN_USER / NASCAB_ADMIN_PASSWORD
 * 服务器/Docker 部署时用它省去「翻日志找随机账号」的步骤；未设置则沿用随机生成。
 */
function getDeploymentAdminCredentials() {
  const username = String(process.env.NASCAB_ADMIN_USER || '').trim();
  const password = String(process.env.NASCAB_ADMIN_PASSWORD || '');
  if (!username && !password) return null;

  if (!username || !password) {
    // 只设了一个：明确告警，避免部署者以为生效了
    Logger.warn('NASCAB_ADMIN_USER 与 NASCAB_ADMIN_PASSWORD 需要同时设置，已忽略本次指定，继续使用随机账号。');
    return null;
  }
  if (username.length < 3 || username.length > 20 || !ADMIN_USERNAME_RE.test(username)) {
    Logger.warn(`NASCAB_ADMIN_USER 不合法（需 3-20 位字母、数字或下划线）：${username}，已忽略，继续使用随机账号。`);
    return null;
  }
  if (password.length < 6) {
    Logger.warn('NASCAB_ADMIN_PASSWORD 长度不足 6 位，已忽略，继续使用随机账号。');
    return null;
  }
  return { username, password };
}

module.exports = {
  async ensureInitialSuperAdmin() {
    const knexMain = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
    const authService = require('../api/modules/auth/authService');
    const has = await authService.hasSuperAdmin({ knexMain });
    if (has) return { created: false };

    // 优先使用部署者显式指定的账号；失败（如重名）时回落到随机生成
    const specified = getDeploymentAdminCredentials();
    if (specified) {
      try {
        await authService.createSuperAdmin(
          { knexMain },
          {
            username: specified.username,
            password: toClientPasswordObfuscated(specified.password),
            question: 'init',
            answer: 'init',
            language: 'zh-CN',
          }
        );
        await tableConfig.setConfigByKey(tableConfig.KEY_IS_INITIAL_ADMIN, '1', 0);
        Logger.info(`已按 NASCAB_ADMIN_USER 创建超级管理员: ${specified.username}`);
        return { created: true, username: specified.username, password: specified.password, fromEnv: true };
      } catch (e) {
        if (e && e.message === 'auth.USERNAME_EXISTS') {
          Logger.warn(`NASCAB_ADMIN_USER 指定的用户名已存在: ${specified.username}，改用随机账号。`);
        } else {
          Logger.error('按环境变量创建超级管理员失败，回落到随机账号', e);
        }
      }
    }

    const question = 'init';
    for (let i = 0; i < 20; i++) {
      const username = generateCredential(6);
      const passwordPlain = generateCredential(6);
      const answer = generateCredential(16);
      try {
        await authService.createSuperAdmin(
          { knexMain },
          {
            username,
            password: toClientPasswordObfuscated(passwordPlain),
            question,
            answer,
            language: 'zh-CN',
          }
        );
        await tableConfig.setConfigByKey(tableConfig.KEY_IS_INITIAL_ADMIN, '1', 0);
        return { created: true, username, password: passwordPlain };
      } catch (e) {
        if (e && e.message === 'auth.USERNAME_EXISTS') continue;
        throw e;
      }
    }
    throw new Error('auth.SUPER_ADMIN_CREATE_FAILED');
  },

  async getInitialSuperAdminInfo() {
    try {
      const enabled = await tableConfig.getConfigByKey(tableConfig.KEY_IS_INITIAL_ADMIN, 0);
      if (enabled !== '1') return { isInitialAdmin: false, username: null, password: null };

      const knexMain = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
      const row = await knexMain('user').where({ type: tableUser.TYPE_SUPER_ADMIN }).first();
      if (!row) return { isInitialAdmin: false, username: null, password: null };

      const password = jwtUtil.isEncryptedPassword(row.password) ? jwtUtil.decryptPassword(row.password) : jwtUtil.decodeClientPassword(row.password);
      if (!password) return { isInitialAdmin: true, username: row.username || null, password: null };
      return { isInitialAdmin: true, username: row.username || null, password };
    } catch {
      return { isInitialAdmin: false, username: null, password: null };
    }
  },

  /**
   * Linux 无界面（无 Electron app）时，将 super_admin 解密后的用户名与密码明文写入
   * getUserDataPath()/nascabos_admin_account。
   * 默认跳过「仍为初始随机管理员」(is_initial_admin=1)，避免落盘；Docker 镜像需可读卷取密，故 isDocker 时仍写入。
   */
  async writeLinuxHeadlessAdminAccountFileIfNeeded() {
    try {
      if (process.platform !== 'linux') return;
      let electronApp;
      try {
        electronApp = require('electron').app;
      } catch (e) {}
      if (electronApp) return;

      const isInitialFlag = await tableConfig.getConfigByKey(tableConfig.KEY_IS_INITIAL_ADMIN, 0);
      if (isInitialFlag === '1' && !runtimeFlags.isDocker()) return;

      const knexMain = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
      const row = await knexMain('user').where({ type: tableUser.TYPE_SUPER_ADMIN }).first();
      if (!row || !row.username) return;

      const password = jwtUtil.isEncryptedPassword(row.password)
        ? jwtUtil.decryptPassword(row.password)
        : jwtUtil.decodeClientPassword(row.password);
      if (!password) return;

      const userDataDir = config.getUserDataPath();
      try {
        fs.mkdirSync(userDataDir, { recursive: true });
      } catch (e) {}
      const filePath = path.join(userDataDir, 'nascabos_admin_account');
      const content = `username:${row.username} password:${password}`;
      fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
      // 忽略：无界面启动不应因写备忘文件失败而中断
    }
  },
};
