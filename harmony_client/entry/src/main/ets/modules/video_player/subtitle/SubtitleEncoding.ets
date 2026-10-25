/**
 * 外挂文本字幕的字符集处理（纯客户端）：
 * mpv/libass 只按 UTF-8 解析文本字幕，GBK/Big5/UTF-16 会直接乱码。
 * 这里把原始字节解码成文本，调用方再写成 UTF-8 本地文件交给 mpv。
 */

import { util } from '@kit.ArkTS';

/** 常用简体/繁体字：GB18030 与 Big5 都能“合法”解码任意双字节，只能按常用字命中数区分 */
const COMMON_SIMPLIFIED =
  '的一是不了在人有我他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生自会那后能对着事其里所去行过家十用发天如然作方成者多日都三小军二无同么经法当起与好看学进种将还分此心前面又定见只主没公从';
const COMMON_TRADITIONAL =
  '的一是不了在人有我他這為之大來以個中上們到說國和地也子時道出而要於就下得可你年生自會那後能對著事其裡所去行過家十用發天如然作方成者多日都三小二無同麼經法當起與好看學進種將還分此心前面又定見只主沒公從';

function tryDecode(encoding: string, bytes: Uint8Array, fatal: boolean): string | undefined {
  try {
    const decoder = util.TextDecoder.create(encoding, { fatal: fatal });
    return decoder.decodeToString(bytes);
  } catch (_e) {
    return undefined;
  }
}

/** 无 BOM 时按 NUL 字节的奇偶分布判断 UTF-16 端序 */
function detectUtf16(bytes: Uint8Array): string {
  const len = Math.min(bytes.length, 4096);
  if (len < 32) {
    return '';
  }
  let evenNull = 0;
  let oddNull = 0;
  for (let i = 0; i < len; i++) {
    if (bytes[i] !== 0) {
      continue;
    }
    if (i % 2 === 0) {
      evenNull += 1;
    } else {
      oddNull += 1;
    }
  }
  const pairs = Math.floor(len / 2);
  if (pairs <= 0) {
    return '';
  }
  if (oddNull / pairs > 0.35 && evenNull / pairs < 0.1) {
    return 'utf-16le';
  }
  if (evenNull / pairs > 0.35 && oddNull / pairs < 0.1) {
    return 'utf-16be';
  }
  return '';
}

function countCommonChars(text: string, chars: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (chars.indexOf(text.charAt(i)) >= 0) {
      n += 1;
    }
  }
  return n;
}

/**
 * 把字幕原始字节解码成文本（UTF-8 / UTF-16 / GB18030 / Big5）。
 * 返回 undefined 表示无法作为文本字幕处理（例如位图或二进制内容）。
 */
export function decodeSubtitleText(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0) {
    return '';
  }

  // UTF-16 BOM
  if (bytes.length >= 2) {
    const le = bytes[0] === 0xff && bytes[1] === 0xfe
      ? tryDecode('utf-16le', bytes, false) : undefined;
    const be = bytes[0] === 0xfe && bytes[1] === 0xff
      ? tryDecode('utf-16be', bytes, false) : undefined;
    if (le !== undefined) {
      return le;
    }
    if (be !== undefined) {
      return be;
    }
  }

  // 无 BOM 的 UTF-16（UTF-8 允许 NUL 字节，必须在 UTF-8 尝试之前判断）
  const utf16 = detectUtf16(bytes);
  if (utf16.length > 0) {
    const text = tryDecode(utf16, bytes, false);
    if (text !== undefined) {
      return text;
    }
  }

  // 非 UTF-16 的二进制保护：文本字幕不应出现大量 NUL（UTF-8 本身允许 NUL，必须在 UTF-8 之前判断）
  let nul = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      nul += 1;
    }
  }
  if (nul / bytes.length > 0.02) {
    return undefined;
  }

  // UTF-8（BOM 由 TextDecoder 自动剥离）；fatal 用于确认是否真的是 UTF-8
  const utf8 = tryDecode('utf-8', bytes, true);
  if (utf8 !== undefined) {
    return utf8;
  }

  // GB18030 与 Big5 都会“成功”解码任意双字节，按常用简繁汉字命中数选择
  const gb = tryDecode('gb18030', bytes, false);
  const big5 = tryDecode('big5', bytes, false);
  if (gb === undefined && big5 === undefined) {
    return undefined;
  }
  if (gb === undefined) {
    return big5;
  }
  if (big5 === undefined) {
    return gb;
  }
  return countCommonChars(gb, COMMON_SIMPLIFIED) >= countCommonChars(big5, COMMON_TRADITIONAL) ? gb : big5;
}
