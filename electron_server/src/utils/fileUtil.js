const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FileUtil {
  /**
   * Get unique ID for a file based on path, size, and mtime
   */
  static async getFileHash(filePath) {
    try {
      const stat = await fs.promises.stat(filePath);
      const str = `${path.basename(filePath)}_${stat.size}_${stat.birthtimeMs}`;
      return crypto.createHash('md5').update(str).digest('hex');
    } catch (e) {
      return null;
    }
  }
  static getErrorMessageKey(err) {
    if (!err || !err.code) return err && err.message ? err.message : 'file.UNKNOWN_ERROR';
    switch (err.code) {
      case 'EPERM':
      case 'EACCES':
        return 'file.NO_WRITE_PERMISSION';
      case 'EROFS':
        return 'file.FOLDER_IS_ONLY_READ';
      case 'EEXIST':
        return 'file.FILE_EXISTS';
      case 'ENOENT':
        return 'file.FOLDER_NOT_EXIST';
      case 'EBUSY':
        return 'file.FILE_BUSY';
      default:
        return err.message || 'file.UNKNOWN_ERROR';
    }
  }
  static isHideFile(filename) {
    if (!filename) return false;
    return filename.startsWith('.');
  }
  static temporaryFileSuffixes = ['.tmp', '.bc!', '.td', '.qkdownloading', '.xltd', '.downloading'];
  static isTemporaryOrDownloadingFile(filename) {
    if (!filename) return false;
    const lower = String(filename).toLowerCase();
    return FileUtil.temporaryFileSuffixes.some(suffix => lower.endsWith(suffix));
  }
  static shouldSkipIndexingFilename(filename) {
    if (!filename) return false;
    return FileUtil.isSystemFile(filename) || FileUtil.isHideFile(filename) || FileUtil.isTemporaryOrDownloadingFile(filename);
  }
  static watchIgnoredList = [
    '**/.git',
    '**/.DS_Store', // macOS
    '**/Thumbs.db', // Windows
    '**/desktop.ini', // Windows
    '**/.localized', // macOS
    '**/._*', // macOS resource fork
    '**/$RECYCLE.BIN', // Windows
    '**/System Volume Information', // Windows
    '**/@eaDir', //群晖临时文件
  ];
  static systemFiles = [
    '.DS_Store', // macOS
    'Thumbs.db', // Windows
    'desktop.ini', // Windows
    '.localized', // macOS
    '._*', // macOS resource fork
    '$RECYCLE.BIN', // Windows
    'System Volume Information', // Windows
    '@eaDir' //群晖临时文件
  ];
  static isSystemFile(filename) {
    if (!filename) return false;

    // Check exact matches
    if (FileUtil.systemFiles.includes(filename)) return true;
    // Check patterns
    if (filename.startsWith('._')) return true;
    return false;
  }

  /**
   * 系统关键目录清单（Linux）。
   * 注意：故意不收 /boot —— 这台机器的视频源就是 /boot/电影，收了会把现有媒体库全打断；
   * 也不收 /mnt /media /srv /home，NAS 上这些正是用户挂数据的地方。
   */
  static linuxProtectedPaths = ['/proc', '/sys', '/dev', '/run', '/tmp', '/root', '/lost+found', '/etc', '/var', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt'];

  static macProtectedPaths = ['/System', '/Applications', '/bin', '/dev', '/home', '/opt', '/Users', '/sbin', '/usr', '/Library', '/private', '/var', '/tmp', '/cores', '/etc', '/Volumes', '/Volumes/Macintosh HD'];

  /**
   * 把入参收敛成可比较的绝对路径。
   * 原来是 path.normalize：既不 resolve 相对路径，也不还原 '..'，
   * 传 'etc/../../etc' 或一个相对路径就能绕过整张保护清单。
   */
  static _normalizeForProtectCheck(filePath) {
    if (typeof filePath !== 'string') return '';
    const raw = filePath.trim();
    if (!raw) return '';
    let resolved;
    try {
      resolved = path.resolve(raw);
    } catch (_) {
      return '';
    }
    if (resolved.length > 1 && resolved.endsWith(path.sep)) {
      resolved = resolved.slice(0, -1);
    }
    return resolved;
  }

  /**
   * 逐个目录向上找第一个真实存在的祖先，取它的 realpath。
   * 备份/上传的目标路径往往还不存在，直接 realpathSync 会 ENOENT；
   * 只 realpath 存在的部分也能挡住 '/tmp/link/etc' 这类中间跳板。
   */
  static _realpathOrNearestExisting(p) {
    let current = p;
    while (current && current !== path.parse(current).root) {
      try {
        const real = fs.realpathSync(current);
        if (real && real !== current) return real;
        return '';
      } catch (_) {
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
    return '';
  }

  /**
   * 判断 normalized（已是绝对路径）是否落在保护清单里。
   * 原来是 `protectedPaths.includes(normalized)`，即"整条路径必须一字不差等于清单项"，
   * 于是 '/etc/cron.d/x'、'/root/.ssh'、'/usr/local/bin' 统统不算受保护 ——
   * 备份目标、删除、重命名都能直接落到这些目录里。这里改成子树判定。
   */
  static _isProtectedNormalized(normalized, protectedPaths, caseInsensitive) {
    if (!normalized) return false;
    const target = caseInsensitive ? normalized.toLowerCase() : normalized;
    const root = path.parse(normalized).root;
    for (const raw of protectedPaths) {
      const p = caseInsensitive ? raw.toLowerCase() : raw;
      if (target === p) return true;
      if (p === root) {
        if (target.startsWith(root)) return true;
        continue;
      }
      const prefix = p.endsWith(path.sep) ? p : `${p}${path.sep}`;
      if (target.startsWith(prefix)) return true;
    }
    return false;
  }

  /**
   * 判断是否为系统关键目录（含其下所有子路径）。
   * 三道关：resolve 后的字符串比对、realpath 还原后的字符串比对、
   * 以及软链接指向（'/tmp/link -> /etc' 这种）。
   */
  static isProtectedPath(filePath) {
    const normalized = FileUtil._normalizeForProtectCheck(filePath);
    if (!normalized) return false;

    const platform = process.platform;
    if (platform === 'win32') {
      // Windows: 磁盘根目录（C:\、D:\）。大小写不敏感。
      if (/^[a-zA-Z]:[\\/]*$/.test(normalized)) return true;
      return false;
    }

    if (platform === 'darwin') {
      if (normalized === '/') return true;
      if (FileUtil._isProtectedNormalized(normalized, FileUtil.macProtectedPaths, true)) return true;
      const real = FileUtil._realpathOrNearestExisting(normalized);
      return !!real && FileUtil._isProtectedNormalized(real, FileUtil.macProtectedPaths, true);
    }

    if (platform === 'linux') {
      if (normalized === '/') return true;
      if (FileUtil._isProtectedNormalized(normalized, FileUtil.linuxProtectedPaths, false)) return true;
      const real = FileUtil._realpathOrNearestExisting(normalized);
      return !!real && FileUtil._isProtectedNormalized(real, FileUtil.linuxProtectedPaths, false);
    }

    return false;
  }
}

module.exports = FileUtil;
