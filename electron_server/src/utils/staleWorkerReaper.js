'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 清理上一代 NasCab 主进程遗留的孤儿 Worker。
 *
 * 背景：
 *   supervisord 的 `stopasgroup/killasgroup` 只在 supervisord 自己停进程时才会把
 *   信号送到整个进程组。主进程如果是**未经 SIGTERM** 死掉的（未捕获异常、被
 *   SIGKILL、`initUtil.init()` 失败后 `process.exit(1)`），它 fork 出来的
 *   singleton worker 不会收到任何清理信号，被 init(1) 收养后继续常驻：
 *   每一代泄漏 4~5 个进程（photoWatch / videoWatch / musicWatch /
 *   backgroundTask / expressBroadcast），实测 5 代合计约 1.2 GB RSS。
 *
 *   这些残留进程各自持有 chokidar 文件监听和 SQLite 连接池，会造成
 *   - 媒体目录被重复监听，索引写入互相覆盖；
 *   - 广播 WebSocket 状态陈旧，前端推送错乱；
 *   - 数据库连接/锁竞争，最终表现为"功能基本都用不了"。
 *
 * 判定条件（三者全部满足才动手，宁可漏杀不要误杀）：
 *   1. /proc/<pid>/cmdline 指向本仓库的 src/workers/ 目录；
 *   2. PPID === 1，即已被 init 收养 = 父进程已消失；
 *   3. pid !== 当前进程。
 *
 * 刻意不处理的：
 *   - `mcp-server.js`（容器入口单独拉起，PPID 是 supervisord，且路径不在 workers/ 下）；
 *   - 主进程自身（cmdline 是相对路径 `src/main_nascab_os.js`，且杀主进程属于
 *     supervisord 的职责，这里不越权）；
 *   - 当前代的 worker（PPID 是当前主进程，永远不为 1）。
 */

const WORKERS_DIR = path.normalize(path.join(__dirname, '..', 'workers'));
const SELF_PID = process.pid;

function readProcFile(pid, name) {
  try {
    return fs.readFileSync(path.join('/proc', String(pid), name), 'utf8');
  } catch (_) {
    return null;
  }
}

function parseCmdline(pid) {
  const raw = readProcFile(pid, 'cmdline');
  if (!raw) return [];
  return raw
    .split('\0')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseStat(pid) {
  const raw = readProcFile(pid, 'stat');
  if (!raw) return null;
  // comm 字段可能含空格/括号，从最后一个 ')' 之后开始切
  const close = raw.lastIndexOf(')');
  if (close < 0) return null;
  const rest = raw.slice(close + 2).trim().split(/\s+/);
  // rest[0] = state, rest[1] = ppid, rest[2] = pgrp
  const ppid = Number(rest[1]);
  const pgid = Number(rest[2]);
  if (!Number.isFinite(ppid) || !Number.isFinite(pgid)) return null;
  return { ppid, pgid };
}

function listPids() {
  try {
    return fs
      .readdirSync('/proc')
      .filter(name => /^\d+$/.test(name))
      .map(Number)
      .filter(pid => pid > 0 && pid !== SELF_PID);
  } catch (_) {
    return [];
  }
}

function describe(pid, argv) {
  return argv.map(a => (a.length > 120 ? `${a.slice(0, 117)}...` : a)).join(' ');
}

/** 找出所有"属于本仓库 workers 目录、且已被 init 收养"的进程 */
function findStaleWorkers() {
  const stale = [];
  for (const pid of listPids()) {
    const argv = parseCmdline(pid);
    if (argv.length === 0) continue;
    const cmdline = argv.join(' ');
    // 只认本仓库的 worker 脚本；mcp-server 等兄弟进程天然不匹配
    if (!cmdline.includes(WORKERS_DIR)) continue;
    const stat = parseStat(pid);
    if (!stat) continue;
    if (stat.ppid !== 1) continue; // 有父进程就不是孤儿
    stale.push({ pid, pgid: stat.pgid, cmdline: describe(pid, argv) });
  }
  return stale;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (_) {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * 回收孤儿 worker。先 SIGTERM（让它们有机会刷盘/关库），超时后对幸存者 SIGKILL。
 * @param {object}  [options]
 * @param {object}  [options.logger]     带 info/warn 方法的日志器
 * @param {number}  [options.killWaitMs] SIGTERM 后等待多久再补 SIGKILL，默认 3000
 * @returns {Promise<{found:Array, killed:Array<number>, forced:Array<number>}>}
 */
async function reapStaleNascabWorkers(options = {}) {
  const logger = options.logger;
  const killWaitMs = Number.isFinite(options.killWaitMs) ? options.killWaitMs : 3000;
  const log = (level, msg, meta) => {
    try {
      if (logger && typeof logger[level] === 'function') logger[level](msg, meta);
    } catch (_) {}
  };

  const found = findStaleWorkers();
  if (found.length === 0) {
    log('info', '[startup] no stale nascab workers');
    return { found, killed: [], forced: [] };
  }

  const pids = found.map(item => item.pid);
  log('warn', '[startup] reaping stale nascab workers left by previous generations', {
    count: found.length,
    workers: found.map(item => ({ pid: item.pid, pgid: item.pgid, cmd: item.cmdline })),
  });

  const killed = [];
  for (const pid of pids) {
    if (sendSignal(pid, 'SIGTERM')) killed.push(pid);
  }

  await sleep(killWaitMs);

  const forced = [];
  for (const pid of pids) {
    if (isAlive(pid)) {
      if (sendSignal(pid, 'SIGKILL')) forced.push(pid);
    }
  }
  if (forced.length > 0) {
    log('warn', '[startup] force killed stale nascab workers that ignored SIGTERM', {
      pids: forced,
    });
  }

  return { found, killed, forced };
}

/**
 * 启动时回收一次，并安排一次延迟复查。
 * 延迟复查是为了兜住"上一代主进程刚死、它的 worker 还在收尾"这段窗口：
 * 第一遍可能还没被 init 收养，第二遍就都是孤儿了。
 * @param {object} [options] 同 reapStaleNascabWorkers
 * @param {number} [options.delayMs] 延迟复查间隔，默认 60000
 */
function scheduleStaleWorkerReaper(options = {}) {
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 60000;
  reapStaleNascabWorkers(options).catch(err => {
    try {
      const logger = options.logger;
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[startup] reap stale nascab workers failed', err && err.message);
      }
    } catch (_) {}
  });
  const timer = setTimeout(() => {
    reapStaleNascabWorkers(options).catch(() => {});
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
  reapStaleNascabWorkers,
  scheduleStaleWorkerReaper,
  findStaleWorkers,
  WORKERS_DIR,
};
