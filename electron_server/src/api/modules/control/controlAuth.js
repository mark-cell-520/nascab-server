'use strict';
/**
 * 控制接口鉴权
 *
 * 控制接口面向脚本 / AI Agent，不走登录态：一个长期令牌换全部管理能力。
 * 令牌等价于管理员 root，所以这里只做「有没有、对不对」，不做分级——
 * 需要分级就用 Web 控制台的 JWT + 用户权限体系。
 */

const crypto = require('crypto');
const controlTokenUtil = require('../../../utils/controlTokenUtil');

const TOKEN_HEADER = 'x-nascab-token';

/** 常数时间比较，避免按字符逐个泄露前缀 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** 从请求中取出调用方声明的令牌 */
function extractToken(req) {
  const auth = req.headers && req.headers.authorization ? String(req.headers.authorization) : '';
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
    // 也接受直接裸传令牌
    if (!/\s/.test(auth.trim())) return auth.trim();
  }
  const headerToken = req.headers && req.headers[TOKEN_HEADER] ? String(req.headers[TOKEN_HEADER]).trim() : '';
  if (headerToken) return headerToken;
  const queryToken = req.query && req.query.token ? String(req.query.token).trim() : '';
  if (queryToken) return queryToken;
  return '';
}

function unauthorized(res, message) {
  return res.status(401).json({
    ok: false,
    error: { code: 'CONTROL_UNAUTHORIZED', message: message || '缺少或无效的控制令牌' },
  });
}

/**
 * 控制接口鉴权中间件
 * 令牌来源：NASCAB_CONTROL_TOKEN / config.json 的 control.token / 自动生成并落盘
 */
function requireControlToken(req, res, next) {
  const expected = controlTokenUtil.getControlToken();
  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: { code: 'CONTROL_DISABLED', message: '控制接口未启用（control.enabled=false）' },
    });
  }
  const provided = extractToken(req);
  if (!provided) {
    return unauthorized(res, '缺少控制令牌：请用 Authorization: Bearer <token> 或 X-NasCab-Token 头传递');
  }
  if (!safeEqual(provided, expected)) {
    return unauthorized(res, '控制令牌不正确');
  }
  req.controlToken = provided;
  return next();
}

module.exports = {
  requireControlToken,
  extractToken,
  safeEqual,
  TOKEN_HEADER,
};
