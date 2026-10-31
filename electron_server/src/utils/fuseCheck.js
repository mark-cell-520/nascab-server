const fs = require('fs');
const os = require('os');

/**
 * rclone mount 依赖 FUSE。容器里 /dev/fuse 常常"节点在、设备打不开"——
 * device cgroup 的 BPF 过滤器直接对 open() 返 EPERM，fusermount3 随后
 * mount(2) 还需要 CAP_SYS_ADMIN，两道关任何一道不过，rclone 都只往 stderr
 * 写一行
 *   fusermount3: failed to open /dev/fuse: Operation not permitted
 * 然后秒退。上层看到的只有 "挂载启动失败"，用户完全无从下手。
 *
 * 这里提前自己 open 一次 /dev/fuse：能打开说明 FUSE 可用（返回 null），
 * 打不开就把 errno 原文带回去，让上层给出一句能照着做的提示。
 *
 * fileMount（SMB/NFS/SFTP/WebDAV/FTP）和 openlistMount（网盘）两条挂载
 * 链路都走 rclone mount，共用这一个检查，避免两处各写一遍还写得不一致。
 *
 * @returns {null|string} null 表示可用；否则返回可读的原因串
 */
function checkFuseAvailable() {
  // WinFsp 不是 FUSE，Windows 上不检查 /dev/fuse
  if (process.platform === 'win32') return null;

  try {
    const fd = fs.openSync('/dev/fuse', os.constants.O_RDWR);
    fs.closeSync(fd);
    return null;
  } catch (e) {
    const code = e && e.code ? String(e.code) : '';
    const message = e && e.message ? String(e.message) : String(e);
    if (code === 'ENOENT') {
      return '当前系统没有 /dev/fuse（未安装 FUSE），无法挂载';
    }
    return `当前环境不允许使用 FUSE（打开 /dev/fuse 失败：${message}），无法挂载`;
  }
}

module.exports = { checkFuseAvailable };
