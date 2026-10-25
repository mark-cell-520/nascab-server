'use strict';
/**
 * 视频清晰度档位
 *
 * 为什么需要这一层：上游 /api/videoPlayer/transcode 只接受 width / resolution /
 * bitrate 三个裸参数，其中 resolution 还只认 "1920x1080" 这种 WxH 写法——传
 * "1080p" 会被 parseResolution 静默忽略，结果就是「选了清晰度但没有任何变化」。
 * 而且没有任何地方定义过「有哪些清晰度可选」，前端拿不到档位表。
 *
 * 这里把档位收敳成一份 canonical 定义：档位 key → (宽/高/码率)，
 * transcode 与 stream-mp4 都从这儿取参数，前端也只认档位 key。
 */

/** 档位表。width 为 0 表示「不缩放」（原画）。 */
const QUALITY_TIERS = [
  { key: 'original', label: '原画', width: 0, height: 0, bitrate: '', desc: '不转码，按源文件播放' },
  { key: '1080p', label: '1080P', width: 1920, height: 1080, bitrate: '6000k', desc: '全高清' },
  { key: '720p', label: '720P', width: 1280, height: 720, bitrate: '3000k', desc: '高清' },
  { key: '480p', label: '480P', width: 854, height: 480, bitrate: '1200k', desc: '标清' },
  { key: '360p', label: '360P', width: 640, height: 360, bitrate: '600k', desc: '流畅' },
];

const TIER_BY_KEY = new Map(QUALITY_TIERS.map(t => [t.key, t]));

/** 别名 → 档位 key。大小写不敏感，覆盖常见写法。 */
const KEY_ALIASES = {
  original: 'original',
  source: 'original',
  raw: 'original',
  auto: 'original',
  origin: 'original',
  '1080p': '1080p',
  '1080': '1080p',
  fhd: '1080p',
  'fullhd': '1080p',
  '1920x1080': '1080p',
  '720p': '720p',
  '720': '720p',
  hd: '720p',
  '1280x720': '720p',
  '480p': '480p',
  '480': '480p',
  '854x480': '480p',
  '360p': '360p',
  '360': '360p',
  '640x360': '360p',
};

/**
 * 把各种写法归一成档位 key
 * @param {*} input
 * @returns {string|null} 无法识别时返回 null
 */
function normalizeQualityKey(input) {
  if (input === undefined || input === null) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;
  if (KEY_ALIASES[raw]) return KEY_ALIASES[raw];
  // "1080P 高清" / "1080p " 之类：抽出主干再试
  const m = /^(\d{3,4})\s*[pi]?$/.exec(raw);
  if (m) {
    const byHeight = QUALITY_TIERS.find(t => t.height === Number(m[1]));
    if (byHeight) return byHeight.key;
  }
  return null;
}

function getTier(key) {
  const k = normalizeQualityKey(key);
  return k ? TIER_BY_KEY.get(k) || null : null;
}

/** 码率字符串转成 bps 数字，失败返回 0 */
function bitrateToBps(bitrate) {
  if (bitrate === undefined || bitrate === null || bitrate === '') return 0;
  if (typeof bitrate === 'number' && Number.isFinite(bitrate)) return Math.floor(bitrate);
  // 兼容 6000k / 5M / 3000 / 6000kbps / 128k 等写法
  const s = String(bitrate)
    .trim()
    .toLowerCase()
    .replace(/bps$/, '')
    .replace(/b$/, '');
  const m = /^([\d.]+)\s*([kmg]?)$/.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unit = m[2] || '';
  const mult = unit === 'g' ? 1e9 : unit === 'm' ? 1e6 : unit === 'k' ? 1e3 : 1;
  return Math.floor(n * mult);
}

/**
 * 给定源分辨率，返回可选档位表
 * @param {{width?:number, height?:number}} source
 * @returns {Array<{key,label,width,height,bitrate,desc,available,upscale,recommended}>}
 */
function listQualities(source) {
  const srcW = Number(source && source.width) || 0;
  const srcH = Number(source && source.height) || 0;
  const recommendedKey = pickRecommendedKey(srcW, srcH);

  return QUALITY_TIERS.map(tier => {
    const isOriginal = tier.key === 'original';
    // 源比档位还小就不提供该档位——放大只会浪费带宽且不会更清晰
    const tooSmall = !isOriginal && srcW > 0 && tier.width > srcW;
    const upscale = !isOriginal && srcH > 0 && tier.height > srcH;
    return {
      key: tier.key,
      label: tier.label,
      width: tier.width,
      height: tier.height,
      bitrate: tier.bitrate,
      desc: tier.desc,
      available: !tooSmall,
      upscale,
      recommended: tier.key === recommendedKey,
    };
  });
}

/** 不超过源宽度的最高档位；源分辨率未知时退回 720p */
function pickRecommendedKey(srcW, srcH) {
  const w = Number(srcW) || 0;
  const h = Number(srcH) || 0;
  if (w <= 0 && h <= 0) return '720p';
  for (const tier of QUALITY_TIERS) {
    if (tier.key === 'original') continue;
    if (w > 0 && tier.width <= w) return tier.key;
    if (w <= 0 && h > 0 && tier.height <= h) return tier.key;
  }
  return '360p';
}

/**
 * 档位 → ffmpeg 参数
 * @param {string} key 档位 key
 * @returns {null|{key,width,height,bitrate,maxrate,bufsize}} 原画返回 null
 */
function resolveQuality(key) {
  const k = normalizeQualityKey(key);
  if (!k || k === 'original') return null;
  const tier = TIER_BY_KEY.get(k);
  if (!tier) return null;
  const bps = bitrateToBps(tier.bitrate);
  return {
    key: tier.key,
    width: tier.width,
    height: tier.height,
    bitrate: tier.bitrate,
    // 没有 maxrate/bufsize 时 x264 会在复杂场景冲到远超目标码率，
    // 直播/流式场景表现为带宽抖动，所以显式压住峰值
    maxrate: bps > 0 ? `${Math.round((bps * 1.5) / 1000)}k` : '',
    bufsize: bps > 0 ? `${Math.round((bps * 2) / 1000)}k` : '',
  };
}

/** 缩放滤镜：按宽等比，高取偶数（x264 要求 yuv420p 边长为偶数） */
function scaleFilter(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return null;
  return `scale=w=${Math.floor(w)}:h=-2`;
}

module.exports = {
  QUALITY_TIERS,
  normalizeQualityKey,
  getTier,
  listQualities,
  pickRecommendedKey,
  resolveQuality,
  scaleFilter,
  bitrateToBps,
};
