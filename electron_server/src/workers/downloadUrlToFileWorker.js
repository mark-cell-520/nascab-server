'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { URL } = require('url');
const Logger = require('../utils/logger');
const NetUtil = require('../utils/netUtil');
const knexUtil = require('../db/knexUtil');
const dbUtil = require('../db/dbUtil');
const tableConfig = require('../db/table/tableConfig');
const { TmdbClient } = require('./videoIndex/nfoFetchWorker/tmdbClient');

// 这个 worker 是「主进程替 API 进程发起一次 HTTP 请求」的通用出口，url 完全由
// 上游传进来（目前只有 TMDB 图片，但上游已经按各自的业务校验过一轮）。这里再兜
// 一层：只允许 http/https，并且目标不能落在内网 / 回环 / 链路本地地址上。
// 没有这一层的话，任何一个上游漏校验都会变成 SSRF：读 169.254.169.254 云元数据、
// 扫内网服务、打本机管理端口。
const _INTERNAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

function _isInternalHostname(hostname) {
  const h = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost') return true;
  for (const suffix of _INTERNAL_HOST_SUFFIXES) {
    if (h.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * 把 IPv4-mapped IPv6 还原成 NetUtil 认得的点分十进制形式。
 * WHATWG URL 会把它压缩成十六进制：new URL('http://[::ffff:127.0.0.1]/x').hostname
 * 是 '[::ffff:7f00:1]'。NetUtil.isPrivateIP 只剥 '::ffff:' 前缀后按字符串比，
 * 拿到 '7f00:1' 就什么都判不出来，于是本机地址又放行了。
 */
function _normalizeHostForCheck(hostname) {
  const h = String(hostname || '').trim();
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (!m) return h;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return `::ffff:${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/**
 * 判断一个 URL 是否可以安全地由本进程发起请求。
 * 字面量 IP 直接判；域名则做一次 DNS 解析，解析结果里只要有一个内网地址就整体拒绝
 * （一个域名同时有公网和内网 A 记录时，按最严格的算）。
 */
async function isSafeDownloadUrl(urlStr) {
  let u;
  try {
    u = new URL(String(urlStr || '').trim());
  } catch (_) {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  // WHATWG URL 对 IPv6 主机名是带方括号的（new URL('http://[::1]/x').hostname === '[::1]'）。
  // 必须先去掉括号再判：否则 NetUtil.isPrivateIP('[::1]') 认不出来、下面的 IP 字面量
  // 正则也匹配不上，http://[::1]:6789/ 这种本机探测就直接放过去了。
  const hostname = _normalizeHostForCheck(
    String(u.hostname || '')
      .replace(/^\[|\]$/g, '')
      .trim()
      .toLowerCase()
  );
  if (!hostname) return false;
  if (_isInternalHostname(hostname)) return false;
  if (NetUtil.isPrivateIP(hostname)) return false;

  // 已经是 IP 字面量且不在内网段 → 放行；是域名才需要解析。
  const isIpLiteral = NetUtil.isPrivateIP(hostname) || /^[0-9.]+$/.test(hostname) || hostname.includes(':');
  if (isIpLiteral) return true;

  let addresses = [];
  try {
    const res = await dns.promises.lookup(hostname, { all: true });
    addresses = Array.isArray(res) ? res.map(r => r && r.address).filter(Boolean) : [];
  } catch (_) {
    // 解析不了就当作不安全：反正也下载不到，fail closed。
    return false;
  }
  if (!addresses.length) return false;
  for (const addr of addresses) {
    if (NetUtil.isPrivateIP(_normalizeHostForCheck(addr))) return false;
  }
  return true;
}

let started = false;
let dbInitialized = false;

function _sleep(ms) {
  const n = Math.max(0, Number(ms || 0) || 0);
  if (!n) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, n));
}

async function ensureDbInit() {
  if (dbInitialized) return;
  try {
    await knexUtil.init(dbUtil.DB_PATHS.MAIN_DB);
  } catch (e) {
    Logger.error('[downloadUrlToFileWorker] init db failed', e);
  } finally {
    dbInitialized = true;
  }
}

async function getProxyAgent(allowProxy) {
  if (!allowProxy) return undefined;
  await ensureDbInit();
  try {
    const [proxyEnable, proxyUrlRaw] = await Promise.all([tableConfig.getConfigByKey('tmdbProxyEnable').catch(() => null), tableConfig.getConfigByKey('tmdbProxyUrl').catch(() => null)]);
    const enabled = proxyEnable === '1' || proxyEnable === 1;
    const proxyUrl = enabled && proxyUrlRaw ? String(proxyUrlRaw).trim() : '';
    if (!proxyUrl) return undefined;
    const client = new TmdbClient({ apiUrl: 'https://api.tmdb.org', apiToken: '', proxyUrl, language: 'en-US' });
    return client && client._proxyAgent ? client._proxyAgent : undefined;
  } catch (_) {
    return undefined;
  }
}

async function cleanupFile(p) {
  const fp = String(p || '').trim();
  if (!fp) return;
  try {
    await fs.promises.unlink(fp);
  } catch (_) {}
}

function _resolveRedirectUrl(currentUrl, location) {
  const loc = String(location || '').trim();
  if (!loc) return '';
  try {
    const u = new URL(currentUrl);
    const next = new URL(loc, u);
    return next.toString();
  } catch (_) {
    return '';
  }
}

async function downloadToFile({ url, outPath, agent, timeoutMs, maxRedirects = 3 }) {
  const urlStr = String(url || '').trim();
  const out = String(outPath || '').trim();
  if (!urlStr || !out) return false;

  let u;
  try {
    u = new URL(urlStr);
  } catch (_) {
    return false;
  }

  // SSRF 兜底（重定向也会走到这里，因为下面是通过递归调用本函数的）：
  // 协议非 http/https、或目标落在内网/回环/链路本地，一律拒绝。
  if (!(await isSafeDownloadUrl(urlStr))) {
    Logger.warn('[downloadUrlToFileWorker] 拒绝下载非公网/非 http(s) 地址', { url: urlStr });
    return false;
  }

  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  await cleanupFile(out);

  return await new Promise(resolve => {
    const proto = u.protocol === 'http:' ? http : https;
    const file = fs.createWriteStream(out, { flags: 'w' });

    let finished = false;
    const finishOnce = ok => {
      if (finished) return;
      finished = true;
      try {
        file.close(() => resolve(!!ok));
      } catch (_) {
        resolve(!!ok);
      }
    };

    const req = proto.request(
      u,
      {
        method: 'GET',
        headers: { Accept: '*/*' },
        agent: u.protocol === 'https:' ? agent : undefined,
      },
      res => {
        const code = Number(res && res.statusCode ? res.statusCode : 0) || 0;
        const isRedirect = code >= 300 && code < 400 && res && res.headers && res.headers.location;
        if (isRedirect) {
          const nextUrl = _resolveRedirectUrl(u.toString(), res.headers.location);
          res.resume();
          file.close(async () => {
            await cleanupFile(out);
            if (!nextUrl || maxRedirects <= 0) return resolve(false);
            const ok = await downloadToFile({ url: nextUrl, outPath: out, agent, timeoutMs, maxRedirects: maxRedirects - 1 });
            return resolve(!!ok);
          });
          return;
        }

        if (code >= 400) {
          res.resume();
          file.close(async () => {
            await cleanupFile(out);
            resolve(false);
          });
          return;
        }

        res.pipe(file);
        file.on('finish', () => finishOnce(true));
        file.on('error', async () => {
          await cleanupFile(out);
          finishOnce(false);
        });
      }
    );

    const timeout = Math.min(300000, Math.max(1000, Number(timeoutMs || 0) || 0)) || 0;
    if (timeout) {
      req.setTimeout(timeout, () => {
        try {
          req.destroy(new Error('timeout'));
        } catch (_) {}
      });
    }

    req.on('error', async () => {
      await cleanupFile(out);
      finishOnce(false);
    });

    req.end();
  });
}

async function runJob({ url, targetPath, tmpPath, timeoutMs, allowProxy }) {
  const u = String(url || '').trim();
  const target = String(targetPath || '').trim();
  const tmp = String(tmpPath || '').trim();
  if (!u || !target || !tmp) return false;

  try {
    const st = await fs.promises.stat(target);
    if (st && st.isFile()) return true;
  } catch (_) {}

  await fs.promises.mkdir(path.dirname(target), { recursive: true });

  const agent = await getProxyAgent(allowProxy);
  const ok = await downloadToFile({ url: u, outPath: tmp, agent, timeoutMs });
  if (!ok) {
    await cleanupFile(tmp);
    return false;
  }

  try {
    const st = await fs.promises.stat(target);
    if (st && st.isFile()) {
      await cleanupFile(tmp);
      return true;
    }
  } catch (_) {}

  try {
    await fs.promises.rename(tmp, target);
    return true;
  } catch (e) {
    await cleanupFile(tmp);
    return false;
  }
}

process.on('message', message => {
  if (!message || !message.type) return;
  if (message.type === 'stop') {
    process.exit(0);
    return;
  }
  if (message.type !== 'start') return;
  if (started) return;
  started = true;

  const data = message.data && typeof message.data === 'object' ? message.data : {};
  const url = data.url;
  const targetPath = data.targetPath;
  const tmpPath = data.tmpPath;
  const timeoutMs = data.timeoutMs;
  const allowProxy = !!data.allowProxy;

  Promise.resolve()
    .then(async () => {
      const ok = await runJob({ url, targetPath, tmpPath, timeoutMs, allowProxy });
      await _sleep(50);
      process.exit(ok ? 0 : 1);
    })
    .catch(async e => {
      Logger.error('[downloadUrlToFileWorker] job failed', e);
      await _sleep(50);
      process.exit(1);
    });
});
