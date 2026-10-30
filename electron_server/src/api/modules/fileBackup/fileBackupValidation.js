const { body, validationResult } = require('express-validator');
const { getLocalizedMessage } = require('../../../utils/i18nUtil');

function isAbsolutePath(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('\\\\')) return true;
  return /^[a-zA-Z]:\\/.test(v);
}

function isStringArray(value) {
  if (!Array.isArray(value)) return false;
  return value.every(v => typeof v === 'string');
}

const FileBackupValidation = {
  validateList() {
    return [
      body('page').optional().isInt({ min: 1 }).withMessage('validation.PAGE_NUMBER_INVALID'),
      body('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('validation.LIMIT_INVALID'),
      body('status').optional().isIn(['running', 'stopped', 'disabled', 'error']).withMessage('validation.VALIDATION_ERROR'),
      body('type').optional().isIn(['copy', 'sync']).withMessage('validation.VALIDATION_ERROR'),
      body('keyword').optional().isString().isLength({ min: 1, max: 100 }).withMessage('validation.KEYWORD_LENGTH_INVALID'),
      body('sort_by').optional().isIn(['id', 'create_time', 'last_success_time', 'frenquence', 'status']).withMessage('validation.VALIDATION_ERROR'),
      body('sort_order').optional().isIn(['asc', 'desc']).withMessage('validation.VALIDATION_ERROR'),
    ];
  },

  validateGet() {
    return [body('id').notEmpty().isInt({ min: 1 }).withMessage('validation.ID_INVALID')];
  },

  validateUpsert() {
    return [
      body('id').optional().isInt({ min: 1 }).withMessage('validation.ID_INVALID'),
      body('source_path')
        .notEmpty()
        .custom(isStringArray)
        .withMessage('validation.VALIDATION_ERROR')
        .custom(arr => arr.length > 0)
        .withMessage('validation.VALIDATION_ERROR')
        .custom(arr => arr.every(p => isAbsolutePath(p)))
        .withMessage('validation.VALIDATION_ERROR'),
      body('type').notEmpty().isIn(['copy', 'sync']).withMessage('validation.VALIDATION_ERROR'),
      body('target_path').notEmpty().custom(isAbsolutePath).withMessage('validation.VALIDATION_ERROR'),
      body('task_config').optional().isObject().withMessage('validation.VALIDATION_ERROR'),
      body('frenquence')
        .notEmpty()
        .isInt({ min: 1, max: 24 * 365 })
        .withMessage('validation.VALIDATION_ERROR'),
      body('exclude_list')
        .optional()
        .custom(isStringArray)
        .withMessage('validation.VALIDATION_ERROR')
        .custom(arr => arr.every(p => typeof p === 'string'))
        .withMessage('validation.VALIDATION_ERROR'),
    ];
  },

  validateDelete() {
    return [body('id').notEmpty().isInt({ min: 1 }).withMessage('validation.ID_INVALID')];
  },

  validateStartStop() {
    return [body('id').notEmpty().isInt({ min: 1 }).withMessage('validation.ID_INVALID')];
  },

  validateListRecords() {
    return [
      body('id').notEmpty().isInt({ min: 1 }).withMessage('validation.ID_INVALID'),
      body('page').optional().isInt({ min: 1 }).withMessage('validation.PAGE_NUMBER_INVALID'),
      body('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('validation.LIMIT_INVALID'),
    ];
  },

  handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors
        .array()
        .map(error => getLocalizedMessage(req, error.msg))
        .join(', ');
      return res.status(400).json({
        success: false,
        message: errorMessages,
        // code 必须给：客户端的 ApiResponse.fromJson 只认 code 字段做错误分流，
        // 缺了它就只能退回读 message，失去"这是参数错误"的分类信息。
        // 取第一个错误本身的键（validation.VALIDATION_ERROR / validation.ID_INVALID ...），
        // 与 ResponseUtil.error 的单键语义一致；message 仍是全部错误的本地化拼接。
        code: (errors.array()[0] && errors.array()[0].msg) || 'validation.VALIDATION_ERROR',
      });
    }
    next();
  },
};

module.exports = FileBackupValidation;
