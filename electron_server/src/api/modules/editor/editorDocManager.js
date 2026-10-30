const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Y = require('yjs');

const MAX_EDITOR_FILE_BYTES = 20 * 1024 * 1024;

// 无客户端连接的 doc 空闲多久后回收
const EDITOR_DOC_IDLE_MS = 5 * 60 * 1000;
// 回收扫描周期
const EDITOR_SWEEP_INTERVAL_MS = 60 * 1000;
// 文件变更事件合并窗口：一次 writeFile 会触发多条 inotify 事件
const EDITOR_WATCH_DEBOUNCE_MS = 60;

// ---- 跨 worker 写盘互斥锁 ----
// expressWorker 是 cluster.fork 出来的，多个 worker 可能同时抱着同一个文件的 doc。
// 锁目录放在用户数据目录下，两个 worker 看到的是同一个路径；
// 用 mkdir 的原子性当互斥锁，避免引入原生依赖（fs-ext 未打包）。
const EDITOR_LOCK_ROOT = path.join(process.env['userDataFolder'] || os.tmpdir(), 'editor_locks');
// 持锁进程若崩在临界区里，锁目录不会自己消失，超过这个时间就强行破除
const EDITOR_LOCK_STALE_MS = 5000;
const EDITOR_LOCK_WAIT_STEP_MS = 2;
const EDITOR_LOCK_WAIT_MAX_MS = 3000;

/**
 * 计算 oldText -> newText 的文本增量，返回 retain/delete/insert 指令。
 * 与 Flutter 端 _diffToOps 同一套前缀/后缀对齐算法，保证两端算出来的 op 一致。
 */
function diffTextOps(oldText, newText) {
  const a = typeof oldText === 'string' ? oldText : '';
  const b = typeof newText === 'string' ? newText : '';
  let prefix = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const deleted = a.length - prefix - suffix;
  const inserted = b.slice(prefix, b.length - suffix);
  const ops = [];
  if (prefix > 0) ops.push({ retain: prefix });
  if (deleted > 0) ops.push({ delete: deleted });
  if (inserted) ops.push({ insert: inserted });
  return ops;
}

async function acquireEditorLock(key) {
  const dir = path.join(EDITOR_LOCK_ROOT, String(key));
  const deadline = Date.now() + EDITOR_LOCK_WAIT_MAX_MS;
  for (;;) {
    try {
      await fs.promises.mkdir(EDITOR_LOCK_ROOT, { recursive: true });
    } catch (_) {}
    try {
      await fs.promises.mkdir(dir);
      return dir;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return null;
      try {
        const st = await fs.promises.stat(dir);
        if (Date.now() - st.mtimeMs > EDITOR_LOCK_STALE_MS) {
          await fs.promises.rm(dir, { recursive: true, force: true });
          continue;
        }
      } catch (_) {
        continue; // 锁已消失，立刻重试
      }
      if (Date.now() >= deadline) return null;
      await new Promise(r => setTimeout(r, EDITOR_LOCK_WAIT_STEP_MS));
    }
  }
}

function releaseEditorLock(dir) {
  if (!dir) return;
  fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
}

function buildDocId(filePath) {
  return crypto.createHash('sha1').update(String(filePath)).digest('hex');
}

function isValidOp(op) {
  if (!op || typeof op !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(op, 'retain')) {
    const n = Number(op.retain);
    return Number.isFinite(n) && n >= 0;
  }
  if (Object.prototype.hasOwnProperty.call(op, 'delete')) {
    const n = Number(op.delete);
    return Number.isFinite(n) && n >= 0;
  }
  if (Object.prototype.hasOwnProperty.call(op, 'insert')) {
    return typeof op.insert === 'string';
  }
  return false;
}

function normalizeOps(rawOps) {
  if (!Array.isArray(rawOps)) return null;
  const ops = [];
  for (const op of rawOps) {
    if (!isValidOp(op)) return null;
    if (op.retain !== undefined) {
      const n = Math.trunc(Number(op.retain));
      if (n > 0) ops.push({ retain: n });
    } else if (op.delete !== undefined) {
      const n = Math.trunc(Number(op.delete));
      if (n > 0) ops.push({ delete: n });
    } else if (op.insert !== undefined) {
      const s = String(op.insert);
      if (s.length > 0) ops.push({ insert: s });
    }
  }
  return ops;
}

function applyOpsToYText(ytext, ops) {
  let index = 0;
  const len = ytext.length;
  for (const op of ops) {
    if (op.retain !== undefined) {
      index += op.retain;
      continue;
    }
    if (op.delete !== undefined) {
      const del = op.delete;
      if (del > 0) {
        const safeIndex = Math.max(0, Math.min(index, ytext.length));
        const safeDel = Math.max(0, Math.min(del, ytext.length - safeIndex));
        if (safeDel > 0) {
          ytext.delete(safeIndex, safeDel);
        }
      }
      continue;
    }
    if (op.insert !== undefined) {
      const ins = op.insert;
      if (ins) {
        const safeIndex = Math.max(0, Math.min(index, ytext.length));
        ytext.insert(safeIndex, ins);
        index += ins.length;
      }
    }
  }
  if (index < 0 || index > len + 1) {
    return;
  }
}

class EditorDocManager {
  constructor() {
    this._docs = new Map();
    // 正在创建中的 doc：docId -> Promise<docInfo>
    // open() 里 stat/readFile 都是异步的，同一 worker 上多个 WS 几乎同时握手时，
    // 它们都会走过 "map 里没有" 这一分支，各自 new 一个 docInfo，
    // 后一个 _docs.set 把前一个顶掉——被顶掉的那份仍持有 watcher 和客户端，
    // 却再也拿不到别人的 op，watcher 触发的磁盘合并也会被判定为 stale 而丢弃。
    this._opening = new Map();
    this._startSweep();
  }

  _startSweep() {
    if (this._sweepTimer) return;
    this._sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const docInfo of this._docs.values()) {
        if (docInfo.clients.size > 0) continue;
        if (now - docInfo.lastAccessAt < EDITOR_DOC_IDLE_MS) continue;
        this._reapDoc(docInfo);
      }
    }, EDITOR_SWEEP_INTERVAL_MS);
    if (typeof this._sweepTimer.unref === 'function') this._sweepTimer.unref();
  }

  _reapDoc(docInfo) {
    if (!docInfo) return;
    this._stopWatch(docInfo);
    if (this._docs.get(docInfo.docId) === docInfo) this._docs.delete(docInfo.docId);
    try {
      docInfo.ydoc.destroy();
    } catch (_) {}
  }

  _stopWatch(docInfo) {
    if (docInfo.watchTimer) {
      clearTimeout(docInfo.watchTimer);
      docInfo.watchTimer = null;
    }
    const w = docInfo.watcher;
    docInfo.watcher = null;
    if (w) {
      try {
        w.close();
      } catch (_) {}
    }
  }

  _startWatch(docInfo, force) {
    if (!docInfo || !docInfo.filePath) return;
    if (docInfo.watcher) {
      // 默认不重复挂；force 表示"这条可能已经失效，先收掉再挂"。
      // 失效的 watcher 对象仍然非空（内核早已撤掉 inotify），光看 watcher
      // 是否为空判断不出死活，所以必须由调用方明确要求强制重挂。
      if (!force) return;
      this._stopWatch(docInfo);
    }
    try {
      const w = fs.watch(docInfo.filePath, { persistent: false }, eventType => {
        this._onWatchEvent(docInfo, eventType);
      });
      w.on('error', () => {
        if (docInfo.watcher === w) this._stopWatch(docInfo);
      });
      docInfo.watcher = w;
    } catch (e) {
      docInfo.watcher = null;
    }
  }

  /**
   * 换一条新的 fs.watch。rename（删除 / mv 原子替换）之后内核会发 IN_IGNORED
   * 把这条 inotify 撤掉，而且它盯的是旧 inode——文件重新创建出来也再也收不到事件。
   * 此时 docInfo.watcher 还挂着那个死对象，不主动换掉的话这个文件在当前 doc 的
   * 整个存活期里对外部改动都是聋的：别的进程/worker 改了内容，本地的在线客户端
   * 永远收不到 op，自己一保存还会把对方的改动整篇覆盖掉。
   * 文件可能还没被重新创建出来（原子保存的窗口期），fs.watch 会抛 ENOENT，
   * 这里退避重试一段时间。
   */
  _rearmWatch(docInfo, attempt) {
    const n = attempt || 0;
    if (!docInfo || !docInfo.filePath) return;
    if (this._docs.get(docInfo.docId) !== docInfo) return; // doc 已被回收/顶掉
    // 注意：这里不能因为 docInfo.watcher 非空就跳过。IN_IGNORED 之后内核撤掉了
    // inotify，但这个 JS 对象还挂在 docInfo.watcher 上——"非空"恰恰说明它已经死了。
    // _startWatch(force) 内部会先 _stopWatch 收掉死对象再挂新的，所以无条件走一遍。
    this._startWatch(docInfo, true);
    if (!docInfo.watcher && n < 50) {
      const t = setTimeout(() => this._rearmWatch(docInfo, n + 1), 100);
      if (typeof t.unref === 'function') t.unref();
    }
  }

  _onWatchEvent(docInfo, eventType) {
    // rename 之后必须立刻换 watcher；放在 _refreshFromDisk 里等 stat 成功是没用的——
    // 文件恰恰是在这一刻不在的，stat 失败会直接 return，重挂永远等不到。
    // 先重挂再排刷新：_startWatch(force) 内部的 _stopWatch 会清掉 watchTimer。
    if (eventType === 'rename') this._rearmWatch(docInfo, 0);
    if (docInfo.watchTimer) clearTimeout(docInfo.watchTimer);
    docInfo.watchTimer = setTimeout(() => {
      docInfo.watchTimer = null;
      this._refreshFromDisk(docInfo).catch(() => null);
    }, EDITOR_WATCH_DEBOUNCE_MS);
  }

  async _refreshFromDisk(docInfo) {
    if (!docInfo) return;
    if (this._docs.get(docInfo.docId) !== docInfo) {
      // 已经被更新的 doc 顶掉了：它不在 map 里，客户端拿不到它的广播，
      // 合并进去只会和现任 doc 各说各话。收掉 watcher，别再刷屏。
      this._stopWatch(docInfo);
      return;
    }
    const st = await fs.promises.stat(docInfo.filePath).catch(() => null);
    if (!st || !st.isFile()) return; // 被删/改名：保留内存 doc，等下次 open
    const content = await fs.promises.readFile(docInfo.filePath, 'utf8').catch(() => null);
    if (content === null) return;
    // 磁盘就是我们自己上次写出去的内容：要么 doc 没动（等于它），
    // 要么 doc 上还有未落盘的客户端 op —— 两种情况都不需要合并
    if (content === docInfo.lastWritten) return;
    if (content === docInfo.ytext.toString()) {
      docInfo.lastWritten = content;
      return;
    }
    await this._mergeExternalChange(docInfo);
  }

  /**
   * 把磁盘上的外来改动合并进 doc：算出"相对上次写出的文本"的增量，套到 doc 上，
   * 再以 op 广播给本 worker 的客户端。全程持锁，避免和正在写的另一个 worker 撞上。
   */
  async _mergeExternalChange(docInfo) {
    const lockDir = await acquireEditorLock(docInfo.docId);
    try {
      const disk = await fs.promises.readFile(docInfo.filePath, 'utf8').catch(() => null);
      if (disk === null) return;
      const current = docInfo.ytext ? docInfo.ytext.toString() : '';
      if (disk === current) {
        docInfo.lastWritten = disk;
        return;
      }
      const base = typeof docInfo.lastWritten === 'string' ? docInfo.lastWritten : current;
      const ops = diffTextOps(base, disk);
      if (ops.length) {
        this._applyRemoteOps(docInfo, ops);
      }
      docInfo.lastWritten = disk;
    } finally {
      releaseEditorLock(lockDir);
    }
  }

  /**
   * 落盘：先在临界区里重读磁盘合并外来增量，再整篇写回。
   * 少了重读这一步，两个 worker 各自 scheduleSave 时后写的会把先写的整篇覆盖掉。
   */
  async _writeDocLocked(docInfo) {
    if (!docInfo || !docInfo.filePath) return;
    const lockDir = await acquireEditorLock(docInfo.docId);
    try {
      const disk = await fs.promises.readFile(docInfo.filePath, 'utf8').catch(() => null);
      if (disk !== null && disk !== docInfo.lastWritten) {
        const current = docInfo.ytext ? docInfo.ytext.toString() : '';
        if (disk !== current) {
          const base = typeof docInfo.lastWritten === 'string' ? docInfo.lastWritten : current;
          const ops = diffTextOps(base, disk);
          if (ops.length) this._applyRemoteOps(docInfo, ops);
        }
        docInfo.lastWritten = disk;
      }
      const text = docInfo.ytext ? docInfo.ytext.toString() : '';
      await fs.promises.writeFile(docInfo.filePath, text, 'utf8');
      this._markWritten(docInfo, text);
    } finally {
      releaseEditorLock(lockDir);
    }
  }

  /**
   * 外部（HTTP /api/editor/save）指定了整篇内容：加锁写盘，然后把内存 doc
   * 换成这个内容。这里必须是整篇替换而不是合并——用户明确要的就是这段文本。
   */
  async overwriteFromExternal(docInfo, text) {
    if (!docInfo || !docInfo.filePath) return;
    const next = typeof text === 'string' ? text : '';
    const lockDir = await acquireEditorLock(docInfo.docId);
    try {
      await fs.promises.writeFile(docInfo.filePath, next, 'utf8');
      this._markWritten(docInfo, next);
    } finally {
      releaseEditorLock(lockDir);
    }
    this.resyncFromText(docInfo, next);
  }

  /**
   * 把一批 op 应用到 doc 并广播给本 worker 的所有客户端。
   * 与 applyOps 的区别：广播对象是全部客户端（这些 op 来自别的 worker/外部写入，
   * 本 worker 没有任何一个客户端是发起者），且不参与 baseRev 校验。
   */
  _applyRemoteOps(docInfo, ops) {
    const normalized = normalizeOps(ops);
    if (!normalized || !normalized.length) return { ok: false, reason: 'invalid_ops' };
    docInfo.ydoc.transact(() => {
      applyOpsToYText(docInfo.ytext, normalized);
    });
    docInfo.rev += 1;
    docInfo.lastAccessAt = Date.now();
    const payload = JSON.stringify({ type: 'op', rev: docInfo.rev, ops: normalized });
    for (const client of docInfo.clients) {
      if (!client || client.readyState !== 1) continue;
      try {
        client.send(payload);
      } catch (_) {}
    }
    return { ok: true, rev: docInfo.rev, clients: docInfo.clients.size };
  }

  _markWritten(docInfo, text) {
    docInfo.lastWritten = typeof text === 'string' ? text : '';
  }

  _flushSaveNow(docInfo) {
    if (!docInfo || !docInfo.filePath) return;
    this._writeDocLocked(docInfo).catch(() => null);
  }

  async open({ filePath }) {
    const resolved = path.resolve(String(filePath));
    const st = await fs.promises.stat(resolved).catch(() => null);
    if (!st || !st.isFile()) {
      const err = new Error('common.NOT_FOUND');
      err.statusCode = 404;
      throw err;
    }
    if (st.size > MAX_EDITOR_FILE_BYTES) {
      const err = new Error('editor.FILE_TOO_LARGE');
      err.statusCode = 413;
      throw err;
    }
    const docId = buildDocId(resolved);
    const existing = this._docs.get(docId);
    if (existing) {
      existing.lastAccessAt = Date.now();
      if (existing.clients.size === 0) {
        // force：这条 watcher 可能已经被 rename 打死（对象还在、inotify 已撤），
        // 重新打开文件正是换掉它的时机。紧接着还会按磁盘重放一遍文本。
        this._startWatch(existing, true);
        const content = await fs.promises.readFile(resolved, 'utf8').catch(() => null);
        if (content !== null) {
          const currentText = existing.ytext.toString();
          if (currentText !== content) {
            existing.ydoc.transact(() => {
              existing.ytext.delete(0, existing.ytext.length);
              if (content) {
                existing.ytext.insert(0, content);
              }
            });
            existing.rev = 0;
          }
          // 重新打开时以磁盘为准，lastWritten 也要跟着重置，
          // 否则后面算"外来增量"会拿一个过期基线去 diff
          existing.lastWritten = content;
        }
      }
      return existing;
    }
    // 同一个文件正在被别的握手创建：直接复用那一份，绝不能再 new 一个。
    // 少这一步，同一 worker 上先后接进来的客户端会拿到不同的 docInfo，
    // 只有最后 set 进 map 的那份能收到广播，另一份的客户端对整个协作不可见。
    const inflight = this._opening.get(docId);
    if (inflight) return inflight;
    const created = this._createDoc(docId, resolved);
    this._opening.set(docId, created);
    try {
      return await created;
    } finally {
      this._opening.delete(docId);
    }
  }

  async _createDoc(docId, resolved) {
    const content = await fs.promises.readFile(resolved, 'utf8');

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    if (content) {
      ytext.insert(0, content);
    }

    const docInfo = {
      docId,
      filePath: resolved,
      ydoc,
      ytext,
      rev: 0,
      clients: new Set(),
      saveTimer: null,
      lastAccessAt: Date.now(),
      fsWritable: true,
      lastWritten: typeof content === 'string' ? content : '',
      watcher: null,
      watchTimer: null,
    };
    this._docs.set(docId, docInfo);
    this._startWatch(docInfo);
    return docInfo;
  }

  getById(docId) {
    return this._docs.get(String(docId));
  }

  getByPath(filePath) {
    return this._docs.get(buildDocId(path.resolve(String(filePath))));
  }

  /**
   * 磁盘内容被外部改写（HTTP /api/editor/save、别的编辑器、同步任务）后，
   * 把内存里的 Yjs doc 同步成新的磁盘文本，并通知所有在线客户端重拉。
   *
   * 不这么做的话：HTTP save 只写文件，内存 doc 仍是旧文本；在线客户端的下一条 op
   * 会基于旧文本计算，接着 scheduleSave 又把旧文本整篇写回磁盘，
   * 用户刚保存的内容就静默丢失了。
   *
   * 客户端收到 resync 会走 _applyRemoteSnapshot：自己有未发送的本地编辑时
   * 会先 diff 成 op 重发，所以待发送内容不会丢。
   */
  resyncFromText(docInfo, text) {
    if (!docInfo || !docInfo.ydoc || !docInfo.ytext) return { ok: false, reason: 'no_doc' };
    const next = typeof text === 'string' ? text : '';
    if (docInfo.saveTimer) {
      clearTimeout(docInfo.saveTimer);
      docInfo.saveTimer = null;
    }
    docInfo.ydoc.transact(() => {
      docInfo.ytext.delete(0, docInfo.ytext.length);
      if (next) docInfo.ytext.insert(0, next);
    });
    docInfo.rev += 1;
    docInfo.lastAccessAt = Date.now();
    const payload = JSON.stringify({ type: 'resync', docId: docInfo.docId, rev: docInfo.rev, text: next });
    for (const client of docInfo.clients) {
      if (!client || client.readyState !== 1) continue;
      try {
        client.send(payload);
      } catch (_) {}
    }
    return { ok: true, rev: docInfo.rev, clients: docInfo.clients.size };
  }

  attachClient(docInfo, ws) {
    docInfo.clients.add(ws);
    docInfo.lastAccessAt = Date.now();
    // 挂客户端时强制重挂一次：rename 触发的那次 _rearmWatch 有 5s 退避上限，
    // 文件若被删了更久才重建，watcher 就一直是死的——而这个 doc 只要有客户端
    // 挂着就永远不会被 sweep 回收，从此对外部改动全聋。这里无条件补挂一次自愈。
    this._startWatch(docInfo, true);
  }

  detachClient(docInfo, ws) {
    docInfo.clients.delete(ws);
    docInfo.lastAccessAt = Date.now();
    if (docInfo.clients.size === 0) {
      if (docInfo.saveTimer) {
        clearTimeout(docInfo.saveTimer);
        docInfo.saveTimer = null;
        this._flushSaveNow(docInfo);
      }
      setTimeout(() => {
        const current = this._docs.get(docInfo.docId);
        if (!current) return;
        if (current.clients.size > 0) return;
        if (Date.now() - current.lastAccessAt >= EDITOR_DOC_IDLE_MS) {
          this._reapDoc(current);
        }
      }, 10 * 1000);
    }
  }

  scheduleSave(docInfo, { delayMs = 800, onError } = {}) {
    if (docInfo.saveTimer) clearTimeout(docInfo.saveTimer);
    docInfo.saveTimer = setTimeout(
      async () => {
        docInfo.saveTimer = null;
        try {
          await this._writeDocLocked(docInfo);
        } catch (e) {
          if (typeof onError === 'function') onError(e);
        }
      },
      Math.max(50, Number(delayMs) || 800)
    );
  }

  applyOps(docInfo, ops) {
    const normalized = normalizeOps(ops);
    if (!normalized) return { ok: false, reason: 'invalid_ops' };

    docInfo.ydoc.transact(() => {
      applyOpsToYText(docInfo.ytext, normalized);
    });
    docInfo.rev += 1;
    docInfo.lastAccessAt = Date.now();
    return { ok: true, rev: docInfo.rev, ops: normalized };
  }
}

module.exports = {
  EditorDocManager,
  buildDocId,
  normalizeOps,
};
