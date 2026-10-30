const { getLocalizedMessage } = require('../../utils/i18nUtil');
const Logger = require('../../utils/logger');

// 控制器里遍地是 `catch (e) { ResponseUtil.error(req, res, e.message || 'common.ERROR') }`。
// 上游一旦抛的是原文——SQLITE_ERROR: no such table、ENOENT: ... open '/app/...'、
// getaddrinfo EAI_AGAIN xxx、axios 的 "Request failed with status code 500"——
// getLocalizedMessage 查不到键就原样返回，用户界面上直接冒出一句没头没尾的英文，
// 有时还带着绝对路径。这里只放行"本来就该给用户看"的 message：
//   1) 形如 i18n 键的单个 token：`模块.键` / 裸 `UPPER_SNAKE`（后者走
//      auth→validation→common 回退链，`P2P.ERR_xxx` 这类客户端自有键也靠它透传）
//   2) `模块.键:上游原文`——i18nUtil 会拆开翻译前半、把原文当 %s 插值
//   3) 小写下划线键（客户端自有的 file_custom_path_name_exists 等）
//   4) 含中文的句子——服务端自己已经写好了人话，不该被通用文案盖掉
// 其余一律退回 common.ERROR，原文只进日志。
const TOKEN_LIKE = /^[A-Za-z][A-Za-z0-9_.\-]*$/;
const KEY_WITH_DETAIL = /^[A-Za-z][A-Za-z0-9]*\.[A-Z][A-Z0-9_]+:[\s\S]+$/;
const CJK = /[㐀-䶿一-鿿豈-﫿]/;

// 上面第 4 条原来只看“含不含中文字符”，而中文字符出现在哪一概不管——这等于把闸门
// 交给了数据：照片源叫 /boot/照片 时，SQLite 的报错原文
//   select count(*) ... where (`photo_index`.`path` = '/boot/照片' or ...) - no such column
// 因为含中文，整条 SQL（连宿主机绝对路径）被判定成人话原样回给了前端。
// 现在中文消息还必须同时满足：够短（人话不会长到 200 字），且不带 SQL / 堆栈 /
// 系统错误的签名。
const CJK_MAX_LEN = 200;
const RAW_LEAK_SIGNATURE =
  /`|;|SQLITE|no such|SyntaxError|TypeError|ReferenceError|RangeError|ENOENT|EACCES|EPERM|EISDIR|EAI_AGAIN|ECONN|ERR_|at\s+\S+:\d+|\.js:\d+|node:internal|knex|better-sqlite3|stack/i;

function isUserFacingMessage(raw) {
  if (!raw) return false;
  if (TOKEN_LIKE.test(raw)) return true;
  if (KEY_WITH_DETAIL.test(raw)) return true;
  if (raw.length > CJK_MAX_LEN) return false;
  return CJK.test(raw) && !RAW_LEAK_SIGNATURE.test(raw);
}

// 同一句原文只记一次日志：出错接口被轮询时不会把 combined.log 刷满
const loggedRawMessages = new Set();
function logSanitized(raw) {
  if (loggedRawMessages.has(raw)) return;
  if (loggedRawMessages.size > 200) loggedRawMessages.clear();
  loggedRawMessages.add(raw);
  Logger.warn('[responseUtil] message 不是 i18n 键，已替换为通用文案', { raw: raw.slice(0, 300) });
}

class ResponseUtil {
  static CODE_PWD_REQUIRED = 998;
  static CODE_PWD_ERROR = 999; //错误码 密码错误
  /**
   * 成功响应
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   * @param {*} data - 响应数据
   * @param {string} messageKey - 国际化消息键
   * @param {number} statusCode - HTTP状态码
   */
  static success(req, res, data = null, messageKey = 'common.SUCCESS', statusCode = 200) {
    const response = {
      success: true,
      message: getLocalizedMessage(req, messageKey),
      data: data,
    };

    // 如果data为null，移除data字段
    if (data === null) {
      delete response.data;
    }

    return res.status(statusCode).json(response);
  }

  /**
   * 错误响应
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   * @param {string} messageKey - 国际化消息键
   * @param {number} statusCode - HTTP状态码，默认 500
   * @param {*} errorData - 错误详情
   *
   * 关于默认值 500：这个默认值不是「忘了写」的兜底，而是刻意留的。
   * 全仓 800 多处调用里，绝大多数是 catch 块里的
   *   `ResponseUtil.error(req, res, err.message || 'common.ERROR')`
   * ——那本来就是服务端自己炸了，回 500 是对的。若把默认值改成 400，
   * 这些 catch 会一夜之间全变成 400，客户端会把服务端故障当成参数错误。
   * 因此：默认 500，凡是「客户端的输入有问题」的调用点必须显式写状态码
   * （400 参数/路径非法、403 受保护路径或无权写、404 资源不存在）。
   * 曾经有 62 个调用点漏写状态码，导致「路径不存在」回 500、
   * 「系统保护路径」回 500，前端无法据此分流；已全部补上显式状态码。
   */
  static error(req, res, messageKey, statusCode = 500, errorData = null, args = []) {
    const rawKey = messageKey === null || messageKey === undefined ? '' : String(messageKey);
    const safeKey = isUserFacingMessage(rawKey) ? rawKey : 'common.ERROR';
    if (safeKey !== rawKey) logSanitized(rawKey);

    const response = {
      success: false,
      message: getLocalizedMessage(req, safeKey, args),
      // code 只留键本身：`模块.键:上游原文` 里的原文不该进 code，
      // 客户端拿 code 去 _serverCodeToTrKey 查表，带原文的字符串永远查不中，
      // 只能退回去读 message——那还不如一开始就给个查得中的键。
      code: safeKey.split(':')[0],
    };

    // 开发环境包含错误详情
    if (process.env.NODE_ENV === 'development' && errorData) {
      response.error = errorData;
    }
    return res.status(statusCode).json(response);
  }

  static errorWithArgs(req, res, messageKey, args = [], statusCode = 500) {
    return this.error(req, res, messageKey, statusCode, null, args);
  }

  /**
   * 验证错误响应
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   * @param {Array} errors - 验证错误数组
   */
  static validationError(req, res, errors) {
    return res.status(400).json({
      success: false,
      message: getLocalizedMessage(req, 'validation.VALIDATION_ERROR'),
      code: 'VALIDATION_ERROR',
      errors: errors,
    });
  }

  /**
   * 未授权错误响应
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   */
  static unauthorized(req, res) {
    return this.error(req, res, 'common.UNAUTHORIZED', 401);
  }

  /**
   * 禁止访问错误响应
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   */
  static forbidden(req, res) {
    return this.error(req, res, 'common.FORBIDDEN', 403);
  }

  /**
   * 未找到错误响应
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   * @param {string} resource - 资源名称
   */
  static notFound(req, res, resource = 'RESOURCE') {
    return this.error(req, res, `${resource}_NOT_FOUND`, 404);
  }

  /**
   * 服务器错误响应
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   * @param {Error} error - 错误对象
   */
  static serverError(req, res, error) {
    console.error('Server Error:', error);
    return this.error(req, res, 'INTERNAL_SERVER_ERROR', 500);
  }

  /**
   * 分页响应
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   * @param {Array} data - 数据数组
   * @param {number} total - 总记录数
   * @param {number} page - 当前页码
   * @param {number} limit - 每页数量
   */
  static paginated(req, res, data, total, page, limit) {
    const totalPages = Math.ceil(total / limit);

    return this.success(
      req,
      res,
      {
        items: data,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
      // 必须带 `common.` 前缀：裸 'SUCCESS' 会走 getLocalizedMessage 的
      // auth → validation → common 兜底链也查不到（SUCCESS 在 common 下），
      // 最终把原始键 'SUCCESS' 当消息返回给前端。
      'common.SUCCESS'
    );
  }
}

module.exports = ResponseUtil;
