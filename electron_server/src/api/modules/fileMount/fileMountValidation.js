const { body, validationResult } = require('express-validator');
const { getLocalizedMessage } = require('../../../utils/i18nUtil');

function isAbsolutePath(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('\\\\')) return true;
  return /^[a-zA-Z]:\\/.test(v);
}

const FileMountValidation = {
  validateList() {
    return [
      body('uid').optional().isString().matches(/^\d+$/).withMessage('validation.ID_INVALID'),
      body('status').optional().isIn(['running', 'stopped', 'error']).withMessage('validation.VALIDATION_ERROR'),
    ];
  },

  validateUpsert() {
    return [
      body('id').optional().isInt({ min: 1 }).withMessage('validation.ID_INVALID'),
      body('name').notEmpty().isString().withMessage('validation.VALIDATION_ERROR'),
      body('mount_path').notEmpty().custom(isAbsolutePath).withMessage('validation.VALIDATION_ERROR'),
      body('remote').custom((value, { req }) => {
        const v = value === undefined || value === null ? '' : String(value).trim();
        if (v) return true;
        const protocol =
          req && req.body && req.body.config
            ? String(req.body.config.protocol || '')
                .trim()
                .toLowerCase()
            : '';
        if (protocol === 'webdav' || protocol === 'ftp' || protocol === 'sftp') return true;
        throw new Error('validation.VALIDATION_ERROR');
      }),
      body('config').optional().isObject().withMessage('validation.VALIDATION_ERROR'),
    ];
  },

  validateDelete() {
    return [body('id').notEmpty().isInt({ min: 1 }).withMessage('validation.ID_INVALID')];
  },

  validateStartStop() {
    return [body('id').notEmpty().isInt({ min: 1 }).withMessage('validation.ID_INVALID')];
  },

  validateCheckWinfsp() {
    return [];
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

module.exports = FileMountValidation;
