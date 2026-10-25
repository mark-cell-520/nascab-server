'use strict';
/**
 * 内部委托：让控制接口复用控制台已有的控制器，而不是把业务逻辑抄一遍
 *
 * 做法是构造一个「带数据库句柄的超级管理员 req」+「捕获响应的 res」，
 * 直接调用模块里的 controller 方法。这样 /api/control/* 与 /api/docker、
 * /api/transmission、/api/file 走的是同一套实现，上游修了 bug 两边同时受益。
 *
 * 注意：被委托的控制器原样执行，包含 protectedPath 校验、文件日志、回收站等
 * 全部副作用；控制令牌本身就是 root 级凭证，这是有意为之。
 */

const { EventEmitter } = require('events');
const dbUtil = require('../../../db/dbUtil');

/** 控制接口使用的虚拟用户：超级管理员 + 不限 API 与路径 */
const CONTROL_USER = {
  id: 0,
  userId: 0,
  username: 'control-api',
  type: 'super_admin',
  allow_api: 'ANY',
  allow_path: 'ANY',
};

function attachDb(req) {
  try {
    req.dbMain = dbUtil.getConnectMainDb().knex;
    req.dbVideo = dbUtil.getConnectVideoDb().knex;
    req.dbBook = dbUtil.getConnectBookDb().knex;
    req.dbMusic = dbUtil.getConnectMusicDb().knex;
    req.dbFile = dbUtil.getConnectFileDb().knex;
    req.dbPhoto = dbUtil.getConnectPhotoDb().knex;
    req.dbGeo = dbUtil.getConnectGeoDb().knex;
  } catch (_) {}
  return req;
}

/**
 * 构造委托用的请求对象
 * @param {Object} options { query, body, params, headers, method, url, files }
 */
function createDelegateRequest(options = {}) {
  const req = new EventEmitter();
  req.query = options.query || {};
  req.body = options.body || {};
  req.params = options.params || {};
  req.headers = options.headers || { 'accept-language': 'zh-CN' };
  req.cookies = {};
  req.method = String(options.method || 'POST').toUpperCase();
  req.originalUrl = String(options.url || '/api/control');
  req.url = req.originalUrl;
  req.path = req.originalUrl.split('?')[0];
  req.baseUrl = '';
  req.ip = '127.0.0.1';
  req.ips = ['127.0.0.1'];
  req.protocol = 'http';
  req.secure = false;
  req.hostname = '127.0.0.1';
  req.user = { ...CONTROL_USER };
  req.files = options.files || null;
  req.file = options.file || null;
  req.get = name => {
    const key = String(name || '').toLowerCase();
    const val = req.headers[key];
    return val === undefined ? undefined : String(val);
  };
  req.header = req.get;
  req.accepts = () => true;
  req.acceptsEncodings = () => true;
  req.is = () => null;
  req.once('close', () => {});
  return attachDb(req);
}

/**
 * 构造委托用的响应对象：捕获 status/json/send，最终 resolve 出结构化结果
 */
function createDelegateResponse() {
  const state = { statusCode: 200, headers: {}, body: null, raw: null };
  const res = new EventEmitter();
  res.statusCode = 200;
  res.writableFinished = false;
  res.headersSent = false;

  const capture = payload => {
    state.body = payload;
    res.emit('delegate:done', state);
  };

  res.status = code => {
    state.statusCode = Number(code) || 200;
    res.statusCode = state.statusCode;
    return res;
  };
  res.json = payload => {
    state.raw = payload;
    capture(payload);
    return res;
  };
  res.send = payload => {
    state.raw = payload;
    if (payload && typeof payload === 'object') state.body = payload;
    else state.body = { raw: payload };
    res.emit('delegate:done', state);
    return res;
  };
  res.end = (chunk) => {
    if (chunk) state.body = typeof chunk === 'string' ? { raw: chunk } : chunk;
    res.emit('delegate:done', state);
    return res;
  };
  res.setHeader = (name, value) => {
    state.headers[String(name).toLowerCase()] = value;
    return res;
  };
  res.getHeader = name => state.headers[String(name).toLowerCase()];
  res.removeHeader = name => {
    delete state.headers[String(name).toLowerCase()];
    return res;
  };
  res.set = res.setHeader;
  res.type = () => res;
  res.contentType = () => res;
  res.attachment = () => res;
  res.download = (filePath, name, cb) => {
    state.body = { download: filePath, name: name || '' };
    if (typeof cb === 'function') cb(null);
    res.emit('delegate:done', state);
    return res;
  };
  res.sendFile = (filePath, options, cb) => {
    state.body = { sendFile: filePath };
    if (typeof options === 'function') options(null);
    else if (typeof cb === 'function') cb(null);
    res.emit('delegate:done', state);
    return res;
  };
  res.redirect = url => {
    state.body = { redirect: url };
    res.emit('delegate:done', state);
    return res;
  };
  res.on = res.on.bind(res);
  return res;
}

/**
 * 委托执行一个控制器方法
 * @param {Function} controllerMethod 形如 (req, res) => Promise
 * @param {Object} options 见 createDelegateRequest
 * @returns {Promise<{statusCode:number, body:*, ok:boolean}>}
 */
function delegate(controllerMethod, options = {}) {
  if (typeof controllerMethod !== 'function') {
    return Promise.resolve({ statusCode: 500, body: null, ok: false, error: 'controller method missing' });
  }
  const req = createDelegateRequest(options);
  const res = createDelegateResponse();

  return new Promise(resolve => {
    let settled = false;
    const finish = state => {
      if (settled) return;
      settled = true;
      const statusCode = state.statusCode;
      const body = state.body;
      // 统一成 { ok, data, error }：剥离 ResponseUtil 的国际化信封，
      // 让脚本拿到的是稳定结构（success/message 仍保留在 raw 里备查）
      const envelope = body && typeof body === 'object' ? body : null;
      const ok = envelope && typeof envelope.success === 'boolean' ? envelope.success : statusCode >= 200 && statusCode < 300;
      resolve({
        statusCode,
        ok,
        data: envelope && 'data' in envelope ? envelope.data : envelope,
        raw: state.raw,
        error: ok ? null : { code: (envelope && envelope.code) || `HTTP_${statusCode}`, message: (envelope && envelope.message) || '' },
      });
    };
    res.on('delegate:done', finish);

    // 兜底超时：被委托的控制器可能挂着 IPC 等待，不能把控制接口的请求挂死
    const timeoutMs = Number(options.timeoutMs) || 30000;
    const timer = setTimeout(() => {
      finish({ statusCode: 504, body: { success: false, code: 'CONTROL_TIMEOUT', message: '委托调用超时' } });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    res.on('delegate:done', () => clearTimeout(timer));

    Promise.resolve()
      .then(() => controllerMethod(req, res))
      .catch(err => {
        finish({
          statusCode: 500,
          body: { success: false, code: 'CONTROL_DELEGATE_ERROR', message: err && err.message ? err.message : String(err) },
        });
      });
  });
}

module.exports = {
  delegate,
  createDelegateRequest,
  createDelegateResponse,
  CONTROL_USER,
};
