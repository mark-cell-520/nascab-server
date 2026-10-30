const i18n = require('i18n');
const path = require('path');
const tableConfig = require('../db/table/tableConfig');
const config = require('../config/config');
// 配置 i18n
const languagePath = path.join(config.getRootPath(), 'language');
console.log('languagePath', languagePath);
i18n.configure({
  locales: ['zh-CN', 'en-US', 'es-ES', 'ar-SA', 'th-TH', 'de-DE', 'ja-JP', 'pt-BR', 'ru-RU', 'ko-KR', 'id-ID', 'vi-VN', 'fr-FR'],
  directory: languagePath,
  defaultLocale: 'zh-CN',
  cookie: 'locale',
  autoReload: false,
  updateFiles: false,
  objectNotation: true,
  // 关键：i18n 默认对"某语言文件里缺这个键"的处理是原样返回键名，客户端就会把
  // "messages.file.NO_FILE_SELECTED" 当错误提示展示。13 个语言文件的键从来不是同步补齐的，
  // 之前 437 个模块化键里有 103 个在全部语言里都缺失。retryInDefaultLocale 让缺失的键
  // 回退到 defaultLocale（zh-CN，已补齐）取值；updateFiles=false 时 write() 直接 return，
  // 所以不会把回退值写进语言文件。
  // 注意不要用 fallbacks 解决这个问题：i18n 的 getFallback 只在 !locales[locale]
  // （整个语言文件不存在）时才触发，13 个文件都在，fallbacks 对缺键完全无效。
  retryInDefaultLocale: true,
});

let cachedServerUiLanguage = null;
let cachedServerUiLanguageAt = 0;
let refreshingServerUiLanguage = false;

function normalizeUiLanguage(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (
    v === 'zh-CN' ||
    v === 'en-US' ||
    v === 'es-ES' ||
    v === 'ar-SA' ||
    v === 'th-TH' ||
    v === 'de-DE' ||
    v === 'ja-JP' ||
    v === 'pt-BR' ||
    v === 'ru-RU' ||
    v === 'ko-KR' ||
    v === 'vi-VN' ||
    v === 'id-ID' ||
    v === 'fr-FR'
  )
    return v;
  if (v.toLowerCase().startsWith('zh')) return 'zh-CN';
  if (v.toLowerCase().startsWith('en')) return 'en-US';
  if (v.toLowerCase().startsWith('es')) return 'es-ES';
  if (v.toLowerCase().startsWith('ar')) return 'ar-SA';
  if (v.toLowerCase().startsWith('th')) return 'th-TH';
  if (v.toLowerCase().startsWith('de')) return 'de-DE';
  if (v.toLowerCase().startsWith('ja')) return 'ja-JP';
  if (v.toLowerCase().startsWith('pt')) return 'pt-BR';
  if (v.toLowerCase().startsWith('ru')) return 'ru-RU';
  if (v.toLowerCase().startsWith('ko')) return 'ko-KR';
  if (v.toLowerCase().startsWith('vi')) return 'vi-VN';
  if (v.toLowerCase().startsWith('id')) return 'id-ID';
  if (v.toLowerCase().startsWith('fr')) return 'fr-FR';
  return null;
}

async function refreshServerUiLanguageCache() {
  if (refreshingServerUiLanguage) return;
  refreshingServerUiLanguage = true;
  try {
    const val = await tableConfig.getConfigByKey(tableConfig.KEY_SERVER_UI_LANGUAGE);
    const loc = normalizeUiLanguage(val) || 'zh-CN';
    cachedServerUiLanguage = loc;
    cachedServerUiLanguageAt = Date.now();
  } catch {
  } finally {
    refreshingServerUiLanguage = false;
  }
}

/**
 * 从数据库读取当前「服务器界面语言」（写入 DB 的文案等应使用此函数，避免仅用内存缓存导致语言滞后）。
 */
async function resolveServerUiLanguageFromDb() {
  try {
    const val = await tableConfig.getConfigByKey(tableConfig.KEY_SERVER_UI_LANGUAGE);
    const loc = normalizeUiLanguage(val) || 'zh-CN';
    cachedServerUiLanguage = loc;
    cachedServerUiLanguageAt = Date.now();
    return loc;
  } catch {
    return cachedServerUiLanguage || 'zh-CN';
  }
}

function getServerUiLanguageFallback() {
  const now = Date.now();
  if (!cachedServerUiLanguage || now - cachedServerUiLanguageAt > 60_000) {
    void refreshServerUiLanguageCache();
  }
  return cachedServerUiLanguage || 'zh-CN';
}

/**
 * 根据语言代码获取翻译
 * @param {string} key - 翻译键
 * @param {string} locale - 语言代码
 * @returns {string} 翻译后的文本
 */
function getTranslation(key, locale = 'zh-CN', args = []) {
  const oldLocale = i18n.getLocale();
  i18n.setLocale(locale);
  const translation = Array.isArray(args) && args.length > 0 ? i18n.__.apply(i18n, [key, ...args]) : i18n.__(key);
  i18n.setLocale(oldLocale);
  return translation;
}

/**
 * 初始化i18n中间件
 * @returns {Function} i18n中间件
 */
function initI18nMiddleware() {
  return i18n.init;
}

/**
 * 从请求中获取用户语言设置
 * @param {Object} req - Express请求对象
 * @returns {string} 语言代码
 */
function getUserLanguage(req) {
  // 最后从请求头中获取
  const acceptLanguage = req.headers['accept-language'];
  if (acceptLanguage) {
    const languages = acceptLanguage.split(',');
    const primaryLanguage = languages[0].split('-')[0].toLowerCase();
    if (primaryLanguage === 'en') return 'en-US';
    if (primaryLanguage === 'es') return 'es-ES';
    if (primaryLanguage === 'ar') return 'ar-SA';
    if (primaryLanguage === 'th') return 'th-TH';
    if (primaryLanguage === 'zh') return 'zh-CN';
    if (primaryLanguage === 'de') return 'de-DE';
    if (primaryLanguage === 'ja') return 'ja-JP';
    if (primaryLanguage === 'pt') return 'pt-BR';
    if (primaryLanguage === 'ru') return 'ru-RU';
    if (primaryLanguage === 'ko') return 'ko-KR';
    if (primaryLanguage === 'id') return 'id-ID';
    if (primaryLanguage === 'vi') return 'vi-VN';
    if (primaryLanguage === 'fr') return 'fr-FR';
    return 'zh-CN';
  }
  // 其次从 cookie 中获取
  if (req.cookies && req.cookies.locale) {
    return req.cookies.locale;
  }
  return getServerUiLanguageFallback();
}

/**
 * 设置响应语言
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 */
function setResponseLanguage(req, res) {
  const userLanguage = getUserLanguage(req);
  i18n.setLocale(userLanguage);
  res.setLocale(userLanguage);
}

// 上游服务把状态原文拼在 i18n 键后面抛出来，形如
//   `openlistMount.STORAGE_INIT_FAILED:empty token returned from official API, ...`
//   `file.DIRECTORY_LIST_WORKER_EXITED:1`
// 整串当键去查必然落空（messages.openlistMount.STORAGE_INIT_FAILED:empty token...
// 这个键不存在），用户就直接看到英文。按第一个冒号拆开：只翻译前面的键，
// 原文作为 %s 插值参数交给语言文件（语言文件里对应条目须写成 "xxx：%s"）。
const KEY_WITH_DETAIL = /^([a-z][a-zA-Z0-9]*\.[A-Z][A-Z0-9_]+):([\s\S]*)$/;

/**
 * 获取本地化消息
 * @param {Object} req - Express请求对象
 * @param {string} key - 消息键（支持模块化格式，如 'auth.SUPER_ADMIN_EXISTS' 或直接键名）
 * @returns {string} 本地化消息
 */
function getLocalizedMessage(req, key, args = []) {
  const userLanguage = getUserLanguage(req);
  const raw = key === null || key === undefined ? '' : String(key);

  const withDetail = KEY_WITH_DETAIL.exec(raw);
  if (withDetail) {
    const prefix = withDetail[1];
    const detail = withDetail[2];
    const list = Array.isArray(args) && args.length > 0 ? args : [detail];
    const translated = getTranslation(`messages.${prefix}`, userLanguage, list);
    // 翻译命中才采用；miss 时退回整串，保持原有行为（不至于把错误信息吞掉）
    if (translated && translated !== `messages.${prefix}`) return translated;
  }

  // 如果key包含点号，说明是模块化格式（如 'auth.SUPER_ADMIN_EXISTS'）
  if (raw.includes('.')) {
    return getTranslation(`messages.${raw}`, userLanguage, args);
  }

  // 否则，尝试在常见模块中查找
  const modules = ['auth', 'validation', 'common'];
  for (const module of modules) {
    const translation = getTranslation(`messages.${module}.${raw}`, userLanguage, args);
    if (translation && translation !== `messages.${module}.${raw}`) {
      return translation;
    }
  }

  // 如果没找到，返回原始key
  return raw;
}

refreshServerUiLanguageCache();

module.exports = {
  i18n,
  getTranslation,
  initI18nMiddleware,
  getUserLanguage,
  setResponseLanguage,
  getLocalizedMessage,
  getServerUiLanguageFallback,
  resolveServerUiLanguageFromDb,
  refreshServerUiLanguageCache,
};
