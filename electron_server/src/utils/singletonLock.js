'use strict';
/**
 * 无界面（服务 / Docker / systemd）模式下的单例锁
 *
 * 背景：Electron 桌面模式有 app.requestSingleInstanceLock() 保护，但纯 Node 服务模式
 * 没有任何单例保护。同一数据目录重复启动会让两个进程抢同一批 SQLite 库，
 * 表现为 database is locked、索引重复、缓存互相覆盖等难以定位的故障。
 *
 * 实现：以排他方式（O_CREAT|O_EXCL）创建锁文件，天然无 TOCTOU 竞态；
 * 进程退出或收到终止信号时删除锁文件。锁文件内记录 PID，冲突时给出可读的诊断信息。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_FILE_NAME = 'nascabos.lock';

/** 判断 PID 是否存活（进程不存在返回 false；存在但无权限返回 true） */
function isProcessAlive(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return false;
  const p = Number(pid);
  if (p === process.pid) return true;
  try {
    process.kill(p, 0);
    return true;
  } catch (err) {
    return !!(err && err.code === 'EPERM');
  }
}

/**
 * 尝试获取单例锁
 * @param {string} userDataPath 用户数据目录
 * @returns {{lockPath: string|null, release: Function}} release 用于释放锁
 * @throws 已有存活实例时抛出 code=EINSTANCEALREADYRUNNING 的错误
 */
function acquire(userDataPath) {
  if (!userDataPath) {
    return { lockPath: null, release: () => {} };
  }

  let lockPath;
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    lockPath = path.join(userDataPath, LOCK_FILE_NAME);
  } catch (err) {
    // 数据目录都建不出来，不拿单例检查阻塞启动
    console.warn(`[singletonLock] 无法访问数据目录 ${userDataPath}: ${err && err.message}`);
    return { lockPath: null, release: () => {} };
  }

  try {
    // 'wx' = 写入且要求文件不存在（排他创建）
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          host: os.hostname(),
          startedAt: new Date().toISOString(),
        })
      );
    } finally {
      fs.closeSync(fd);
    }
    return { lockPath, release: () => release(lockPath) };
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      let holder = null;
      try {
        holder = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      } catch (_) {}

      // 锁文件残留（上次被 SIGKILL）且持有者已死：接管锁，避免一次强杀就再也起不来
      if (!holder || !holder.pid || !isProcessAlive(holder.pid)) {
        console.warn('[singletonLock] 发现残留锁文件且持有进程已不存在，自动接管');
        try {
          fs.unlinkSync(lockPath);
        } catch (_) {}
        return acquire(userDataPath);
      }

      const error = new Error(
        `检测到另一个 NasCabOS 实例正在运行（数据目录 ${userDataPath}，PID ${holder.pid}，启动于 ${holder.startedAt || '未知时间'}）。` +
          '同一数据目录不允许启动多个实例；如需强制启动，请先停止该进程或删除锁文件 ' +
          lockPath
      );
      error.code = 'EINSTANCEALREADYRUNNING';
      error.holder = holder;
      throw error;
    }
    // 其它错误（权限等）不阻塞启动，仅告警
    console.warn(`[singletonLock] 创建锁文件失败，跳过单例检查: ${err && err.message}`);
    return { lockPath: null, release: () => {} };
  }
}

function release(lockPath) {
  if (!lockPath) return;
  try {
    // 只删自己的锁，避免误删别人（接管场景）的锁
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const info = JSON.parse(raw);
    if (info && Number(info.pid) === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch (_) {}
}

module.exports = { acquire, release, isProcessAlive, LOCK_FILE_NAME };
