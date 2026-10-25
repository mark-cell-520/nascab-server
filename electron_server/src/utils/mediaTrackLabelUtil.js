'use strict';
/**
 * 音轨 / 字幕轨的标签与能力判定
 *
 * 为什么需要这一层：播放器要让用户选音轨、选字幕，而 ffprobe 给的是
 * `tags.language`（ISO 639-2/B，如 chi / eng / jpn）、`codec_name`（如
 * ac3 / subrip / hdmv_pgs_subtitle）和 `channels` 这些机器值。直接把
 * "chi" 或 "hdmv_pgs_subtitle" 摆给用户看等于没做。
 *
 * 同时这里也是「这条字幕浏览器能不能直接渲染」的唯一判据：
 * 文本字幕可以转成 WebVTT 走 <track>，图像字幕（PGS / VOBSUB）转不出来，
 * 只能在菜单里禁用并说明原因，不能给一个选了没反应的死选项。
 */

/** ISO 639-2/B（含常见误写与简体别名）→ 中文名 */
const LANGUAGE_NAMES = {
  chi: '国语', zho: '国语', cmn: '国语', 'zh-cn': '国语', 'zh-tw': '国语',
  zh: '国语', chinese: '国语', mandarin: '国语', cantonese: '粤语', yue: '粤语',
  eng: '英语', en: '英语', english: '英语',
  jpn: '日语', ja: '日语', japanese: '日语',
  kor: '韩语', ko: '韩语', korean: '韩语',
  fre: '法语', fra: '法语', fr: '法语', french: '法语',
  ger: '德语', deu: '德语', de: '德语', german: '德语',
  spa: '西班牙语', es: '西班牙语', spanish: '西班牙语',
  rus: '俄语', ru: '俄语', russian: '俄语',
  ita: '意大利语', it: '意大利语', italian: '意大利语',
  por: '葡萄牙语', pt: '葡萄牙语', portuguese: '葡萄牙语',
  tha: '泰语', th: '泰语', thai: '泰语',
  vie: '越南语', vi: '越南语', vietnamese: '越南语',
  ara: '阿拉伯语', ar: '阿拉伯语', arabic: '阿拉伯语',
  hin: '印地语', hi: '印地语', hindi: '印地语',
  ind: '印尼语', id: '印尼语', indonesian: '印尼语',
  may: '马来语', ms: '马来语', malay: '马来语',
  tur: '土耳其语', tr: '土耳其语', turkish: '土耳其语',
  pol: '波兰语', pl: '波兰语', polish: '波兰语',
  dut: '荷兰语', nld: '荷兰语', nl: '荷兰语', dutch: '荷兰语',
  swe: '瑞典语', sv: '瑞典语', swedish: '瑞典语',
  nor: '挪威语', no: '挪威语', norwegian: '挪威语',
  dan: '丹麦语', da: '丹麦语', danish: '丹麦语',
  fin: '芬兰语', fi: '芬兰语', finnish: '芬兰语',
  gre: '希腊语', ell: '希腊语', el: '希腊语', greek: '希腊语',
  heb: '希伯来语', he: '希伯来语', hebrew: '希伯来语',
  hun: '匈牙利语', hu: '匈牙利语', hungarian: '匈牙利语',
  cze: '捷克语', ces: '捷克语', cs: '捷克语', czech: '捷克语',
  rom: '罗马尼亚语', ro: '罗马尼亚语', romanian: '罗马尼亚语',
  ukr: '乌克兰语', uk: '乌克兰语', ukrainian: '乌克兰语',
  und: '', unknown: '', '': '',
};

/** 字幕编码 → 中文名 */
const SUBTITLE_CODEC_NAMES = {
  subrip: 'SRT',
  srt: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  vtt: 'WebVTT',
  mov_text: 'MP4 内嵌字幕',
  tx3g: 'MP4 内嵌字幕',
  text: '文本字幕',
  ssa_ass: 'ASS',
  jacosub: 'JACOsub',
  microdvd: 'MicroDVD',
  mpl2: 'MPL2',
  pjs: 'PJS',
  realtext: 'RealText',
  stl: 'EBU STL',
  subviewer: 'SubViewer',
  vplayer: 'VPlayer',
  hdmv_pgs_subtitle: 'PGS 图像字幕',
  pgssub: 'PGS 图像字幕',
  dvd_subtitle: 'VOBSUB 图像字幕',
  dvdsub: 'VOBSUB 图像字幕',
  vobsub: 'VOBSUB 图像字幕',
  dvb_subtitle: 'DVB 图文字幕',
  dvbsub: 'DVB 图文字幕',
  xsub: 'XSUB 图像字幕',
  eia_608: 'EIA-608',
};

/** 音频编码 → 中文名（只列常见几种，其余原样大写返回） */
const AUDIO_CODEC_NAMES = {
  aac: 'AAC',
  mp3: 'MP3',
  ac3: 'AC3',
  eac3: 'E-AC3',
  dts: 'DTS',
  dtshd: 'DTS-HD',
  truehd: 'TrueHD',
  flac: 'FLAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  wmav2: 'WMA',
  cook: 'Cook',
  mlp: 'MLP',
  als: 'MPEG-4 ALS',
};

/** 能转成 WebVTT 的文本字幕编码（浏览器可经 <track> 直接渲染） */
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'webvtt', 'vtt', 'mov_text', 'tx3g',
  'text', 'jacosub', 'microdvd', 'mpl2', 'pjs', 'realtext', 'stl',
  'subviewer', 'vplayer',
]);

/** 图像字幕：必须烧进画面，浏览器拿不到文本 */
const BITMAP_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub', 'vobsub',
  'dvb_subtitle', 'dvbsub', 'xsub',
]);

/** 外挂字幕扩展名 → 判据用（与服务端 videoPlayerService 的清单保持一致） */
const EXTERNAL_SUBTITLE_EXTS = new Set(['.srt', '.ass', '.vtt', '.mks', '.sub', '.ssa']);

function _norm(v) {
  return String(v == null ? '' : v).trim();
}

function _lower(v) {
  return _norm(v).toLowerCase();
}

/** ffprobe 的 tags.language 可能是 "chi" / "zh-CN" / "und" / "" */
function languageLabel(code) {
  const raw = _lower(code);
  if (!raw) return '';
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, raw)) {
    return LANGUAGE_NAMES[raw];
  }
  // 未收录的：取前 3 位小写原样返回，别显示成空白
  const head = raw.split(/[-_]/)[0];
  if (head && Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, head)) {
    return LANGUAGE_NAMES[head];
  }
  return head ? head.toUpperCase() : '';
}

function subtitleCodecLabel(codec) {
  const key = _lower(codec);
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(SUBTITLE_CODEC_NAMES, key)) {
    return SUBTITLE_CODEC_NAMES[key];
  }
  return key.toUpperCase();
}

function audioCodecLabel(codec) {
  const key = _lower(codec);
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(AUDIO_CODEC_NAMES, key)) {
    return AUDIO_CODEC_NAMES[key];
  }
  return key.toUpperCase();
}

/** 文本字幕才能转 WebVTT 走 <track>；图像字幕只能烧录 */
function isTextSubtitleCodec(codec) {
  return TEXT_SUBTITLE_CODECS.has(_lower(codec));
}

function isBitmapSubtitleCodec(codec) {
  return BITMAP_SUBTITLE_CODECS.has(_lower(codec));
}

/** 声道数 → 人类语言。2=立体声，6=5.1，8=7.1 */
function channelLabel(channels) {
  const n = Math.floor(Number(channels) || 0);
  if (n <= 0) return '';
  if (n === 1) return '单声道';
  if (n === 2) return '立体声';
  if (n === 6) return '5.1';
  if (n === 7) return '6.1';
  if (n === 8) return '7.1';
  return `${n} 声道`;
}

/**
 * 音轨展示名：语言 · 编码 声道数
 * 例：「国语 · AC3 5.1」「导演评论音轨」这类信息在 tags.title 里，优先拼上。
 */
function audioTrackLabel(stream, ordinal) {
  const tags = (stream && stream.tags) || {};
  const lang = languageLabel(tags.language);
  const title = _norm(tags.title);
  const codec = audioCodecLabel(stream && stream.codec_name);
  const ch = channelLabel(stream && stream.channels);
  const parts = [];
  if (title) parts.push(title);
  else if (lang) parts.push(lang);
  const tech = [codec, ch].filter(Boolean).join(' ');
  if (tech) parts.push(tech);
  if (!parts.length) parts.push(`音轨 ${(Number(ordinal) || 0) + 1}`);
  return parts.join(' · ');
}

/**
 * 字幕轨展示名：语言 · 编码
 * @param {object} stream ffprobe 流
 * @param {number} ordinal 在字幕流中的序号（从 0 开始），仅用于无任何元数据时兜底
 */
function subtitleTrackLabel(stream, ordinal) {
  const tags = (stream && stream.tags) || {};
  const lang = languageLabel(tags.language);
  const title = _norm(tags.title);
  const codec = subtitleCodecLabel(stream && stream.codec_name);
  const forced = /forced|强制/i.test(`${title} ${_norm(tags.handler_name)}`);
  const parts = [];
  // 既没有标题也没有语言时补一个序号，否则同一文件里几条字幕会长得一模一样，
  // 用户在菜单里根本分不出该点哪一条
  if (!title && !lang) parts.push(`字幕 ${(Number(ordinal) || 0) + 1}`);
  if (title) parts.push(title);
  else if (lang) parts.push(lang);
  if (codec) parts.push(codec);
  if (forced) parts.push('强制');
  if (!parts.length) parts.push(`字幕 ${(Number(ordinal) || 0) + 1}`);
  return parts.join(' · ');
}

/** 外挂字幕展示名：文件名 + 来源说明 */
function externalSubtitleLabel(filename, source) {
  const name = _norm(filename) || '外挂字幕';
  const from = _lower(source) === 'uploaded' ? '上传' : '同目录';
  return `${name}（${from}）`;
}

/** 判断一个文件名是不是外挂字幕 */
function isExternalSubtitleFile(name) {
  const ext = _lower(name).match(/(\.[a-z0-9]+)$/);
  return !!(ext && EXTERNAL_SUBTITLE_EXTS.has(ext[1]));
}

/**
 * 倍速取值表。不放宽到任意值：播放器只有一个下拉框，
 * 而服务端要把偏好落库，白名单之外的脏值必须在入口就挡掉。
 */
const PLAYBACK_RATES = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2', '3'];

function normalizePlaybackRate(input) {
  if (input === undefined || input === null) return null;
  const raw = String(input).trim().toLowerCase().replace(/x$/, '');
  if (!raw) return null;
  const hit = PLAYBACK_RATES.find(r => r === raw);
  if (hit) return hit;
  // 1.50 / 1.0 之类：数值相等也认
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  const near = PLAYBACK_RATES.find(r => Math.abs(Number(r) - num) < 1e-9);
  return near || null;
}

module.exports = {
  LANGUAGE_NAMES,
  SUBTITLE_CODEC_NAMES,
  AUDIO_CODEC_NAMES,
  TEXT_SUBTITLE_CODECS,
  BITMAP_SUBTITLE_CODECS,
  PLAYBACK_RATES,
  languageLabel,
  subtitleCodecLabel,
  audioCodecLabel,
  isTextSubtitleCodec,
  isBitmapSubtitleCodec,
  channelLabel,
  audioTrackLabel,
  subtitleTrackLabel,
  externalSubtitleLabel,
  isExternalSubtitleFile,
  normalizePlaybackRate,
};
