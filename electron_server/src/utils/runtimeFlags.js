'use strict';
/**
 * 运行时环境标志
 *
 * 原来的「是否 Docker 环境」只能通过 package.json 的 isDocker 字段声明，
 * 容器化/服务化部署时必须改包描述文件，既麻烦又会在升级时被覆盖。
 * 这里统一收敛成一个开关：环境变量 NASCAB_IS_DOCKER 优先，未设置时回落到 package.json。
 */

const path = require('path');

let packageJson = {};
try {
  packageJson = require(path.join(__dirname, '../../package.json'));
} catch (_) {
  // 忽略
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(v)) return false;
  return fallback;
}

/**
 * 是否运行在 Docker 容器中
 * 为 true 时：数据目录用 /nascabos_data，ffmpeg/ffprobe 用系统命令而非内置二进制
 */
function isDocker() {
  const fromEnv = process.env.NASCAB_IS_DOCKER;
  if (fromEnv !== undefined && fromEnv !== '') {
    return parseBool(fromEnv, false);
  }
  return !!packageJson.isDocker;
}

module.exports = { isDocker };
