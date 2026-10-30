'use strict';
let app, shell, ipcMain;
const fs = require('fs');
const os = require('os');
const path = require('path');
const initUtil = require('./initUtil');
const Logger = require('./utils/logger');
const tableConfig = require('./db/table/tableConfig');
const { getVfsCacheRoot } = require('./utils/rcloneMountPerf');
const { scheduleStaleWorkerReaper } = require('./utils/staleWorkerReaper');
const { getSingletonWorkerManager } = require('./workers/singletonWorkerManager');
// 单例Worker管理器
const singletonWorkerManager = getSingletonWorkerManager();

try {
  app = require('electron').app;
  shell = require('electron').shell;
  ipcMain = require('electron').ipcMain;
  // 检测是否为打包后的生产环境，并设置 NODE_ENV
  if (process.env.NODE_ENV === undefined) {
    // app.isPackaged 是 Electron 内置的判断是否打包的标识
    process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
  }
  // 部分 Windows 机器在加载本地 file:// 界面时 GPU 进程会反复崩溃，
  // 进一步导致首个 BrowserWindow 加载 index.html 直接 ERR_FAILED(-2)。
  // 桌面端 UI 主要是普通管理页，关闭硬件加速的代价较低，但能显著提升兼容性。
  if (process.platform === 'win32') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
  }
} catch (err) {
  // Docker/无界面模式：未安装 electron，仅运行后端服务
  Logger.info('Clientless service mode (Docker / no Electron)');
}
/** 是否为 Electron 环境（桌面应用）；false 表示 Docker/无界面模式，不做窗口、托盘、检查更新等 */
const isElectronAvailable = !!(app && shell && ipcMain);
// 无界面模式下没有 electron.shell，worker 里 `process.send` 却依然存在，
// 于是 /api/file/system/open 这类"交给主进程调 shell.openPath"的接口会照常回 200，
// 消息打到主进程后 handleShell 因 shell 为 undefined 直接 return——前端提示成功，
// 用户屏幕上什么都不会发生。把能力缺失写进 env，fork 出来的 worker 天然继承。
if (!isElectronAvailable) {
  process.env.NASCAB_CLIENTLESS = '1';
}
let mainWindow;

//检测mac的完全磁盘访问权限
// 说明：TCC.db 在部分 macOS 版本上即使已授予「完整磁盘访问」仍可能 open 返回 EPERM，
// 若遇拒即返回 false 会误报。因此优先尝试 Safari/Messages 等探针，且对 EPERM/EACCES 继续尝试下一项。
function detectMacFullDiskAccess() {
  if (process.platform !== 'darwin') {
    return { platform: process.platform, granted: true, supported: false };
  }

  const home = os.homedir();
  const probes = [
    path.join(home, 'Library', 'Safari', 'History.db'),
    path.join(home, 'Library', 'Messages', 'chat.db'),
    path.join(home, 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db'),
    '/Library/Application Support/com.apple.TCC/TCC.db',
  ];

  let sawExistingProbe = false;
  let lastDeny = null;

  for (const p of probes) {
    try {
      if (!fs.existsSync(p)) continue;
      sawExistingProbe = true;
      const fd = fs.openSync(p, 'r');
      try {
        fs.closeSync(fd);
      } catch (_) {}
      return { platform: 'darwin', granted: true, supported: true, probePath: p };
    } catch (e) {
      const code = e && e.code ? String(e.code) : '';
      if (code === 'EACCES' || code === 'EPERM') {
        lastDeny = { probePath: p, code };
        continue;
      }
      // 非权限类错误（如瞬时 IO）不当作「无完整磁盘访问」
    }
  }

  if (sawExistingProbe && lastDeny) {
    return {
      platform: 'darwin',
      granted: false,
      supported: true,
      probePath: lastDeny.probePath,
      code: lastDeny.code,
    };
  }

  if (sawExistingProbe) {
    return { platform: 'darwin', granted: true, supported: true, undetermined: true };
  }

  return { platform: 'darwin', granted: true, supported: true, undetermined: true };
}

function cleanupOpenlistRcloneVfsCacheOnStartup() {
  try {
    const root = String(getVfsCacheRoot && getVfsCacheRoot()).trim();
    if (!root) return;
    if (!fs.existsSync(root)) return;
    fs.rmSync(root, { recursive: true, force: true });
    Logger.info('[startup] cleaned openlist rclone vfs cache', { root });
  } catch (e) {
    Logger.warn('[startup] clean openlist rclone vfs cache failed', e && e.message);
  }
}

function main() {
  // 清理 OpenList rclone VFS 缓存（每次启动一次；挂载运行期间由 rclone 自行回收）
  cleanupOpenlistRcloneVfsCacheOnStartup();

  if (isElectronAvailable) {
    // ---------- Electron 桌面模式：单例锁、窗口、托盘、检查更新等 ----------
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
      process.kill(process.pid, 'SIGTERM');
      return;
    }

    app.on('before-quit', async event => {
      // 因安装更新而退出时不拦截 quit，否则安装程序无法启动（由 autoUpdateMain 在 quitAndInstall 前设置标志）
      try {
        const { getIsQuittingForUpdate } = require('./ui/autoUpdateMain');
        if (getIsQuittingForUpdate && getIsQuittingForUpdate()) {
          Logger.info('📡 Exiting to install update');
          return;
        }
      } catch (_) {}
      Logger.info('📡 App quitting, stopping singleton workers...');
      event.preventDefault();
      try {
        await singletonWorkerManager.gracefulShutdown();
        Logger.info('✅ All singleton workers stopped, safe to exit app');
        app.exit(0);
      } catch (error) {
        Logger.error('❌ Failed to stop singleton workers:', error);
        app.exit(1);
      }
    });

    app.on('second-instance', (event, commandLine, workingDirectory) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    });

    app.whenReady().then(async () => {
      const { register: registerUiIpc } = require('./ipc/uiIpcHandlers');
      const { createMainWindow } = require('./ui/mainWindow');
      const { start: startPushUpdater } = require('./ui/pushUpdater');
      const { setupAutoUpdate } = require('./ui/autoUpdateMain');

      registerUiIpc(
        ipcMain,
        app,
        shell,
        tableConfig,
        Logger,
        () => initUtil.getExpressStatus(),
        () => initUtil.getProcessList(),
        () => initUtil
      );
      const fullDiskAccessStatus = detectMacFullDiskAccess();
      try {
        ipcMain.handle('mac:getFullDiskAccessStatus', async () => fullDiskAccessStatus);
      } catch (_) {}

      await initUtil.init();

      mainWindow = await createMainWindow();
      if (mainWindow) {
        try {
          initUtil.initTray(mainWindow);
        } catch (_) {}
        const pushUpdaterInstance = startPushUpdater(mainWindow, () => initUtil.getExpressStatus(), Logger);
        if (pushUpdaterInstance && typeof pushUpdaterInstance.pushStatusNow === 'function') {
          initUtil.setOnExpressStartedCallback(pushUpdaterInstance.pushStatusNow);
          // 打包场景：API 常在 createMainWindow 之前就绪，等页面加载完成后再推送一次当前状态，确保界面能刷出「已启动」
          mainWindow.webContents.once('did-finish-load', () => {
            if (!mainWindow.isDestroyed()) pushUpdaterInstance.pushStatusNow();
          });
        }
        try {
          setupAutoUpdate(mainWindow, Logger);
        } catch (e) {
          Logger.error('autoUpdate setup failed', e);
        }
        try {
          if (fullDiskAccessStatus && fullDiskAccessStatus.granted === false && !mainWindow.isDestroyed()) {
            setTimeout(() => {
              try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('mac:fullDiskAccess', fullDiskAccessStatus);
                }
              } catch (_) {}
            }, 500);
          }
        } catch (_) {}
        try {
          const openAtLoginFlag = await tableConfig.getConfigByKey(tableConfig.KEY_OPEN_AT_LOGIN);
          const minimizeFlag = await tableConfig.getConfigByKey(tableConfig.KEY_MINIMIZE_ON_START);
          try {
            require('./utils/autoLaunchUtil').setOpenAtLogin(app, openAtLoginFlag === 'true', minimizeFlag === 'true');
          } catch (_) {}
          if (minimizeFlag === 'true') {
            mainWindow.minimize();
          }
        } catch (_) {}
      }
    });
    return;
  }

  // ---------- Docker/无界面模式：仅启动后端服务，不做窗口/托盘/检查更新 ----------
  process.on('SIGTERM', async () => {
    try {
      await singletonWorkerManager.gracefulShutdown();
      Logger.info('✅ All singleton workers stopped, process may exit');
      process.exit(0);
    } catch (error) {
      Logger.error('❌ Failed to stop singleton workers:', error);
      process.exit(1);
    }
  });

  process.on('SIGINT', async () => {
    try {
      await singletonWorkerManager.gracefulShutdown();
      Logger.info('✅ All singleton workers stopped, process may exit');
      process.exit(0);
    } catch (error) {
      Logger.error('❌ Failed to stop singleton workers:', error);
      process.exit(1);
    }
  });

  // 上一代主进程若非经 SIGTERM 死亡（未捕获异常 / 被 SIGKILL / 下面 init 失败后
  // process.exit(1)），它 fork 出的 singleton worker 会被 init 收养并继续常驻，
  // 每代泄漏 4~5 个进程：重复的文件监听、SQLite 连接和广播状态会让各项功能失灵。
  // 这里在拉起本代 worker 之前先把残留清掉。
  scheduleStaleWorkerReaper({ logger: Logger, delayMs: 60000 });

  initUtil.init().catch(async err => {
    Logger.error('Docker mode init failed', err);
    // init 可能已经拉起了一部分 singleton worker 才失败，直接 exit 会把它们遗弃。
    // 走一遍优雅关闭，失败也不要阻塞退出。
    try {
      await singletonWorkerManager.gracefulShutdown();
    } catch (_) {}
    process.exit(1);
  });
}

main();
