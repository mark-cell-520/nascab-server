const jwtUtil = require('../../utils/jwtUtil');
const Logger = require('../../utils/logger');
const { getLocalizedMessage } = require('../../utils/i18nUtil');
const userUtil = require('../../utils/userUtil');
const { parseAnyOrArray, matchApi } = require('../../utils/permissionUtil');

const decodeJWT = (req, token) => {
  return jwtUtil.verifyToken(process.env.JWT_SECRET, token);
};

/**
 * JWT认证中间件（服务端校验）
 * 1. 校验 JWT 签名与过期
 * 2. 在 user_token 表中校验 token 存在、有效且未过期
 * 3. scoped 类型额外校验 allow_api/allow_path，并更新 last_active_time
 */
const authenticateJWT = async (req, res, next) => {
  try {
    const token = jwtUtil.extractTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: getLocalizedMessage(req, 'auth.ACCESS_DENIED_NO_TOKEN'),
        code: 'auth.ACCESS_DENIED_NO_TOKEN',
      });
    }

    const decoded = jwtUtil.verifyToken(process.env.JWT_SECRET, token);
    if (!decoded || !decoded.tokenType || !['scoped', 'access'].includes(decoded.tokenType)) {
      return res.status(401).json({
        success: false,
        message: getLocalizedMessage(req, 'auth.INVALID_TOKEN'),
        code: 'INVALID_TOKEN',
      });
    }

    req.user = decoded;
    req.user.id = req.user.userId || req.user.id;

    if (!req.dbMain) {
      return res.status(500).json({
        success: false,
        message: getLocalizedMessage(req, 'auth.AUTHENTICATION_ERROR'),
        code: 'auth.AUTHENTICATION_ERROR',
      });
    }

    const now = new Date();
    const tokenRecord = await req.dbMain('user_token').where({ token, is_valid: true }).andWhere('expire_time', '>', now).first();

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: getLocalizedMessage(req, 'auth.INVALID_TOKEN'),
        code: 'INVALID_TOKEN',
      });
    }

    if (tokenRecord.type === 'scoped') {
      req.user.allow_api = parseAnyOrArray(tokenRecord.allow_api);
      req.user.allow_path = parseAnyOrArray(tokenRecord.allow_path);

      const rawUrl = typeof req.originalUrl === 'string' ? req.originalUrl : String(req.url || '');
      const apiPath = rawUrl.split('?')[0];
      if (!matchApi(req.user.allow_api, apiPath)) {
        return res.status(403).json({
          success: false,
          message: getLocalizedMessage(req, 'auth.API_NOT_ALLOWED'),
          code: 'auth.API_NOT_ALLOWED',
        });
      }
    }

    try {
      await req.dbMain('user_token').where({ id: tokenRecord.id }).update({ last_active_time: new Date() });
    } catch (err1) {
      Logger.error(`Failed to update token last_active_time: ${err1.message}`);
    }

    next();
  } catch (err) {
    Logger.error(`JWT auth failed: ${err.message}`);

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: getLocalizedMessage(req, 'auth.TOKEN_EXPIRED'),
        code: 'TOKEN_EXPIRED',
      });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: getLocalizedMessage(req, 'auth.INVALID_TOKEN'),
        code: 'INVALID_TOKEN',
      });
    }

    return res.status(500).json({
      success: false,
      message: getLocalizedMessage(req, 'auth.AUTHENTICATION_ERROR'),
      code: 'auth.AUTHENTICATION_ERROR',
    });
  }
};

/**
 * 管理员权限验证中间件
 * 要求用户必须是管理员或超级管理员
 *
 * 错误体和 ResponseUtil.error 保持同一约定：除 message 外必须带 `code`。客户端
 * ApiErrorLocalizer 只认 `模块.键` 形式的 code 去查翻译表，缺 code 就只能退回服务端按
 * Accept-Language 翻好的 message，App 内切换语言后提示会串语言。
 *
 * 403 的 code 统一取 'auth.PERMISSION_DENIED' 而不是 message 键
 * 'auth.INSUFFICIENT_ADMIN_PERMISSION'：客户端对「没权限」只有一个分支
 * （api_error_localizer 里已注册 auth.PERMISSION_DENIED），各路由自己抛的权限错误
 * 用的也是这个键，两边对齐才能落到同一句本地化文案上。
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: getLocalizedMessage(req, 'auth.AUTHENTICATION_REQUIRED'),
      code: 'auth.AUTHENTICATION_REQUIRED',
    });
  }

  if (!userUtil.isAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: getLocalizedMessage(req, 'auth.INSUFFICIENT_ADMIN_PERMISSION'),
      code: 'auth.PERMISSION_DENIED',
    });
  }

  next();
};

/**
 * 超级管理员权限验证中间件
 * 要求用户必须是超级管理员
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: getLocalizedMessage(req, 'auth.AUTHENTICATION_REQUIRED'),
      code: 'auth.AUTHENTICATION_REQUIRED',
    });
  }

  if (!userUtil.isSuperAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: getLocalizedMessage(req, 'auth.INSUFFICIENT_ADMIN_PERMISSION'),
      code: 'auth.PERMISSION_DENIED',
    });
  }

  next();
};

module.exports = {
  decodeJWT,
  authenticateJWT,
  requireAdmin,
  requireSuperAdmin,
};
