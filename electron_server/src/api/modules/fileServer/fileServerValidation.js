const { body, validationResult } = require('express-validator');
const { getLocalizedMessage } = require('../../../utils/i18nUtil');
const path = require('path');
const FileUtil = require('../../../utils/fileUtil');

// WebDav/FTP/SFTP 是直接暴露到网络的服务，而且 fileServerWorker 里用户是
// 以 uid:0（root）跑的。root_path 原来只要"是绝对路径"就放行：把服务根指到
// / 或 /etc，等于把整个文件系统（含 /etc/shadow、main.db）挂到网络上；
// config.users.*.home_dir 同理，它决定每个 FTP/SFTP 用户登录后落在哪。
// 这里统一挡掉系统目录（isProtectedPath 内部带 resolve + realpath 还原 +
// 子树判断；/home、/mnt、/media、/srv 这些 NAS 数据挂载点不在名单里）。
function assertNoProtectedRootPath(value) {
  const checkOne = raw => {
    const p = typeof raw === 'string' ? raw.trim() : '';
    if (!p) return true;
    if (FileUtil.isProtectedPath(path.resolve(p))) {
      throw new Error('fileServer.PROTECTED_PATH');
    }
    return true;
  };

  if (typeof value === 'string') return checkOne(value);
  if (!Array.isArray(value)) return true;
  for (const item of value) {
    if (typeof item === 'string') {
      checkOne(item);
      continue;
    }
    if (item && typeof item === 'object' && typeof item.path === 'string') {
      checkOne(item.path);
    }
  }
  return true;
}

function assertNoProtectedHomeDir(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string') return true;
  const p = value.trim();
  if (!p) return true;
  if (FileUtil.isProtectedPath(path.resolve(p))) {
    throw new Error('fileServer.PROTECTED_PATH');
  }
  return true;
}

function isAbsolutePath(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('\\\\')) return true;
  return /^[a-zA-Z]:\\/.test(v);
}

function isOptionalPem(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string') return false;
  return value.includes('-----BEGIN');
}

function isRootPathMappings(value) {
  if (typeof value === 'string') return isAbsolutePath(value);
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set();
  for (const item of value) {
    if (typeof item === 'string') {
      const p = item.trim();
      if (!isAbsolutePath(p)) return false;
      if (seen.has(p)) return false;
      seen.add(p);
      continue;
    }

    if (item && typeof item === 'object') {
      const p = typeof item.path === 'string' ? item.path.trim() : '';
      if (!isAbsolutePath(p)) return false;
      if (seen.has(p)) return false;
      seen.add(p);

      const isOptionalBool01 = v => {
        if (v === undefined || v === null) return true;
        if (typeof v === 'boolean') return true;
        if (typeof v === 'number') return v === 0 || v === 1;
        if (typeof v === 'string') return v === '0' || v === '1';
        return false;
      };

      if (!isOptionalBool01(item.write)) return false;
      if (!isOptionalBool01(item.update)) return false;
      if (!isOptionalBool01(item.delete)) return false;
      continue;
    }

    return false;
  }
  return true;
}

const FileServerValidation = {
  validateUpsert() {
    return [
      body('uid').notEmpty().isString().matches(/^\d+$/).withMessage('validation.ID_INVALID'),
      body('server_type').notEmpty().isIn(['WebDav', 'FTP', 'SFTP']).withMessage('validation.VALIDATION_ERROR'),
      body('root_path')
        .notEmpty()
        .custom(isRootPathMappings)
        .withMessage('validation.VALIDATION_ERROR')
        .custom(assertNoProtectedRootPath)
        .withMessage('fileServer.PROTECTED_PATH'),
      body('http_port').optional().isInt({ min: 1, max: 65535 }).withMessage('validation.VALIDATION_ERROR'),
      body('https_port').optional().isInt({ min: 1, max: 65535 }).withMessage('validation.VALIDATION_ERROR'),
      body('config').optional().isObject().withMessage('validation.VALIDATION_ERROR'),
      body('config.users').optional().isArray().withMessage('validation.VALIDATION_ERROR'),
      body('config.users.*.username').optional().isString().notEmpty().withMessage('validation.VALIDATION_ERROR'),
      body('config.users.*.password').optional().isString().notEmpty().withMessage('validation.VALIDATION_ERROR'),
      body('config.users.*.home_dir')
        .optional()
        .isString()
        .withMessage('validation.VALIDATION_ERROR')
        .custom(assertNoProtectedHomeDir)
        .withMessage('fileServer.PROTECTED_PATH'),
      body('config.tls_cert_pem').optional().custom(isOptionalPem).withMessage('validation.VALIDATION_ERROR'),
      body('config.tls_key_pem').optional().custom(isOptionalPem).withMessage('validation.VALIDATION_ERROR'),
    ];
  },

  validateGet() {
    return [
      body('uid').notEmpty().isString().matches(/^\d+$/).withMessage('validation.ID_INVALID'),
      body('server_type').notEmpty().isIn(['WebDav', 'FTP', 'SFTP']).withMessage('validation.VALIDATION_ERROR'),
    ];
  },

  validateStartStop() {
    return [
      body('server_type').notEmpty().isIn(['WebDav', 'FTP', 'SFTP']).withMessage('validation.VALIDATION_ERROR'),
      body('restart').optional().isBoolean().withMessage('validation.VALIDATION_ERROR'),
    ];
  },

  validateGetPorts() {
    return [body('server_type').notEmpty().isIn(['WebDav', 'FTP', 'SFTP']).withMessage('validation.VALIDATION_ERROR')];
  },

  validateSetPorts() {
    return [
      body('server_type').notEmpty().isIn(['WebDav', 'FTP', 'SFTP']).withMessage('validation.VALIDATION_ERROR'),
      body('http_port').optional().isInt({ min: 1, max: 65535 }).withMessage('validation.VALIDATION_ERROR'),
      body('https_port').optional().isInt({ min: 1, max: 65535 }).withMessage('validation.VALIDATION_ERROR'),
    ];
  },

  validateList() {
    return [
      body('uid').optional().isString().matches(/^\d+$/).withMessage('validation.ID_INVALID'),
      body('server_type').optional().isIn(['WebDav', 'FTP', 'SFTP']).withMessage('validation.VALIDATION_ERROR'),
      body('status').optional().isIn(['running', 'stopped', 'error']).withMessage('validation.VALIDATION_ERROR'),
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

module.exports = FileServerValidation;
