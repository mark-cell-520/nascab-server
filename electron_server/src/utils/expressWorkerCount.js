'use strict';
/**
 * express API worker 进程数决策
 *
 * 上游按 CPU 核心数铺开 worker（最少 2 个）。对桌面机合理，对服务器是笔浪费：
 * NasCab 的 API 负载以文件流（内核态搬运，不占 JS 线程）、SQLite 查询和
 * 缩略图转发放为主，并不是 CPU 密集——多开 worker 买到的东西很有限，
 * 代价却是每个进程一份完整的 express + 路由 + 中间件常驻内存
 * （Windows 实测单个约 98MB RSS，两个就占掉整机空闲内存的 1/4 以上）。
 *
 * 多 worker 唯一实质收益是「一个崩了另一个还在听端口」，而这已经由
 * worker.autoRestart 的指数退避重启覆盖（1 秒内拉起）。
 *
 * 因此默认（自动）只要 1 个；确有必要并发时用 NASCAB_EXPRESS_COUNT 显式指定。
 * 决策逻辑集中在这里，启动路径（initUtil）与设置接口（apiSettingController）
 * 共用一份，避免两边算出不同的数。
 */

const os = require('os');

/** 自动模式下的 worker 数上限：只保留「端口冗余」这一项收益，不按核心数铺开 */
const AUTO_MAX_WORKERS = 1;
/** 显式配置时的进程数上限，防止把 64 核机铺成 64 个进程 */
const MAX_WORKERS = 8;

/** 当前机器的规格画像 */
function machineProfile() {
  let cores = 0;
  try {
    cores = (os.cpus() || []).length;
  } catch (_) {
    cores = 0;
  }
  let totalBytes = 0;
  try {
    totalBytes = os.totalmem();
  } catch (_) {
    totalBytes = 0;
  }
  return {
    cores: Math.max(1, cores || 1),
    memGB: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes / 1024 ** 3 : 0,
  };
}

/**
 * 决策 express worker 数量
 * @param {object} [options]
 * @param {number} [options.configured] 显式配置值；0 / 负数 / 非数字表示自动
 * @param {number} [options.cores] CPU 逻辑核心数，默认取本机
 * @param {number} [options.memGB] 物理内存（GB），默认取本机
 * @returns {{count:number, auto:boolean, reason:string, cores:number, memGB:number}}
 */
function decide(options = {}) {
  const profile = machineProfile();
  const cores = Number.isFinite(options.cores) && options.cores > 0 ? Math.floor(options.cores) : profile.cores;
  const memGB = Number.isFinite(options.memGB) && options.memGB > 0 ? options.memGB : profile.memGB;
  const memText = memGB > 0 ? `${memGB.toFixed(1)} GB` : '未知';

  const raw = parseInt(options.configured, 10);
  if (Number.isFinite(raw) && raw > 0) {
    const count = Math.max(1, Math.min(MAX_WORKERS, raw, cores));
    return {
      count,
      auto: false,
      reason: `显式配置 ${raw} 个（受核心数 ${cores} 与上限 ${MAX_WORKERS} 约束后为 ${count}）`,
      cores,
      memGB,
    };
  }

  const count = Math.max(1, Math.min(cores, AUTO_MAX_WORKERS));
  return {
    count,
    auto: true,
    reason:
      `自动决策：${cores} 核 / ${memText} 内存。API 负载以文件流与 SQLite IO 为主、非 CPU 密集，` +
      `多开 worker 只增加常驻内存，故默认 ${count} 个（需要并发可设 NASCAB_EXPRESS_COUNT）`,
    cores,
    memGB,
  };
}

module.exports = {
  decide,
  machineProfile,
  AUTO_MAX_WORKERS,
  MAX_WORKERS,
};
