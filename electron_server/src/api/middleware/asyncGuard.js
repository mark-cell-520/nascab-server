/**
 * Express 4 不会捕获 async 控制器里抛出的 rejection。
 *
 * 一个 `async (req, res) => { throw ... }`（或内部 await 的 promise 被 reject）既不会
 * 同步冒泡，也不会被 try/catch 缺失的调用方接到：Express 的 Route.dispatch 只是
 * `layer.handle_request(err, req, res, next)`，返回值被直接丢掉。结果是
 * `process.on('unhandledRejection')` 之外没有任何人知道出事，而 req/res 永远不会
 * 被回应——客户端只能干等到超时，服务端看起来"功能没反应"而不是"报错"。
 *
 * （`express-async-errors` 解决的是同一个问题，但它要在 400 多处路由注册点之外
 * 再引入一个依赖；这里用等价的 Layer 补丁，改动收敛在文件顶部一次 require。）
 *
 * 做法：包一层 `Layer.prototype.handle_request`，如果被包裹的 fn 返回了 thenable，
 * 就把它的 rejection 转交给 `next`，从而落到 app.js 里已有的错误中间件上。
 * 同步 throw 仍由 Express 原样处理；不返回 promise 的中间件行为完全不变。
 */

'use strict';

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  // eslint-disable-next-line global-require
  const Layer = require('express/lib/router/layer');
  const original = Layer.prototype.handle_request;

  // express 4.x 的签名是 (req, res, next)；fn.length > 3 的不是标准请求处理器
  // （错误处理中间件），由 express 自己 next() 掉，这里原样透传。
  Layer.prototype.handle_request = function patchedHandleRequest(req, res, next) {
    const fn = this.handle;

    if (typeof fn !== 'function' || fn.length > 3) {
      return original.apply(this, arguments);
    }

    let result;
    try {
      result = fn(req, res, next);
    } catch (e) {
      return next(e);
    }

    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(next);
    }
    // 返回 undefined 的普通中间件/控制器：什么都不做，与原来一致
  };
}

module.exports = { install };
