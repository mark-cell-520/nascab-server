'use strict';
// express-validator 7.x 的两个坑，都会让客户端的表单错误提示变成中英混杂的乱码：
//
// 1) 默认错误消息是硬编码英文 'Invalid value'（node_modules/express-validator/lib/context.js），
//    而且 .withMessage() 只作用于链上**紧邻的前一个**校验器。于是
//    `query('spaceId').notEmpty().isInt({min:1}).withMessage('validation.ID_INVALID')`
//    在字段缺失时会产生两条错误："Invalid value" 和 "ID必须是大于0的整数"。
//    前者没有点号，getLocalizedMessage 只在 auth/validation/common 下按字面键查找，
//    永远翻不过来，客户端就直接显示英文。
//    全库有 79 处这样的链，逐个补 withMessage 不可靠，统一把默认消息换成带模块前缀的
//    i18n 键，让 handleValidationErrors 正常本地化。
//
// 2) Result.array() 既不去重，也不会在"同一字段已有更具体的消息"时丢掉通用消息。
//    于是一个缺失的 query 参数会让用户看到同一件事讲两遍：
//    "无效的值, ID必须是大于0的整数"。
//    这里做两件事：按 (location, path, msg) 去重；同一字段上若同时有通用消息和
//    自定义消息，只保留自定义的。不同字段的同类错误路径不同，不会被误合并；
//    链上完全没写 withMessage 的字段（只有通用消息）不受影响，照旧展示。
//
// 两个 patch 都只改内存中的对象，不写 node_modules，升级 express-validator 后需回归验证。
const GENERIC_MSG = 'validation.INVALID_VALUE';
let installed = false;

function install() {
  if (installed) return;
  installed = true;

  const { Context } = require('express-validator/lib/context');
  const { Result } = require('express-validator/lib/validation-result');

  const originalAddError = Context.prototype.addError;
  Context.prototype.addError = function patchedAddError(opts) {
    if (!opts || (!opts.message && !this.message)) {
      opts = Object.assign({}, opts, { message: GENERIC_MSG });
    }
    return originalAddError.call(this, opts);
  };

  const originalArray = Result.prototype.array;
  Result.prototype.array = function patchedArray(...args) {
    const arr = originalArray.apply(this, args);
    if (!Array.isArray(arr)) return arr;

    // 只处理有明确字段名的普通 field 错误；alternative / unknown_fields 等没有
    // path，不该被下面的"同字段收敛"逻辑误伤。
    const plain = arr.filter(e => e && typeof e.path === 'string' && e.path !== '');
    if (plain.length !== arr.length) return arr;

    const byPath = new Map();
    for (const e of arr) {
      const key = `${e.location || ''}:${e.path}`;
      if (!byPath.has(key)) byPath.set(key, []);
      byPath.get(key).push(e);
    }

    const seen = new Set();
    const out = [];
    for (const e of arr) {
      const pathKey = `${e.location || ''}:${e.path}`;
      const msg = e.msg || '';
      const dupKey = `${pathKey}|${msg}`;
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);

      // 同一字段上若同时有通用消息和自定义消息，只保留自定义的：
      // "无效的值, ID必须是大于0的整数" 对用户是同一件事讲了两遍。
      // 若该字段只有通用消息（链上没写 withMessage），hasSpecific 为 false，照样保留。
      if (msg === GENERIC_MSG) {
        const siblings = byPath.get(pathKey) || [];
        const hasSpecific = siblings.some(s => (s.msg || '') !== GENERIC_MSG);
        if (hasSpecific && siblings.length > 1) continue;
      }
      out.push(e);
    }

    // 最后按 msg 文本合并：两个字段都缺时，用户看到的是同一句话讲两遍
    // （"ID必须是大于0的整数, ID必须是大于0的整数"）。src/ 下 12 处 .array()
    // 消费方全部只取 error.msg 拼成提示字符串，没有一处用 path/location，
    // 所以按文本合并不丢任何被消费的信息。
    const seenMsg = new Set();
    return out.filter(e => {
      const m = e.msg || '';
      if (seenMsg.has(m)) return false;
      seenMsg.add(m);
      return true;
    });
  };
}

module.exports = { install };
