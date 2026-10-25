const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { spawn } = require('node:child_process');
const config = require('../config/config');
const ffmpegPath = require('../libsPath/ffmpegPath');
const ffprobePath = require('../libsPath/ffprobePath');
const FileUtil = require('./fileUtil');
const transCodeUtil = require('./transCodeUtil');

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

function isBitmapSubtitleCodec(codecName) {
  const v = String(codecName || '').toLowerCase();
  return (
    v === 'pgssub' ||
    v === 'hdmv_pgs_subtitle' ||
    v === 'vobsub' ||
    v === 'dvd_subtitle' ||
    v === 'dvdsub' ||
    v === 'dvb_subtitle' ||
    v === 'xsub'
  );
}

async function fileExistsNonEmpty(p) {
  try {
    const st = await fs.promises.stat(p);
    return st && st.isFile() && Number(st.size) > 0;
  } catch (_) {
    return false;
  }
}

/** 可用的 VTT 缓存必须至少包含一条 cue，避免把编码异常产生的空 WEBVTT 当成成功结果缓存 */
async function vttFileHasCue(p) {
  if (!(await fileExistsNonEmpty(p))) return false;
  try {
    const text = await fs.promises.readFile(p, 'utf8');
    return text.indexOf('-->') >= 0;
  } catch (_) {
    return false;
  }
}

const TEXT_SUBTITLE_EXTS = ['.srt', '.ass', '.ssa', '.vtt', '.sub'];

/**
 * 外挂文本字幕常见 GBK/ANSI 编码：ffmpeg 默认按 UTF-8 解码会整条 decode error，
 * 输出只有 WEBVTT 头的空文件，客户端因此看不到任何字幕。
 * 返回需要传给 ffmpeg 的 -sub_charenc 值；UTF-8 或带 BOM 的文件返回 ''（无需指定）。
 */
function detectSubtitleCharset(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_SUBTITLE_EXTS.includes(ext)) return '';
    const st = fs.statSync(filePath);
    if (!st.isFile() || Number(st.size) === 0) return '';
    const readLen = Math.min(Number(st.size), 1024 * 1024);
    const buf = Buffer.allocUnsafe(readLen);
    const fd = fs.openSync(filePath, 'r');
    let n = 0;
    try {
      n = fs.readSync(fd, buf, 0, readLen, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (n <= 0) return '';
    const head = buf.subarray(0, n);
    // UTF-8 BOM / UTF-16 BOM：ffmpeg 能自行识别
    if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return '';
    if (head.length >= 2 &&
      ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) {
      return '';
    }
    try {
      // stream 模式下不会因为末尾截断的多字节字符误判
      new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
      return '';
    } catch (_) {
      // 非 UTF-8，按 GB18030（兼容 GBK/GB2312）解码
      return 'gb18030';
    }
  } catch (_) {
    return '';
  }
}

async function extractAllToVtt({ fileHash, filePath, subtitleCodecs }) {
  const input = path.resolve(String(filePath || '').trim());
  if (!input) return { ok: false, code: 'INVALID_PATH', message: 'invalid filePath' };
  if (!fs.existsSync(input)) return { ok: false, code: 'NOT_FOUND', message: 'file not found' };
  const hash = String(fileHash || '').trim() || (await FileUtil.getFileHash(input));
  if (!hash) return { ok: false, code: 'HASH_FAILED', message: 'hash failed' };

  const cacheDir = path.join(config.getCachePath(), 'subtitleVtt', String(hash));
  await fs.promises.mkdir(cacheDir, { recursive: true });

  let codecList = Array.isArray(subtitleCodecs) ? subtitleCodecs.map(v => (v == null ? '' : String(v))) : null;
  if (!codecList) {
    const probe = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(input, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    }).catch(() => null);
    const streams = probe && Array.isArray(probe.streams) ? probe.streams : [];
    const subtitleStreams = streams.filter(s => s && s.codec_type === 'subtitle');
    codecList = subtitleStreams.map(s => (s && s.codec_name ? String(s.codec_name) : ''));
  }

  if (!codecList || codecList.length === 0) {
    return { ok: false, code: 'NO_SUBTITLE', message: 'no subtitle streams', fileHash: hash };
  }

  const generated = [];
  const skipped = [];
  const toGenerate = [];

  for (let i = 0; i < codecList.length; i++) {
    const codec = codecList[i] || '';
    if (codec && isBitmapSubtitleCodec(codec)) {
      skipped.push({ subtitleIndex: i, codec, reason: 'bitmap' });
      continue;
    }
    const outPath = path.join(cacheDir, `s_${i}.vtt`);
    if (await vttFileHasCue(outPath)) {
      generated.push({ subtitleIndex: i, outPath, cached: true });
      continue;
    }
    const tmpPath = `${outPath}.tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    toGenerate.push({ subtitleIndex: i, codec, outPath, tmpPath });
  }

  if (toGenerate.length > 0) {
    const inputPath = transCodeUtil.dealFfmpegPath(input);
    const inputCharset = detectSubtitleCharset(input);
    const args = ['-y', '-nostdin'];
    if (inputCharset) {
      args.push('-sub_charenc', inputCharset);
    }
    args.push('-i', inputPath, '-vn', '-an');
    for (const item of toGenerate) {
      args.push('-map', `0:s:${item.subtitleIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', item.tmpPath);
    }

    const ffmpegBin = ffmpegPath && ffmpegPath.path ? ffmpegPath.path : 'ffmpeg';
    try {
      const quote = v => {
        const s = String(v ?? '');
        if (s === '') return "''";
        if (/[^A-Za-z0-9_./:\\-]/.test(s)) {
          return `'${s.replace(/'/g, `'\\''`)}'`;
        }
        return s;
      };
      const cmdForLog = `${quote(ffmpegBin)} ${args.map(quote).join(' ')}`;
      console.log('[subtitleVttExtract] ffmpeg cmd:', cmdForLog);
    } catch (_) {}
    const stderrTail = [];
    const runResult = await new Promise(resolve => {
      const p = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      p.stderr.on('data', chunk => {
        const text = String(chunk || '');
        if (text) {
          stderrTail.push(text);
          if (stderrTail.length > 80) stderrTail.splice(0, stderrTail.length - 80);
        }
      });
      p.on('close', code => {
        resolve({ code: Number(code), stderr: stderrTail.join('') });
      });
      p.on('error', err => {
        resolve({ code: -1, stderr: err && err.message ? err.message : String(err) });
      });
    });

    if (!runResult || runResult.code !== 0) {
      await Promise.allSettled(toGenerate.map(i => fs.promises.rm(i.tmpPath, { force: true })));
      return {
        ok: false,
        code: 'FFMPEG_FAILED',
        message: (runResult && runResult.stderr ? String(runResult.stderr).slice(-2000) : 'ffmpeg failed'),
        fileHash: hash,
      };
    }

    for (const item of toGenerate) {
      try {
        await fs.promises.rm(item.outPath, { force: true }).catch(() => null);
        await fs.promises.rename(item.tmpPath, item.outPath);
        if (await vttFileHasCue(item.outPath)) {
          generated.push({ subtitleIndex: item.subtitleIndex, outPath: item.outPath, cached: false });
        } else {
          await fs.promises.rm(item.outPath, { force: true }).catch(() => null);
          skipped.push({ subtitleIndex: item.subtitleIndex, codec: item.codec, reason: 'empty_output' });
        }
      } catch (e) {
        skipped.push({
          subtitleIndex: item.subtitleIndex,
          codec: item.codec,
          reason: e && e.message ? e.message : 'rename_failed',
        });
        try {
          await fs.promises.rm(item.tmpPath, { force: true });
        } catch (_) {}
      }
    }
  }

  return { ok: generated.length > 0, fileHash: hash, generated, skipped };
}

module.exports = {
  isBitmapSubtitleCodec,
  extractAllToVtt,
};
