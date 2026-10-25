'use strict';
/**
 * 部署配置层（服务器部署改造）
 *
 * 设计目标：让 NasCabOS 服务端可以脱离桌面环境，在裸机 / Docker / systemd / Windows 服务下运行，
 * 并且「同一份代码适配各种环境」——所有环境差异都通过配置注入，而不是改代码。
 *
 * 取值优先级（后者覆盖前者）：
 *   1. 内置默认值 DEFAULTS
 *   2. 配置文件 config.json（按搜索顺序，后加载的覆盖先加载的）
 *   3. 环境变量（最高优先，符合 12-factor 原则）
 *
 * 配置文件搜索顺序：
 *   1. 环境变量 NASCAB_CONFIG 显式指定的路径
 *   2. <应用根目录>/config.json
 *   3. <当前工作目录>/config.json
 *   4. <用户数据目录>/config.json（惰性加载，见 loadUserDataConfig）
 *
 * 说明：本模块不依赖 config.js，避免循环引用；config.js 在求值 userData 后再调用
 * loadUserDataConfig() 完成最后一级加载。
 */

const fs = require('fs');
const path = require('path');

/** 内置默认值：与改造前的行为保持一致，保证桌面端零感知 */
const DEFAULTS = {
  server: {
    // 监听地址：0.0.0.0 监听所有网卡；127.0.0.1 仅本机（配合反向代理时使用）
    host: '0.0.0.0',
    // HTTP 端口，与改造前 config.app.port 默认值一致
    port: 6789,
    // HTTPS 端口，与改造前 config.app.httpsPort 默认值一致
    httpsPort: 6799,
    // 是否启用 HTTPS。反代场景下可关闭，避免再维护一套证书
    httpsEnabled: true,
    // 端口被占用时是否自动 +1 寻找下一个端口。
    // 桌面端历史行为为 true；服务器部署建议 false（端口漂移会让运维找不到服务）
    portFallback: true,
    // 是否运行在反向代理之后：为 true 时信任 X-Forwarded-* 头
    behindProxy: false,
  },
  data: {
    // 用户数据目录（数据库、缓存、证书、日志）。为空则按原有逻辑推导
    dir: '',
  },
  libs: {
    // 外部二进制（ffmpeg/ffprobe/rclone/sftpgo/transmission/openlist）根目录。
    // 为空则使用 <应用根目录>/libs。服务器上可指向 /opt/nascab/libs 等独立位置
    dir: '',
  },
  onnx: {
    // ONNX 模型目录，为空则按原有逻辑推导
    dir: '',
  },
  logging: {
    // 日志级别：error/warn/info/http/verbose/debug/silly
    level: '',
    // 日志目录，为空则使用 <应用根目录>/logs
    dir: '',
    // 是否写日志文件
    file: true,
    // 是否记录 HTTP 访问日志（默认关闭，与改造前一致）
    accessLog: false,
    rotate: {
      // 单文件大小上限（字节），默认 20MB
      maxSize: 20 * 1024 * 1024,
      // 保留的轮转文件数，默认 10
      maxFiles: 10,
    },
  },
  security: {
    // CORS 允许的源。空数组 = 仅同源 + 本机回环 + file://（桌面客户端默认可用）；
    // ['*'] = 反射任意 Origin（改造前的宽松行为，不推荐）
    corsOrigins: [],
    // JWT 密钥。为空则沿用「数据库配置或 JWT_SECRET 环境变量」的原有逻辑
    jwtSecret: '',
  },
  worker: {
    // worker 进程崩溃后是否自动重启
    autoRestart: true,
    // 单个 worker 的最大自动重启次数（指数退避，达到上限后放弃并告警）
    maxRestarts: 10,
  },
  console: {
    // 是否启用 Web 控制台（/）。关闭后只保留 API 与 /healthz 等探针，
    // 适合纯 API 部署或由外部系统接管的场景
    enabled: true,
    // 控制台显示的产品名（登录页与顶栏）
    title: 'NasCabOS',
    // 控制台静态资源目录，为空则使用 <应用根目录>/web/console
    dir: '',
  },
  control: {
    // 机器控制接口（/api/control）开关。
    // 面向脚本 / AI Agent / 自动化：一个令牌换全部管理能力，无需登录拿 JWT。
    // 关闭后控制接口与控制端口都不再监听
    enabled: true,
    // 控制接口独立监听地址。默认只绑本机回环——控制令牌等价于管理员 root，
    // 暴露到局域网前应先想清楚，或交给反向代理做 TLS + IP 白名单
    host: '127.0.0.1',
    // 控制接口独立端口。0 表示不单独监听，只通过主端口的 /api/control 访问
    port: 6792,
    // 控制令牌。为空则首次启动自动生成并写入 <数据目录>/control.json，
    // 重启后复用同一个（避免配了客户端又失效）
    token: '',
  },
};

/** 布尔型环境变量真值 */
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
/** 布尔型环境变量假值 */
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return fallback;
}

function parseIntSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseCsv(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

/** 深合并，忽略以 _ 开头的键（便于在配置文件中写注释） */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    if (key.startsWith('_')) continue;
    const val = source[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], val);
    } else if (val !== undefined) {
      target[key] = val;
    }
  }
  return target;
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[deployConfig] 配置文件格式错误（应为 JSON 对象）: ${filePath}`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(`[deployConfig] 读取配置文件失败 ${filePath}: ${err && err.message}`);
    return null;
  }
}

class DeployConfig {
  constructor() {
    /** 合并后的文件配置 */
    this._fileConfig = {};
    /** 已加载的配置文件路径，用于启动日志 */
    this.loadedFiles = [];
    /** userData/config.json 是否已加载 */
    this._userDataLoaded = false;

    this._loadFixedPaths();
  }

  /** 加载不依赖 userData 的配置文件 */
  _loadFixedPaths() {
    const candidates = [];

    // 1. 显式指定
    const explicit = process.env.NASCAB_CONFIG;
    if (explicit) candidates.push(path.resolve(explicit));

    // 2. 应用根目录：由调用方在 config.js 就绪后补充，这里先用 cwd 兜底
    candidates.push(path.join(process.cwd(), 'config.json'));

    for (const p of candidates) {
      const parsed = readJsonFile(p);
      if (parsed) {
        deepMerge(this._fileConfig, parsed);
        this.loadedFiles.push(p);
      }
    }
  }

  /**
   * 加载应用根目录下的配置文件（由 config.js 在 getRootPath() 就绪后调用）
   * @param {string} rootPath 应用根目录
   */
  loadRootConfig(rootPath) {
    if (!rootPath) return;
    const p = path.join(rootPath, 'config.json');
    const parsed = readJsonFile(p);
    if (parsed) {
      deepMerge(this._fileConfig, parsed);
      this.loadedFiles.push(p);
    }
  }

  /**
   * 加载用户数据目录下的配置文件（惰性，由 config.js 在 userData 解析完成后调用）
   * 注意：此处的 data.dir 不生效——数据目录本身由它推导，改了会造成循环依赖
   * @param {string} userDataPath 用户数据目录
   */
  loadUserDataConfig(userDataPath) {
    if (this._userDataLoaded || !userDataPath) return;
    this._userDataLoaded = true;
    const p = path.join(userDataPath, 'config.json');
    const parsed = readJsonFile(p);
    if (parsed) {
      if (parsed.data && parsed.data.dir) {
        console.warn(
          '[deployConfig] userData/config.json 中的 data.dir 不生效（数据目录由其自身推导），请改用 NASCAB_DATA_DIR 或根目录 config.json'
        );
      }
      deepMerge(this._fileConfig, parsed);
      this.loadedFiles.push(p);
    }
  }

  /** 按点分路径取文件配置值 */
  _fileGet(dotted) {
    const parts = dotted.split('.');
    let cur = this._fileConfig;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return cur;
  }

  /**
   * 判断某个配置项是否被「显式」指定过（环境变量或配置文件）
   * 用于需要区分「运维显式指定」与「内置默认」的场景，
   * 例如端口：显式指定时应压过数据库里持久化的旧值
   * @param {string} dotted 点分配置路径
   * @param {string} envName 对应的环境变量名
   */
  isExplicit(dotted, envName) {
    if (envName && process.env[envName] !== undefined && process.env[envName] !== '') return true;
    const v = this._fileGet(dotted);
    return v !== undefined && v !== null && v !== '';
  }

  /**
   * 统一取值：默认值 < 配置文件 < 环境变量
   * @param {string} dotted 点分配置路径，如 'server.port'
   * @param {*} fallback 默认值
   * @param {string} envName 覆盖用的环境变量名
   */
  get(dotted, fallback, envName) {
    let value = fallback;
    const fileValue = this._fileGet(dotted);
    if (fileValue !== undefined && fileValue !== null && fileValue !== '') {
      value = fileValue;
    }
    if (envName && process.env[envName] !== undefined && process.env[envName] !== '') {
      value = process.env[envName];
    }
    return value;
  }

  /** 服务器监听与网络相关配置 */
  get server() {
    const httpsEnabled = parseBool(this.get('server.httpsEnabled', DEFAULTS.server.httpsEnabled, 'NASCAB_HTTPS_ENABLED'), true);
    return {
      host: String(this.get('server.host', DEFAULTS.server.host, 'NASCAB_HOST') || DEFAULTS.server.host),
      port: parseIntSafe(this.get('server.port', DEFAULTS.server.port, 'PORT'), DEFAULTS.server.port),
      httpsPort: parseIntSafe(this.get('server.httpsPort', DEFAULTS.server.httpsPort, 'HTTPS_PORT'), DEFAULTS.server.httpsPort),
      httpsEnabled,
      portFallback: parseBool(this.get('server.portFallback', DEFAULTS.server.portFallback, 'NASCAB_PORT_FALLBACK'), DEFAULTS.server.portFallback),
      behindProxy: parseBool(this.get('server.behindProxy', DEFAULTS.server.behindProxy, 'NASCAB_BEHIND_PROXY'), DEFAULTS.server.behindProxy),
    };
  }

  /** 数据目录配置 */
  get data() {
    return {
      dir: String(this.get('data.dir', DEFAULTS.data.dir, 'NASCAB_DATA_DIR') || ''),
    };
  }

  /** 外部二进制 libs 根目录 */
  get libs() {
    return {
      dir: String(this.get('libs.dir', DEFAULTS.libs.dir, 'NASCAB_LIBS_DIR') || ''),
    };
  }

  /** ONNX 模型目录 */
  get onnx() {
    return {
      dir: String(this.get('onnx.dir', DEFAULTS.onnx.dir, 'NASCAB_ONNX_DIR') || ''),
    };
  }

  /** 日志配置 */
  get logging() {
    const maxSize = parseIntSafe(this.get('logging.rotate.maxSize', DEFAULTS.logging.rotate.maxSize, 'NASCAB_LOG_MAX_SIZE'), DEFAULTS.logging.rotate.maxSize);
    const maxFiles = parseIntSafe(this.get('logging.rotate.maxFiles', DEFAULTS.logging.rotate.maxFiles, 'NASCAB_LOG_MAX_FILES'), DEFAULTS.logging.rotate.maxFiles);
    return {
      level: String(this.get('logging.level', DEFAULTS.logging.level, 'LOG_LEVEL') || ''),
      dir: String(this.get('logging.dir', DEFAULTS.logging.dir, 'NASCAB_LOG_DIR') || ''),
      file: parseBool(this.get('logging.file', DEFAULTS.logging.file, 'NASCAB_LOG_FILE'), DEFAULTS.logging.file),
      accessLog: parseBool(this.get('logging.accessLog', DEFAULTS.logging.accessLog, 'NASCAB_ACCESS_LOG'), DEFAULTS.logging.accessLog),
      rotate: { maxSize, maxFiles },
    };
  }

  /** 安全相关配置 */
  get security() {
    return {
      corsOrigins: parseCsv(this.get('security.corsOrigins', DEFAULTS.security.corsOrigins, 'NASCAB_CORS_ORIGINS')),
      jwtSecret: String(this.get('security.jwtSecret', DEFAULTS.security.jwtSecret, 'JWT_SECRET') || ''),
    };
  }

  /** worker 监管配置 */
  get worker() {
    return {
      autoRestart: parseBool(this.get('worker.autoRestart', DEFAULTS.worker.autoRestart, 'NASCAB_WORKER_AUTO_RESTART'), DEFAULTS.worker.autoRestart),
      maxRestarts: parseIntSafe(this.get('worker.maxRestarts', DEFAULTS.worker.maxRestarts, 'NASCAB_WORKER_MAX_RESTARTS'), DEFAULTS.worker.maxRestarts),
    };
  }

  /** Web 控制台配置 */
  get console() {
    return {
      enabled: parseBool(this.get('console.enabled', DEFAULTS.console.enabled, 'NASCAB_CONSOLE_ENABLED'), DEFAULTS.console.enabled),
      title: String(this.get('console.title', DEFAULTS.console.title, 'NASCAB_CONSOLE_TITLE') || DEFAULTS.console.title),
      dir: String(this.get('console.dir', DEFAULTS.console.dir, 'NASCAB_CONSOLE_DIR') || ''),
    };
  }

  /** 机器控制接口（/api/control）配置 */
  get control() {
    return {
      enabled: parseBool(this.get('control.enabled', DEFAULTS.control.enabled, 'NASCAB_CONTROL_ENABLED'), DEFAULTS.control.enabled),
      host: String(this.get('control.host', DEFAULTS.control.host, 'NASCAB_CONTROL_HOST') || DEFAULTS.control.host),
      port: parseIntSafe(this.get('control.port', DEFAULTS.control.port, 'NASCAB_CONTROL_PORT'), DEFAULTS.control.port),
      token: String(this.get('control.token', DEFAULTS.control.token, 'NASCAB_CONTROL_TOKEN') || ''),
    };
  }
}

const instance = new DeployConfig();

module.exports = instance;
module.exports.DEFAULTS = DEFAULTS;
module.exports.DeployConfig = DeployConfig;
module.exports.deepMerge = deepMerge;
