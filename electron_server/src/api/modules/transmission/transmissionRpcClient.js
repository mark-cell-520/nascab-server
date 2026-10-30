const axios = require('axios');
const Logger = require('../../../utils/logger');
const {
  loadConfig,
  decryptRpcPassword,
  getRpcUsername,
  toPortNumber,
} = require('../../../workers/transmission/transmissionConfig');

function buildRpcConnection(cfg) {
  const configObj = cfg || {};
  const port =
    toPortNumber(configObj.rpc_port) ||
    toPortNumber(configObj.actual_rpc_port) ||
    52019;
  return {
    url: `http://127.0.0.1:${port}/transmission/rpc`,
    username: getRpcUsername(configObj),
    password: decryptRpcPassword(configObj.rpc_password),
    cfg: configObj,
  };
}

async function postTransmissionRpc(conn, method, args, sessionId = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) {
    headers['X-Transmission-Session-Id'] = sessionId;
  }

  const res = await axios.post(
    conn.url,
    { method, arguments: args || {} },
    {
      auth: { username: conn.username, password: conn.password },
      headers,
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  if (res.status === 409) {
    const nextSessionId =
      (res.headers &&
        (res.headers['x-transmission-session-id'] || res.headers['X-Transmission-Session-Id'])) ||
      '';
    return {
      status: res.status,
      sessionId: String(nextSessionId || ''),
      needsSessionRetry: !!nextSessionId,
      body: res.data || {},
    };
  }

  return {
    status: res.status,
    sessionId,
    needsSessionRetry: false,
    body: res.data || {},
  };
}

function assertRpcSuccess(result, method) {
  const { status, body } = result;
  if (status === 503 || status === 502 || status === 0) {
    const err = new Error('transmission.SERVICE_UNAVAILABLE');
    err.statusCode = 503;
    throw err;
  }
  if (status !== 200 || (body.result && body.result !== 'success')) {
    // body.result 是 transmission 的原话（如 "no fields specified"、"invalid ids"），
    // 直接当 Error message 会让前端把一句没头没尾的英文亮给用户。按 `键:原文` 抛出，
    // i18nUtil 会拆开翻译前面的键、把原文作为 %s 插值。
    const raw = typeof body.result === 'string' && body.result.trim() ? body.result.trim() : `rpc_error_${status}`;
    const err = new Error(`transmission.RPC_ERROR:${raw}`);
    err.statusCode = 502;
    err.details = body;
    Logger.warn('[transmissionRpcClient] RPC failed', { method, status, result: body.result });
    throw err;
  }
  return body.arguments || {};
}

async function callTransmissionRpc(cfg, method, args = {}) {
  const configObj = cfg || (await loadConfig());
  const conn = buildRpcConnection(configObj);
  let sessionId = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await postTransmissionRpc(conn, method, args, sessionId);
    if (result.needsSessionRetry && attempt === 0) {
      sessionId = result.sessionId;
      continue;
    }
    return assertRpcSuccess(result, method);
  }
  // 两次都拿到需要重试的 session id 才走到这里：把原文换成 i18n 键，
  // 否则 "rpc_session_failed" 会原样显示给用户。
  throw new Error('transmission.RPC_ERROR:rpc session handshake failed');
}

class TransmissionRpcClient {
  constructor() {
    this.sessionId = '';
    this._callChain = Promise.resolve();
  }

  async call(method, args = {}, retryOnSession = true) {
    const run = this._callChain.then(() => this._callOnce(method, args, retryOnSession));
    this._callChain = run.catch(() => {});
    return run;
  }

  async _callOnce(method, args = {}, retryOnSession = true) {
    const conn = buildRpcConnection(await loadConfig());
    const result = await postTransmissionRpc(conn, method, args, this.sessionId);
    if (result.needsSessionRetry && retryOnSession && result.sessionId) {
      this.sessionId = result.sessionId;
      return this._callOnce(method, args, false);
    }
    return assertRpcSuccess(result, method);
  }
}

module.exports = { TransmissionRpcClient, callTransmissionRpc, buildRpcConnection };
