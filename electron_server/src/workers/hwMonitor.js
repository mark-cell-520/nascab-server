const si = require('systeminformation');
const Logger = require('../utils/logger');
const os = require('os');
const hwUtil = require('../utils/hardwareUtil');

/**
 * 安装进程级 IPC 错误兜底。
 *
 * 主进程退出/重载后 IPC 通道关闭，此时 process.send 会在内部以**异步**方式
 * 在 process 上抛出 'error' 事件（ERR_IPC_CHANNEL_CLOSED）。Node 对
 * process 的 'error' 事件沿用 EventEmitter 语义：没有监听器就直接把异常
 * 重新抛出，终结整个后台任务进程。这会在日志里留下固定的致命栈：
 *
 *   at HardwareMonitor.collectFastMetrics (src/workers/hwMonitor.js:...)
 *   Emitted 'error' event on process instance at:
 *
 * 因此光在调用点 try/catch 是不够的，必须在这里补一个监听器。
 * 幂等：重复调用只会注册一次。
 */
let ipcErrorGuardInstalled = false;
function installIpcErrorGuard() {
  if (ipcErrorGuardInstalled) return;
  ipcErrorGuardInstalled = true;
  process.on('error', err => {
    if (err && (err.code === 'ERR_IPC_CHANNEL_CLOSED' || /Channel closed/i.test(err.message || ''))) {
      // 父进程已经不在了，硬件监控没必要继续，安静退出即可。
      Logger.warn && Logger.warn('⚠️ 与主进程的 IPC 通道已关闭，后台任务 Worker 即将退出');
      try {
        process.exit(0);
      } catch (_) {}
      return;
    }
    Logger.error('❌ process error', err);
  });
}

class HardwareMonitor {
  constructor() {
    this.sampleIntervalMs = 3000;
    this.diskIntervalMs = 10 * 60 * 1000;
    this.lastDiskStats = { usage: [], physical: [] };
    this.sampleTimer = null;
    this.diskTimer = null;
    this.cpuInfo = null;
    this.mem = null;
    this.graphics = null;
    this.lastNetworkStats = { rx_bytes: 0, tx_bytes: 0, timestamp: Date.now() }; // 新增：保存上一次的网络统计
  }

  formatNum(num) {
    if (num === null || num === undefined || isNaN(num)) return 0;
    return parseFloat(Number(num).toFixed(1));
  }

  normalizeTemperature(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return parseFloat(num.toFixed(1));
  }

  collectTemperatureSamples(cpuTemp) {
    if (!cpuTemp || typeof cpuTemp !== 'object') return [];

    const orderedSamples = [cpuTemp.main, cpuTemp.max, cpuTemp.socket];
    if (Array.isArray(cpuTemp.cores)) {
      orderedSamples.push(...cpuTemp.cores);
    }

    return orderedSamples
      .map(value => this.normalizeTemperature(value))
      .filter(value => value !== null);
  }

  // 新增：网络速度单位转换函数
  formatNetworkSpeed(bytesPerSec) {
    if (bytesPerSec === null || bytesPerSec === undefined || isNaN(bytesPerSec)) return '0 KB/s';

    const kbPerSec = bytesPerSec / 1024; // 转换为KB/s

    if (kbPerSec < 100) {
      // 小于100KB/s，保留一位小数
      return `${parseFloat(kbPerSec.toFixed(1))} KB/s`;
    } else {
      // 大于等于100KB/s，转换为MB/s，保留一位小数
      let mbPerSec = kbPerSec / 1024;
      if (mbPerSec > 100) {
        mbPerSec = 0;
      }
      return `${parseFloat(mbPerSec.toFixed(1))} MB/s`;
    }
  }

  // 新增：计算3秒内的平均网络速度
  calculateNetworkSpeed(currentStats) {
    const now = Date.now();
    const timeDiff = (now - this.lastNetworkStats.timestamp) / 1000; // 转换为秒

    if (timeDiff <= 0) {
      return {
        downloadSpeed: '0 KB/s',
        uploadSpeed: '0 KB/s',
        downloadBytesPerSec: 0,
        uploadBytesPerSec: 0,
      };
    }

    // 计算3秒内的平均速度（字节/秒）
    const downloadBytesPerSec = (currentStats.rx_bytes - this.lastNetworkStats.rx_bytes) / timeDiff;
    const uploadBytesPerSec = (currentStats.tx_bytes - this.lastNetworkStats.tx_bytes) / timeDiff;

    // 格式化速度
    const downloadSpeed = this.formatNetworkSpeed(downloadBytesPerSec);
    const uploadSpeed = this.formatNetworkSpeed(uploadBytesPerSec);

    // 更新上一次的网络统计
    this.lastNetworkStats = {
      rx_bytes: currentStats.rx_bytes,
      tx_bytes: currentStats.tx_bytes,
      timestamp: now,
    };

    return {
      downloadSpeed,
      uploadSpeed,
      downloadBytesPerSec: this.formatNum(downloadBytesPerSec),
      uploadBytesPerSec: this.formatNum(uploadBytesPerSec),
    };
  }

  start() {
    this.stop();
    this.collectDiskMetrics();
    this.collectFastMetrics();
    this.sampleTimer = setInterval(() => this.collectFastMetrics(), this.sampleIntervalMs);
    this.diskTimer = setInterval(() => this.collectDiskMetrics(), this.diskIntervalMs);

  }

  async collectOnce() {
    this.stop();
    await this.collectDiskMetrics();
    await this.collectFastMetrics();
  }

  stop() {
    try {
      if (this.sampleTimer != null) clearInterval(this.sampleTimer);
    } catch (_) {}
    try {
      if (this.diskTimer != null) clearInterval(this.diskTimer);
    } catch (_) {}
    this.sampleTimer = null;
    this.diskTimer = null;
    this.lastNetworkStats = { rx_bytes: 0, tx_bytes: 0, timestamp: Date.now() };
  }

  async collectFastMetrics() {
    try {
      const [load, cpuTemp, netStats] = await Promise.all([si.currentLoad(), si.cpuTemperature(), si.networkStats().catch(() => [])]);
      if (this.cpuInfo === null) {
        this.cpuInfo = await si.cpu().catch(() => ({ controllers: [] }));
      }
      if (this.mem === null) {
        this.mem = await si.mem().catch(() => ({ controllers: [] }));
      }
      if (this.graphics === null) {
        this.graphics = await si.graphics().catch(() => ({ controllers: [] }));
      }
      let useCpuInfo = this.cpuInfo
        ? {
            manufacturer: this.cpuInfo.manufacturer || null,
            brand: this.cpuInfo.brand || null,
            speed: this.formatNum(this.cpuInfo.speed || null),
            performanceCores: this.cpuInfo.performanceCores || null,
            efficiencyCores: this.cpuInfo.efficiencyCores || null,
            cores: this.cpuInfo.cores || null,
          }
        : null;

      const gpuInfos = (this.graphics.controllers || []).map(g => ({
        vendor: g.vendor || null,
        model: g.model || null,
        vramTotal: g.vramTotal || g.memoryTotal || null,
        vramUtilization: this.formatNum(g.vramUtilization || g.utilizationMemory || g.memoryUtilization),
        utilizationGpu: this.formatNum(g.utilizationGpu || g.gpuUtilization),
        temperature: this.formatNum(g.temperatureGpu || g.temperature),
      }));

      // Calculate total GPU usage (average of all active GPUs)
      let totalGpuLoad = 0;
      let gpuCount = 0;
      gpuInfos.forEach(g => {
        if (g.utilizationGpu !== null && g.utilizationGpu !== undefined) {
          totalGpuLoad += g.utilizationGpu;
          gpuCount++;
        }
      });
      const avgGpuLoad = gpuCount > 0 ? this.formatNum(totalGpuLoad / gpuCount) : 0;

      // 简化网络信息处理
      const networkInterfaces = Array.isArray(netStats)
        ? netStats.map(n => ({
            iface: n.iface,
            operstate: n.operstate,
            rx_bytes: n.rx_bytes,
            tx_bytes: n.tx_bytes,
          }))
        : [];

      // 计算总的上传和下载字节数
      const currentNetworkStats = networkInterfaces.reduce(
        (acc, n) => ({
          rx_bytes: acc.rx_bytes + (n.rx_bytes || 0),
          tx_bytes: acc.tx_bytes + (n.tx_bytes || 0),
        }),
        { rx_bytes: 0, tx_bytes: 0 }
      );

      // 计算3秒内的平均网络速度
      const networkSpeed = this.calculateNetworkSpeed(currentNetworkStats);

      const cpuTemperatureSamples = this.collectTemperatureSamples(cpuTemp);
      const cpuTemperature = cpuTemperatureSamples.length > 0 ? cpuTemperatureSamples[0] : null;
      const cpuTemperatureMax = cpuTemperatureSamples.length > 0 ? Math.max(...cpuTemperatureSamples) : null;

      // 格式化内存信息
      const memoryInfo = {
        total: this.mem.total,
        used: this.mem.used,
        free: this.mem.free,
        available: this.mem.available,
        usage: this.formatNum(this.mem.total ? (this.mem.used / this.mem.total) * 100 : 0),
        // 新增：格式化后的容量
        totalFormatted: hwUtil.formatBytes(this.mem.total),
        usedFormatted: hwUtil.formatBytes(this.mem.used),
        freeFormatted: hwUtil.formatBytes(this.mem.free),
        availableFormatted: hwUtil.formatBytes(this.mem.available),
      };
      const payload = {
        timestamp: Date.now(),
        cpuInfo: useCpuInfo || null,
        cpu: {
          usage: this.formatNum(load.currentLoad),
          avgLoad: load.avgLoad || null,
          // cpus: load.cpus || [],
          temperature: cpuTemperature,
          temperatureMax: cpuTemperatureMax,
          coreTemperatures: cpuTemperatureSamples,
        },
        gpu: {
          controllers: gpuInfos,
          usage: avgGpuLoad,
        },
        memory: memoryInfo,
        network: networkSpeed,
        disks: this.lastDiskStats,
      };
      // IPC 通道已断开时 process.send 会以异步 'error' 事件的形式抛出
      // ERR_IPC_CHANNEL_CLOSED，而 process 上没有 'error' 监听器，Node 会把它
      // 当作未捕获异常直接终结整个后台任务进程（见 installIpcErrorGuard）
      this._sendToParent({ type: 'hwMetrics', data: payload });
    } catch (error) {
      Logger.error('❌ Quick hardware metrics failed', error);
    }
  }

  /**
   * 向主进程发送消息。
   * 主进程退出/重载后通道会关闭，此时 process.send 返回 false 或抛错；
   * 这里统一兜住，避免把一次“父进程已经不在了”升级成 worker 崩溃。
   */
  _sendToParent(message) {
    try {
      if (process.connected === false) return false;
      if (typeof process.send !== 'function') return false;
      return process.send(message) !== false;
    } catch (_) {
      return false;
    }
  }

  async collectDiskMetrics() {
    try {
      const fsSizes = await si.fsSize().catch(() => []);
      let useSize = [];
      //根据平台处理
      if (os.platform() == 'darwin') {
        for (let fs of fsSizes) {
          // 过滤出根目录的磁盘指标
          if (fs.mount == '/') {
            useSize.push(fs);
          }
        }
        if (useSize.length == 0) {
          useSize = fsSizes.length > 0 ? [fsSizes[0]] : [];
        }
      } else {
        useSize = fsSizes;
      }

      const usage = useSize.map(fs => ({
        fs: fs.fs || fs.mount || null,
        type: fs.type || null,
        available: fs.available || null,
        mount: fs.mount || null,
        // 新增：格式化后的容量
        sizeFormatted: hwUtil.formatBytes(fs.size || 0, true),
        availableFormatted: fs.available ? hwUtil.formatBytes(fs.available, true) : '0 B',
      }));

      this.lastDiskStats = {
        usage,
      };
      // Logger.debug('🧮 更新磁盘指标');
    } catch (error) {
      Logger.error('❌ Disk metrics failed', error);
    }
  }
}

module.exports = HardwareMonitor;
// 该模块由 backgroundTaskWorker 在入口处 require，模块加载即装上进程级兜底，
// 这样即使 HardwareMonitor 尚未实例化也不会漏掉早期的异步 'error' 事件。
installIpcErrorGuard();
