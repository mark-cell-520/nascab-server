'use strict';
/**
 * 浏览器能不能直连播放这个源
 *
 * 为什么需要这一层：`/api/videoPlayer/stream-mp4` 的 `mode=copy` 是纯 remux，
 * 视频音频流原样搬进 mp4 容器。上游只在 `.mov` 上判断过音频要不要转 aac
 * （`_shouldFallbackMovCopyAudio` 第一行就是 `ext !== '.mov' return false`），
 * 视频编码更是从头到尾没看过一眼——于是 HEVC / MPEG-4 Part2 / DTS / TrueHD
 * 这类源会被原封不动推给浏览器，播放器报 MEDIA_ERR_SRC_NOT_SUPPORTED，
 * 用户看到的就是黑屏加一句「播放失败」。
 *
 * 这里把「哪些编码浏览器能解」收成一份定义，服务端据此决定 copy 还是重编码，
 * 并通过 `/api/videoPlayer/tracks` 的 `directPlay` 字段告诉前端，让前端能在
 * 起播前就切到转码档位，而不是等播放器报错再补救。
 *
 * 注意区分两件常被混为一谈的事：
 *   ① mp4 容器装得下什么编码（AC3/E-AC3 装得下）
 *   ② 浏览器解得了什么编码（桌面 Chrome/Firefox 解不了 AC3）
 * 上游的 `_isMp4CompatibleAudioCodec` 回答的是 ①，这里回答的是 ②。
 * 拿 ① 的结论去做 ② 的判断，就是「容器明明支持却放不出来」的原因。
 */

/** 桌面 + 移动主流浏览器都能解的音频编码（取交集，宁少不多） */
const WEB_AUDIO_CODECS = new Set(['aac', 'mp3', 'mp2', 'opus', 'vorbis', 'flac', 'alac']);

/** 桌面 + 移动主流浏览器都能解的视频编码 */
const WEB_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);

/**
 * H.264 里浏览器普遍不解的 profile（10bit / 4:2:2 / 4:4:4）。
 * ffprobe 的 profile 字段形如 'High 10'、'High 4:2:2'、'Constrained Baseline'。
 */
const H264_UNPLAYABLE_PROFILES = [
  'high 10',
  'high 4:2:2',
  'high 4:4:4',
];

/** 编码名 → 人话。给提示文案用，避免把 'hevc' 直接扔给用户。 */
const CODEC_LABELS = {
  h264: 'H.264 / AVC',
  hevc: 'HEVC / H.265',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  mpeg4: 'MPEG-4 Part 2',
  mpeg2video: 'MPEG-2',
  theora: 'Theora',
  wmv3: 'WMV3',
  msmpeg4v3: 'MS-MPEG4 v3',
  aac: 'AAC',
  mp3: 'MP3',
  mp2: 'MP2',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  alac: 'ALAC',
  ac3: 'AC3 / 杜比数字',
  eac3: 'E-AC3 / 杜比数字+',
  ec3: 'E-AC3 / 杜比数字+',
  dts: 'DTS',
  truehd: 'Dolby TrueHD',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  pcm_s32le: 'PCM',
  wmav2: 'WMA',
  cook: 'RealAudio',
};

function normalizeCodec(name) {
  if (name === undefined || name === null) return '';
  return String(name).trim().toLowerCase();
}

/** ffprobe 的 codec_name 偶尔带 '-generic' 之类的尾巴，取主干 */
function codecStem(name) {
  const c = normalizeCodec(name);
  if (!c) return '';
  const m = /^([a-z0-9]+)/.exec(c);
  return m ? m[1] : c;
}

function codecLabel(name) {
  const c = normalizeCodec(name);
  if (!c) return '未知编码';
  return CODEC_LABELS[c] || CODEC_LABELS[codecStem(c)] || c.toUpperCase();
}

/**
 * 视频编码能否直连播放
 * @param {string} codec ffprobe 的 codec_name
 * @param {string} [profile] ffprobe 的 profile
 */
function isWebPlayableVideoCodec(codec, profile) {
  const c = codecStem(codec);
  if (!c) return true; // 探测不到就当能放，交给播放器自己报错，别在这里误杀
  if (!WEB_VIDEO_CODECS.has(c)) return false;
  if (c === 'h264') {
    const p = normalizeCodec(profile);
    if (p && H264_UNPLAYABLE_PROFILES.some(bad => p.includes(bad))) return false;
  }
  return true;
}

/** 音频编码能否直连播放 */
function isWebPlayableAudioCodec(codec) {
  const c = codecStem(codec);
  if (!c) return true;
  return WEB_AUDIO_CODECS.has(c);
}

/**
 * 从 ffprobe 的 streams 里挑出主视频轨与全部音频轨
 * @param {Array<object>} streams
 */
function pickStreams(streams) {
  const list = Array.isArray(streams) ? streams.filter(s => s && typeof s === 'object') : [];
  const video = list.find(s => s.codec_type === 'video') || null;
  const audio = list.filter(s => s.codec_type === 'audio');
  return { video, audio };
}

/**
 * 判断这个源能不能原样推给浏览器
 * @param {Array<object>} streams ffprobe streams
 * @returns {{
 *   ok: boolean, videoCopy: boolean, audioCopy: boolean,
 *   videoCodec: string, audioCodecs: string[],
 *   reason: string, note: string
 * }}
 *
 * ok         能否整条流 copy（视频音频都不用动）
 * videoCopy  视频能不能 copy；false 表示必须重编码视频
 * audioCopy  音频能不能 copy；false 表示至少要转一路 aac
 * reason     机器读的短码，如 'video:hevc'、'audio:ac3'
 * note       给人看的一句话
 */
function analyzeDirectPlay(streams) {
  const { video, audio } = pickStreams(streams);
  const videoCodec = video ? normalizeCodec(video.codec_name) : '';
  const videoProfile = video ? String(video.profile || '') : '';
  const audioCodecs = audio.map(s => normalizeCodec(s.codec_name)).filter(Boolean);

  const videoCopy = isWebPlayableVideoCodec(videoCodec, videoProfile);
  // 任一路音频不解就得转；只转这一路，其余 copy
  const badAudio = audio.find(s => !isWebPlayableAudioCodec(s.codec_name));
  const audioCopy = !badAudio;

  const reasons = [];
  if (!videoCopy) reasons.push('video:' + (videoCodec || 'unknown'));
  if (!audioCopy) reasons.push('audio:' + normalizeCodec(badAudio && badAudio.codec_name));

  let note = '';
  if (!videoCopy) {
    note = `视频编码 ${codecLabel(videoCodec)} 浏览器不支持`;
  } else if (!audioCopy) {
    note = `音频编码 ${codecLabel(badAudio && badAudio.codec_name)} 浏览器不支持`;
  }

  return {
    ok: videoCopy && audioCopy,
    videoCopy,
    audioCopy,
    videoCodec,
    audioCodecs,
    reason: reasons.join(','),
    note,
  };
}

/**
 * mp4 容器层面装不装得下这个音频编码。
 * 与 isWebPlayableAudioCodec 是两件事：AC3 装得下但浏览器多数解不了。
 * @param {string} codec
 */
function isMp4CompatibleAudioCodec(codec) {
  const c = normalizeCodec(codec);
  if (!c) return true;
  return new Set(['aac', 'alac', 'ac3', 'eac3', 'ec3', 'mp3', 'mp2']).has(c);
}

/**
 * 编码 → MediaSource 用的 codec 字符串。
 *
 * 给前端做能力实测用（`MediaSource.isTypeSupported('video/mp4; codecs="..."')`）。
 * 服务端的黑名单只是「主流浏览器交集」的参考，最终能不能放要浏览器自己说——
 * HEVC 就是反例：Safari 与带 HEVC 硬解的 Windows Edge/Chrome 都能放，服务端
 * 一口咬定放不了，就会把原本能硬解直看的 4K 原片推上实时重编码。
 * 所以这里给的是「可以拿去问浏览器」的候选，不是结论。
 */
const VIDEO_CODEC_STRINGS = {
  h264: 'avc1.640028',       // High@4.0，最通用的一档
  hevc: 'hvc1.1.6.L93.B0',   // Main profile
  vp8: 'vp8',
  vp9: 'vp9',
  av1: 'av01.0.08M.08',
  mpeg4: 'mp4v.20.9',
};

const AUDIO_CODEC_STRINGS = {
  aac: 'mp4a.40.2',
  mp3: 'mp4a.40.34',
  ac3: 'ac-3',
  eac3: 'ec-3',
  ec3: 'ec-3',
  opus: 'opus',
  vorbis: 'vorbis',
  flac: 'flac',
  alac: 'alac',
};

function videoCodecString(codec) {
  return VIDEO_CODEC_STRINGS[codecStem(codec)] || '';
}

function audioCodecString(codec) {
  return AUDIO_CODEC_STRINGS[codecStem(codec)] || '';
}

/**
 * 生成给前端实测的 mime 候选。
 * @param {{videoCodec?:string, audioCodecs?:string[]}} src
 * @returns {string[]} 形如 ['video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"', ...]
 *
 * 给多个候选而不是一个：视频单独一个（有些源没音轨）、视频+第一路音频一个
 * （真实播放要的是这个）、视频+其余音频轨各一个（切音轨后要能放）。
 * 前端只要有一个候选浏览器说能播，就保持原画直连。
 */
function mimeCandidates(src) {
  const v = videoCodecString(src && src.videoCodec);
  if (!v) return [];
  const audios = (src && Array.isArray(src.audioCodecs) ? src.audioCodecs : [])
    .map(audioCodecString)
    .filter(Boolean);
  const out = [`video/mp4; codecs="${v}"`];
  audios.forEach(a => out.push(`video/mp4; codecs="${v},${a}"`));
  return out;
}

module.exports = {
  WEB_AUDIO_CODECS,
  WEB_VIDEO_CODECS,
  normalizeCodec,
  codecStem,
  codecLabel,
  isWebPlayableVideoCodec,
  isWebPlayableAudioCodec,
  isMp4CompatibleAudioCodec,
  pickStreams,
  analyzeDirectPlay,
  videoCodecString,
  audioCodecString,
  mimeCandidates,
};
