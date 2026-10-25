'use strict';
/**
 * 机器控制接口（/api/control）的令牌管理
 *
 * 设计约束：
 *   1. 控制令牌等价于「管理员 root」——一个令牌即可做文件增删、容器启停等全部操作，
 *      因此必须显式、可轮换、且不能默认暴露到局域网（control.host 默认 127.0.0.1）。
 *   2. 未显式配置时自动生成并落盘，重启后复用；否则运维每重启一次就要改一遍客户端配置。
 *   3. 落盘位置在数据目录内（与数据库同级），并尽量收紧文件权限。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');

const CONTROL_INFO_FILE = 'control.json';

let _cached = null;

/** 数据目录下的控制接口信息文件路径 */
function getControlInfoPath() {
  let dir = '';
  try {
    dir = typeof config.getUserDataPath === 'function' ? config.getUserDataPath() : '';
  } catch (_) {
    dir = '';
  }
  if (!dir) dir = path.join(process.cwd(), 'data');
  return path.join(dir, CONTROL_INFO_FILE);
}

function readInfoFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeInfoFile(filePath, info) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
    // Windows 上没有 POSIX 权限位，chmod 只影响只读属性；失败无所谓
    try {
      fs.chmodSync(filePath, 0o600);
    } catch (_) {}
    return true;
  } catch (err) {
    console.warn(`[control] 写入 ${filePath} 失败: ${err && err.message ? err.message : err}`);
    return false;
  }
}

function generateToken() {
  return `ncctl_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * 解析当前生效的控制令牌
 * 优先级：环境变量/配置文件的显式值 > 已落盘的自动生成值 > 新生成并落盘
 *
 * 为什么要用 O_EXCL 竞争创建：express 是以 cluster 多 worker 运行的，
 * 每个 worker 都会挂载 /api/control，令牌必须在所有 worker 间一致，
 * 否则同一份配置在主端口上时好时坏。先到先得地抢占文件创建权即可保证一致。
 * @returns {string} 令牌（未启用控制接口时为空字符串）
 */
function getControlToken() {
  if (_cached && _cached.token) return _cached.token;

  const control = config.control || {};
  if (!control.enabled) return '';

  const explicit = String(control.token || '').trim();
  const infoPath = getControlInfoPath();

  if (explicit) {
    // 显式令牌优先，同时把它写进信息文件，方便本机客户端自动发现
    const info = readInfoFile(infoPath) || {};
    _cached = { token: explicit, source: 'config', port: control.port, host: control.host };
    if (info.token !== explicit || info.port !== control.port || info.host !== control.host) {
      writeInfoFile(infoPath, { ...info, ..._cached, updatedAt: new Date().toISOString() });
    }
    return explicit;
  }

  const stored = readInfoFile(infoPath);
  if (stored && typeof stored.token === 'string' && stored.token.trim()) {
    _cached = { token: stored.token.trim(), source: 'generated', claimed: false, port: control.port, host: control.host };
    return _cached.token;
  }

  const token = generateToken();
  const claim = claimTokenFile(infoPath, token, control);
  _cached = { token: claim.token, source: 'generated', claimed: claim.claimed, port: control.port, host: control.host };
  return claim.token;
}

/** 同步等待若干毫秒（只在启动期抢令牌时用，阻塞可接受） */
function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {}
}

/**
 * 以独占创建的方式抢占令牌文件
 * @returns {{token:string, claimed:boolean}} token 为最终生效的令牌（可能是别的 worker 先写好的），
 *          claimed 表示本进程是否抢到了创建权（用于决定谁来打启动横幅，避免每个 worker 都打一遍）
 */
function claimTokenFile(infoPath, token, control) {
  const payload = {
    token,
    source: 'generated',
    host: control.host,
    port: control.port,
    createdAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
  } catch (_) {}

  let fd = null;
  try {
    fd = fs.openSync(infoPath, 'wx'); // 仅当文件不存在时创建成功
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      // 别的 worker 先抢到了：等它把内容写完，然后用它的令牌
      for (let i = 0; i < 40; i += 1) {
        const other = readInfoFile(infoPath);
        if (other && typeof other.token === 'string' && other.token.trim()) {
          return { token: other.token.trim(), claimed: false };
        }
        sleepMs(25);
      }
      // 极端情况：抢到创建权的进程没写完就退了，覆盖重写
      writeInfoFile(infoPath, payload);
      return { token, claimed: true };
    }
    // 目录不可写等：退化为进程内令牌（重启后会变，但比起不来好）
    console.warn(`[control] 无法写入令牌文件 ${infoPath}: ${err && err.message ? err.message : err}`);
    return { token, claimed: false };
  }

  try {
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(infoPath, 0o600);
  } catch (_) {}
  return { token, claimed: true };
}

/**
 * 控制接口的连接信息（供启动横幅与运维查阅）
 */
function getControlInfo() {
  const control = config.control || {};
  if (!control.enabled) return { enabled: false };
  const token = getControlToken();
  return {
    enabled: true,
    token,
    tokenSource: _cached ? _cached.source : 'config',
    // 本进程是否抢到了令牌创建权：cluster 下多个 worker 都会走到这里，只让一个打完整横幅
    tokenClaimed: _cached ? !!_cached.claimed : false,
    host: control.host,
    port: control.port,
    infoFile: getControlInfoPath(),
  };
}

module.exports = {
  getControlToken,
  getControlInfo,
  getControlInfoPath,
  generateToken,
};
