const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Logger = require('../../utils/logger');
const ResponseUtil = require('../apiUtils/responseUtil');
const QuickShareBinary = require('../modules/quickShare/quickShareBinary');

// ---------- 暴力破解防护 ----------
const BRUTE_MAX_ATTEMPTS = 5;
const BRUTE_LOCKOUT_MS = 1 * 60 * 1000; // 1分钟
const BRUTE_WINDOW_MS = 1 * 60 * 1000; // 失败计数窗口 1 分钟
const _bruteStore = new Map();

// 暴力破解的锁定键按 IP 聚合，所以这里取到的 IP 必须不可被客户端伪造：
// 原来无条件读 x-forwarded-for / x-real-ip，而分享链接是公开可达的，任何人
// 都能自己带一个 X-Forwarded-For 头，每次失败换一个假 IP，5 次锁定形同虚设。
// app.js 已经设了 app.set('trust proxy', ['loopback'])：Express 只在
// req.socket.remoteAddress 是回环地址（nginx 反代从 127.0.0.1:6789 过来）时才认
// XFF，外部直连时 req.ip 就是真实连接 IP。直接用 req.ip 即复用这套策略，
// 不再自己解头部。
function _getClientIp(req) {
  if (req && typeof req.ip === 'string' && req.ip) return req.ip;
  const h = (req && req.headers) || {};
  const forwarded = h['x-forwarded-for'] || h['x-real-ip'];
  if (forwarded && req && req.socket && (req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1')) {
    const first = typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0];
    const v = (first || '').trim();
    if (v) return v;
  }
  return (req && req.socket && req.socket.remoteAddress) || (req && req.connection && req.connection.remoteAddress) || '';
}

function getQuickShareBruteKey(req, token) {
  const ip = _getClientIp(req);
  const t = typeof token === 'string' ? token.trim() : '';
  return `qs:${ip}:${t || 'unknown'}`;
}

function isQuickShareBruteLocked(key) {
  const entry = _bruteStore.get(key);
  if (!entry) return false;
  const now = Date.now();
  if (entry.lockedUntil && entry.lockedUntil > now) return true;
  if (now - entry.firstAt > BRUTE_WINDOW_MS) {
    _bruteStore.delete(key);
    return false;
  }
  return false;
}

function recordQuickShareBruteFailure(key) {
  const now = Date.now();
  let entry = _bruteStore.get(key);
  if (!entry) {
    entry = { count: 0, firstAt: now, lockedUntil: null };
    _bruteStore.set(key, entry);
  }
  if (now - entry.firstAt > BRUTE_WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = now;
    entry.lockedUntil = null;
  }
  entry.count += 1;
  if (entry.count >= BRUTE_MAX_ATTEMPTS) {
    entry.lockedUntil = now + BRUTE_LOCKOUT_MS;
  }
}

function clearQuickShareBruteOnSuccess(key) {
  _bruteStore.delete(key);
}

// 定期清理过期条目，避免内存泄漏
function _bruteCleanup() {
  const now = Date.now();
  for (const [k, v] of _bruteStore.entries()) {
    if (v.lockedUntil && v.lockedUntil < now) _bruteStore.delete(k);
    else if (!v.lockedUntil && now - v.firstAt > BRUTE_WINDOW_MS) _bruteStore.delete(k);
  }
}
setInterval(_bruteCleanup, 60 * 1000).unref();

// ---------- 原有逻辑 ----------

function _getToken(req) {
  const q = req.query || {};
  const b = req.body || {};
  const v = q.qt ?? q.token ?? b.qt ?? b.token;
  return typeof v === 'string' ? v.trim() : String(v || '').trim();
}

function _getPwd(req) {
  const b = req.body || {};
  const h = req.headers || {};
  const v = b.pwd ?? b.password ?? h['x-qspwd'] ?? h['x-quickshare-password'];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function _getAccessToken(req) {
  const q = req.query || {};
  const b = req.body || {};
  const h = req.headers || {};
  const v = q.qsat ?? q.quickShareToken ?? b.qsat ?? b.quickShareToken ?? h['x-qsat'] ?? h['x-quickshare-token'];
  return typeof v === 'string' ? v.trim() : String(v || '').trim();
}

function _getRelPath(req) {
  const q = req.query || {};
  const b = req.body || {};
  const v = q.p ?? q.rel ?? q.pathRel ?? b.p ?? b.rel ?? b.pathRel;
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/**
 * 纯词法包含判定。
 * 注意 rel 的 '..' 判定必须精确到 '..' 或 '../…'：原来写成 rel.startsWith('..')，
 * 会把名字以 '..' 开头的正常文件（'..foo.txt'、未解码的 '..%2f…'）误判成逃逸，
 * 这些文件明明就在分享目录里，却永远打不开。
 */
function _lexicallyInside(rootResolved, targetResolved) {
  if (rootResolved === targetResolved) return true;
  const rel = path.relative(rootResolved, targetResolved);
  if (!rel || path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/**
 * 逐个目录向上找第一个真实存在的祖先，取其 realpath。
 * 分享里的目标路径常常还没建出来（待下载、待上传），直接 realpathSync 会 ENOENT；
 * 只还原存在的部分也能挡住 '/share/link/etc' 这种中间跳板。
 * 根目录一定存在，所以这个函数不会失败，返回值必定非空。
 */
function _realpathOrNearestExisting(p) {
  let current = p;
  while (current && current !== path.parse(current).root) {
    try {
      const real = fs.realpathSync(current);
      return real && real !== current ? real : current;
    } catch (_) {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return current;
}

/**
 * 判断 targetPath 是否落在分享根目录内。
 * 原来是纯词法判定：分享目录里放一个指向 /etc 的软链接，一个 '..' 都没有，
 * 词法检查照样放行，公开分享就能读到 /etc/shadow。
 * 现在补一道 realpath 还原后再判包含。
 */
function _isInsideRoot(rootPath, targetPath) {
  const rootResolved = path.resolve(String(rootPath || ''));
  const targetResolved = path.resolve(String(targetPath || ''));
  if (!rootResolved || !targetResolved) return false;

  if (!_lexicallyInside(rootResolved, targetResolved)) return false;

  const realRoot = _realpathOrNearestExisting(rootResolved);
  const realTarget = _realpathOrNearestExisting(targetResolved);
  if (!realRoot || !realTarget) return false;
  return _lexicallyInside(realRoot, realTarget);
}

function _parsePwdHash(stored) {
  const raw = typeof stored === 'string' ? stored : stored == null ? '' : String(stored);
  const s = raw.trim();
  if (!s) return { mode: 'empty' };
  const parts = s.split('$');
  if (parts.length === 4 && parts[0] === 'pbkdf2') {
    const iter = Number(parts[1]) || 0;
    const salt = parts[2] || '';
    const hash = parts[3] || '';
    if (iter > 0 && salt && hash) return { mode: 'pbkdf2', iter, salt, hash };
  }
  return { mode: 'plain', value: s };
}

function _hashPwdPbkdf2(crypto, pwd, iter, salt) {
  const buf = crypto.pbkdf2Sync(String(pwd || ''), String(salt || ''), Number(iter || 0), 32, 'sha256');
  return buf.toString('hex');
}

function _sha256Hex(text) {
  return crypto
    .createHash('sha256')
    .update(String(text ?? ''), 'utf8')
    .digest('hex');
}

function verifyQuickSharePwd(stored, provided) {
  const parsed = _parsePwdHash(stored);
  if (parsed.mode === 'empty') return false;
  // 入参也 trim：建分享时口令是被 trim 后才落库的（见 quickShareService._hashPwd），
  // 校验侧不 trim 的话，用户在输入框多打一个空格就永远对不上。
  const pwd = typeof provided === 'string' ? provided : provided == null ? '' : String(provided);
  const trimmedPwd = pwd.trim();
  if (!trimmedPwd) return false;
  if (parsed.mode === 'plain') return trimmedPwd === parsed.value;
  const crypto = require('crypto');
  const actual = _hashPwdPbkdf2(crypto, trimmedPwd, parsed.iter, parsed.salt);
  return actual === parsed.hash;
}

function verifyQuickShareAccessToken(req, share, token, accessToken) {
  const raw = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!raw) return false;
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;

  try {
    const decoded = jwt.verify(raw, secret);
    if (!decoded || decoded.type !== 'quickShare') return false;
    if (String(decoded.qt || '') !== String(token || '')) return false;
    const expectedPwdHash = _sha256Hex(share && share.pwd ? String(share.pwd) : '');
    if (String(decoded.pwdHash || '') !== expectedPwdHash) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function requireQuickShareAccess({ getShareByToken }) {
  return async (req, res, next) => {
    try {
      const routePath = `${req.method} ${(req.originalUrl || req.url || '').split('?')[0]}`;

      const sendErr = (statusCode, reason, extra = {}) => {
        Logger.warn('[quickShare] requireQuickShareAccess: reject', {
          routePath,
          httpStatus: statusCode,
          reason,
          ...extra,
        });
        return res
          .status(statusCode)
          .set('content-type', 'application/octet-stream')
          .send(QuickShareBinary.encodeError({ msgType: QuickShareBinary.MSG_LIST_RES, code: statusCode }));
      };

      const token = _getToken(req);
      if (!token) return sendErr(400, 'missing_qt_query');

      const share = await getShareByToken(req, token);
      if (!share) return sendErr(404, 'share_not_in_db', { qt: token });

      const now = Date.now();
      const endTime = share.end_time ? new Date(share.end_time).getTime() : null;
      if (endTime && Number.isFinite(endTime) && endTime > 0 && endTime < now) {
        return sendErr(410, 'share_expired', { qt: token, endTime });
      }

      const needsPwd = true;
      const bruteKey = getQuickShareBruteKey(req, token);
      if (isQuickShareBruteLocked(bruteKey)) {
        return sendErr(429, 'brute_locked', { qt: token });
      }
      const providedPwd = _getPwd(req);
      if (needsPwd) {
        const accessToken = _getAccessToken(req);
        const okByToken = verifyQuickShareAccessToken(req, share, token, accessToken);
        if (!okByToken && !providedPwd) {
          const secret = process.env.JWT_SECRET;
          let qsatHint = 'missing_or_invalid';
          if (!secret) qsatHint = 'JWT_SECRET_not_set';
          else if (!accessToken) qsatHint = 'qsat_empty';
          else {
            try {
              const decoded = jwt.verify(accessToken, secret);
              if (!decoded || decoded.type !== 'quickShare') qsatHint = 'jwt_wrong_type';
              else if (String(decoded.qt || '') !== String(token || '')) qsatHint = 'jwt_qt_mismatch';
              else qsatHint = 'jwt_pwdHash_mismatch_or_other';
            } catch (e) {
              qsatHint = e && e.name === 'TokenExpiredError' ? 'jwt_expired' : 'jwt_verify_failed';
            }
          }
          return sendErr(ResponseUtil.CODE_PWD_REQUIRED, 'need_password_or_valid_qsat', {
            qt: token,
            hasQsat: !!accessToken,
            qsatHint,
          });
        }
        if (!okByToken && !verifyQuickSharePwd(share.pwd, providedPwd)) {
          recordQuickShareBruteFailure(bruteKey);
          return sendErr(ResponseUtil.CODE_PWD_ERROR, 'password_wrong', { qt: token });
        }
        clearQuickShareBruteOnSuccess(bruteKey);
      }

      const rel = _getRelPath(req);
      const rootPath = path.resolve(String(share.path || ''));
      const normalizedRel = String(rel || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (normalizedRel) {
        try {
          const st = await fs.promises.stat(rootPath);
          if (st && st.isFile()) {
            return sendErr(403, 'rel_path_on_file_share', { qt: token, rel: normalizedRel });
          }
        } catch (_) {}
      }
      const targetPath = normalizedRel ? path.resolve(rootPath, normalizedRel) : rootPath;
      if (!_isInsideRoot(rootPath, targetPath)) {
        return sendErr(403, 'path_outside_share_root', {
          qt: token,
          rootPath,
          targetPath,
          rel: normalizedRel,
        });
      }

      Logger.info('[quickShare] requireQuickShareAccess: ok', {
        routePath,
        qt: token,
        rel: normalizedRel || '(root)',
      });
      req.quickShare = { token, share, rootPath, relPath: normalizedRel, targetPath };
      next();
    } catch (e) {
      Logger.error('[quickShare] requireQuickShareAccess: exception', e, {
        routePath: `${req.method} ${(req.originalUrl || req.url || '').split('?')[0]}`,
      });
      return res
        .status(500)
        .set('content-type', 'application/octet-stream')
        .send(QuickShareBinary.encodeError({ msgType: QuickShareBinary.MSG_LIST_RES, code: 500 }));
    }
  };
}

module.exports = {
  requireQuickShareAccess,
  verifyQuickSharePwd,
  verifyQuickShareAccessToken,
  getQuickShareBruteKey,
  isQuickShareBruteLocked,
  recordQuickShareBruteFailure,
  clearQuickShareBruteOnSuccess,
};
