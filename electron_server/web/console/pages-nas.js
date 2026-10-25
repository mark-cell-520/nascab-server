(function () {
'use strict';

/* ============================================================
   NAS 能力页面：挂载管理 / 分享管理 / 下载器 / 容器
   ============================================================ */
window.NasCabPages = window.NasCabPages || [];

function __register(N) {
  const { api, toast, escapeHtml, fmtBytes, fmtTime, pct } = N;
  const $ = N.$, $$ = N.$$;

  const I = {
    disk: '<svg viewBox="0 0 20 20"><ellipse cx="10" cy="5.2" rx="6.5" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 5.2v9.6c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6V5.2M3.5 10c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    cloud: '<svg viewBox="0 0 20 20"><path d="M6 14.5a3 3 0 01-.3-6 4.2 4.2 0 017.9-1.2 3.4 3.4 0 01.6 6.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    share: '<svg viewBox="0 0 20 20"><circle cx="6" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="14.5" cy="5.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="14.5" cy="14.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8.2 9l4.1-2.6M8.2 11l4.1 2.6" stroke="currentColor" stroke-width="1.5"/></svg>',
    dl: '<svg viewBox="0 0 20 20"><path d="M10 3.5v8M6.5 8L10 11.5 13.5 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14.5h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    box: '<svg viewBox="0 0 20 20"><path d="M10 2.8l6.5 3.4v7.6L10 17.2 3.5 13.8V6.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3.5 6.2L10 9.6l6.5-3.4M10 9.6v7.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    play: '<svg viewBox="0 0 20 20"><path d="M7 5.5l7 4.5-7 4.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    stop: '<svg viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><path d="M4.5 6.5h11M8 6.5V4.8h4v1.7M6 6.5l.7 9h6.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    refresh: '<svg viewBox="0 0 20 20"><path d="M15 10a5 5 0 11-1.6-3.7M15 3.5V7h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 20 20"><path d="M10 5v10M5 10h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };

  const tag = (text, kind) => `<span class="tag ${kind ? `tag--${kind}` : ''}">${escapeHtml(text)}</span>`;
  const emptyCard = msg => `<div class="card"><div class="card__body"><div class="empty">${escapeHtml(msg)}</div></div></div>`;
  const refreshBtn = (id, label) => `<button class="btn btn--ghost btn--sm" id="${id}">${I.refresh}${escapeHtml(label || '刷新')}</button>`;

  function errBox(err) {
    return `<div class="card"><div class="card__body"><div class="empty">${escapeHtml(err.message || '加载失败')}</div></div></div>`;
  }

  /* ================= 挂载管理 ================= */
  async function renderMounts(body, actions) {
    actions.innerHTML = refreshBtn('mounts-refresh') +
      `<button class="btn btn--primary btn--sm" id="mounts-add">${I.plus}添加共享目录</button>`;
    body.innerHTML = `<div class="grid" style="gap:14px">
      <div class="card"><div class="card__head"><h3 class="card__title">${I.disk}共享目录</h3><span class="card__extra">文件管理器的可见根目录</span></div>
        <div class="card__body" id="mounts-share"><div class="skeleton" style="width:50%"></div></div></div>
      <div class="card"><div class="card__head"><h3 class="card__title">${I.disk}本地挂载</h3><span class="card__extra">Windows 依赖 WinFsp</span></div>
        <div class="card__body" id="mounts-local"><div class="skeleton" style="width:50%"></div></div></div>
      <div class="card"><div class="card__head"><h3 class="card__title">${I.cloud}云盘挂载</h3><span class="card__extra">OpenList / Alist 驱动</span></div>
        <div class="card__body" id="mounts-cloud"><div class="skeleton" style="width:50%"></div></div></div>
    </div>`;
    $('#mounts-refresh').addEventListener('click', () => N.route('mounts'));
    $('#mounts-add').addEventListener('click', promptAddShareFolder);
    await Promise.all([loadShareFolders(), loadLocalMounts(), loadCloudMounts()]);
  }

  async function loadShareFolders() {
    const box = $('#mounts-share');
    if (!box) return;
    try {
      const data = await api.get('/api/file/userShareFolder/list');
      const items = (data.data && data.data.items) || [];
      if (!items.length) { box.innerHTML = '<div class="empty">还没有共享目录</div>'; return; }
      box.innerHTML = `<div class="grid" style="gap:10px">${items.map(r => `
        <div class="nasrow">
          <span class="nasrow__icon ${r.exists ? 'is-ok' : 'is-err'}">${I.disk}</span>
          <div class="nasrow__main">
            <div class="nasrow__title">${escapeHtml(r.name || r.path)}</div>
            <div class="nasrow__sub mono">${escapeHtml(r.path)}</div>
          </div>
          ${tag(r.exists ? (r.allowDownload ? '可下载' : '仅浏览') : '路径不存在', r.exists ? 'ok' : 'err')}
          <div class="nasrow__actions">
            <button class="btn btn--ghost btn--sm" data-share-open="${escapeHtml(r.path)}">打开</button>
            <button class="btn btn--ghost btn--sm" data-share-del="${escapeHtml(r.path)}" style="color:var(--danger)">移除</button>
          </div>
        </div>`).join('')}</div>`;
      $$('[data-share-open]', box).forEach(b => b.addEventListener('click', () => N.route('files')));
      $$('[data-share-del]', box).forEach(b => b.addEventListener('click', async () => {
        if (!confirm(`确定把 ${b.dataset.shareDel} 从共享目录移除？不会删除磁盘上的文件。`)) return;
        try {
          await api.post('/api/file/userShareFolder/remove', { path: b.dataset.shareDel });
          toast('已移除', 'ok');
          N.route('mounts');
        } catch (err) { toast(err.message || '移除失败'); }
      }));
    } catch (err) {
      box.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  function promptAddShareFolder() {
    openShareModal();
  }

  /** 添加共享目录弹层（文件管理页与挂载页共用） */
  function openShareModal() {
    closeShareModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.id = 'nas-modal';
    wrap.innerHTML = `
      <div class="modal__mask" data-close></div>
      <div class="modal__box">
        <h3 class="modal__title">添加共享目录</h3>
        <label class="field" style="margin-bottom:12px">
          <span class="field__label">服务器上的绝对路径</span>
          <span class="field__box"><input id="nas-share-path" type="text" placeholder="例如 D:\\media 或 /srv/media"></span>
        </label>
        <label class="field" style="margin-bottom:12px">
          <span class="field__label">显示名称（留空用文件夹名）</span>
          <span class="field__box"><input id="nas-share-name" type="text" placeholder="例如 媒体库"></span>
        </label>
        <p class="auth__error" id="nas-share-error" hidden></p>
        <div class="modal__foot">
          <button class="btn btn--ghost" data-close>取消</button>
          <button class="btn btn--primary" id="nas-share-ok">添加</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const input = $('#nas-share-path');
    if (input) input.focus();
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeShareModal));
    $('#nas-share-ok').addEventListener('click', async () => {
      const p = $('#nas-share-path').value.trim();
      const n = $('#nas-share-name').value.trim();
      const err = $('#nas-share-error');
      if (!p) { err.textContent = '路径不能为空'; err.hidden = false; return; }
      try {
        await api.post('/api/file/userShareFolder/add', { path: p, name: n, allowDownload: true });
        closeShareModal();
        toast('共享目录已添加', 'ok');
        N.route('mounts');
      } catch (e) {
        err.textContent = e.message || '添加失败';
        err.hidden = false;
      }
    });
  }

  function closeShareModal() {
    const m = $('#nas-modal');
    if (m) m.remove();
  }

  async function loadLocalMounts() {
    const box = $('#mounts-local');
    if (!box) return;
    try {
      const data = await api.post('/api/fileMount/list', { page: 1, limit: 50 });
      const items = (data.data && (data.data.items || data.data)) || [];
      if (!items.length) { box.innerHTML = '<div class="empty">还没有本地挂载</div>'; return; }
      box.innerHTML = `<div class="grid" style="gap:10px">${items.map(m => `
        <div class="nasrow">
          <span class="nasrow__icon ${m.status === 'running' || m.enabled ? 'is-ok' : 'is-warn'}">${I.disk}</span>
          <div class="nasrow__main">
            <div class="nasrow__title">${escapeHtml(m.name || m.mount_name || '未命名挂载')}</div>
            <div class="nasrow__sub mono">${escapeHtml(m.path || m.local_path || '')}${m.mount_point ? ' → ' + escapeHtml(m.mount_point) : ''}</div>
          </div>
          ${tag(m.status || (m.enabled ? '已启用' : '已停止'), (m.status === 'running' || m.enabled) ? 'ok' : '')}
          <div class="nasrow__actions">
            ${(m.status === 'running' || m.enabled)
              ? `<button class="btn btn--ghost btn--sm" data-mount-stop="${escapeHtml(m.id)}">停止</button>`
              : `<button class="btn btn--ghost btn--sm" data-mount-start="${escapeHtml(m.id)}">启动</button>`}
          </div>
        </div>`).join('')}</div>`;
      bindMountActions(box, '/api/fileMount');
    } catch (err) {
      box.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadCloudMounts() {
    const box = $('#mounts-cloud');
    if (!box) return;
    try {
      const data = await api.post('/api/openlistMount/list', { page: 1, limit: 50 });
      const items = (data.data && (data.data.items || data.data)) || [];
      if (!items.length) { box.innerHTML = '<div class="empty">还没有云盘挂载</div>'; return; }
      box.innerHTML = `<div class="grid" style="gap:10px">${items.map(m => `
        <div class="nasrow">
          <span class="nasrow__icon ${m.status === 'running' || m.enabled ? 'is-ok' : 'is-warn'}">${I.cloud}</span>
          <div class="nasrow__main">
            <div class="nasrow__title">${escapeHtml(m.name || m.mount_name || '未命名挂载')}</div>
            <div class="nasrow__sub">${escapeHtml(m.driver || m.type || '')}${m.mount_point ? ' · ' + escapeHtml(m.mount_point) : ''}</div>
          </div>
          ${tag(m.status || (m.enabled ? '已启用' : '已停止'), (m.status === 'running' || m.enabled) ? 'ok' : '')}
          <div class="nasrow__actions">
            ${(m.status === 'running' || m.enabled)
              ? `<button class="btn btn--ghost btn--sm" data-mount-stop="${escapeHtml(m.id)}">停止</button>`
              : `<button class="btn btn--ghost btn--sm" data-mount-start="${escapeHtml(m.id)}">启动</button>`}
          </div>
        </div>`).join('')}</div>`;
      bindMountActions(box, '/api/openlistMount');
    } catch (err) {
      box.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  function bindMountActions(box, base) {
    $$('[data-mount-start]', box).forEach(b => b.addEventListener('click', async () => {
      try { await api.post(`${base}/start`, { id: b.dataset.mountStart }); toast('已启动', 'ok'); N.route('mounts'); }
      catch (err) { toast(err.message || '启动失败'); }
    }));
    $$('[data-mount-stop]', box).forEach(b => b.addEventListener('click', async () => {
      try { await api.post(`${base}/stop`, { id: b.dataset.mountStop }); toast('已停止', 'ok'); N.route('mounts'); }
      catch (err) { toast(err.message || '停止失败'); }
    }));
  }

  /* ================= 分享管理 ================= */
  async function renderShares(body, actions) {
    actions.innerHTML = refreshBtn('shares-refresh') +
      `<button class="btn btn--ghost btn--sm" id="shares-clean">清理过期</button>`;
    body.innerHTML = `<div class="card">
      <div class="card__head"><h3 class="card__title">${I.share}分享链接</h3><span class="card__extra" id="shares-count"></span></div>
      <div class="card__body" id="shares-body"><div class="skeleton" style="width:50%"></div></div></div>`;
    $('#shares-refresh').addEventListener('click', () => N.route('shares'));
    $('#shares-clean').addEventListener('click', async () => {
      try { await api.post('/api/quickShare/cleanExpired', {}); toast('已清理过期分享', 'ok'); N.route('shares'); }
      catch (err) { toast(err.message || '清理失败'); }
    });
    await loadShares();
  }

  async function loadShares() {
    const box = $('#shares-body');
    if (!box) return;
    try {
      const data = await api.get('/api/quickShare/list');
      const items = (data.data && (data.data.items || data.data)) || [];
      $('#shares-count').textContent = `${items.length} 个分享`;
      if (!items.length) { box.innerHTML = '<div class="empty">还没有创建分享。在「文件管理」里选中文件即可创建。</div>'; return; }
      box.innerHTML = `<div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>名称</th><th>路径</th><th>有效期</th><th>访问次数</th><th></th></tr></thead>
        <tbody>${items.map(s => `<tr>
          <td><strong>${escapeHtml(s.name || '未命名')}</strong>${s.has_password ? ' ' + tag('有密码', 'warn') : ''}</td>
          <td class="mono" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.path || '')}</td>
          <td class="num">${s.expire_time ? escapeHtml(fmtTime(s.expire_time)) : '永久'}</td>
          <td class="num">${escapeHtml(s.visit_count != null ? s.visit_count : (s.views != null ? s.views : '—'))}</td>
          <td class="tbl__actions">
            <button class="btn btn--ghost btn--sm" data-share-copy="${escapeHtml(s.token || s.id)}">复制链接</button>
            <button class="btn btn--ghost btn--sm" data-share-del="${escapeHtml(s.id || s.token)}" style="color:var(--danger)">删除</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`;
      $$('[data-share-copy]', box).forEach(b => b.addEventListener('click', async () => {
        const url = `${location.origin}/quickshare?token=${encodeURIComponent(b.dataset.shareCopy)}`;
        try { await navigator.clipboard.writeText(url); toast('链接已复制', 'ok'); }
        catch (_) { toast(url); }
      }));
      $$('[data-share-del]', box).forEach(b => b.addEventListener('click', async () => {
        if (!confirm('确定删除该分享？')) return;
        try { await api.post('/api/quickShare/delete', { id: b.dataset.shareDel }); toast('已删除', 'ok'); N.route('shares'); }
        catch (err) { toast(err.message || '删除失败'); }
      }));
    } catch (err) {
      box.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  /* ================= 下载器 ================= */
  let dlTimer = null;
  async function renderDownloads(body, actions) {
    actions.innerHTML = refreshBtn('dl-refresh');
    body.innerHTML = `<div class="grid grid--2">
      <div class="card"><div class="card__head"><h3 class="card__title">${I.dl}Transmission</h3><span class="card__extra" id="dl-status"></span></div>
        <div class="card__body"><dl class="kv" id="dl-kv"><div class="skeleton" style="height:32px"></div></dl></div></div>
      <div class="card"><div class="card__head"><h3 class="card__title">${I.disk}下载目录</h3></div>
        <div class="card__body" id="dl-dirs"><div class="skeleton" style="height:32px"></div></div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card__head"><h3 class="card__title">${I.dl}任务列表</h3><span class="card__extra" id="dl-count"></span></div>
      <div class="card__body" id="dl-torrents" style="padding:0"><div class="empty">加载中…</div></div></div>`;
    $('#dl-refresh').addEventListener('click', () => N.route('downloads'));
    await loadDownloads();
    dlTimer = setInterval(() => { if (N.state.page === 'downloads') loadDownloads(); }, 5000);
  }

  async function loadDownloads() {
    try {
      const [status, torrents] = await Promise.all([
        api.get('/api/transmission/status').catch(() => null),
        api.get('/api/transmission/torrents/list').catch(() => null),
      ]);
      const st = (status && status.data) || {};
      const running = st.running === true || st.status === 'running';
      $('#dl-status').innerHTML = tag(running ? '运行中' : '已停止', running ? 'ok' : 'warn');
      $('#dl-kv').innerHTML = `
        <div><dt>状态</dt><dd>${running ? '运行中' : '已停止'}</dd></div>
        <div><dt>RPC 端口</dt><dd class="num">${escapeHtml(st.rpcPort || st.port || '—')}</dd></div>
        <div><dt>下载目录</dt><dd class="mono">${escapeHtml(st.downloadDir || '—')}</dd></div>
        <div><dt>版本</dt><dd class="num">${escapeHtml(st.version || '—')}</dd></div>`;

      const list = (torrents && torrents.data && (torrents.data.torrents || torrents.data.items || torrents.data)) || [];
      const arr = Array.isArray(list) ? list : [];
      $('#dl-count').textContent = `${arr.length} 个任务`;
      const box = $('#dl-torrents');
      if (!arr.length) { box.innerHTML = '<div class="empty">暂无下载任务</div>'; return; }
      box.innerHTML = `<div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>名称</th><th style="width:130px">进度</th><th class="tbl__num">大小</th><th class="tbl__num">速率</th><th>状态</th></tr></thead>
        <tbody>${arr.map(t => {
          const p = pct((t.percentDone != null ? t.percentDone : (t.rateDownload >= 0 && t.sizeWhenDone ? (t.sizeWhenDone - t.leftUntilDone) / t.sizeWhenDone * 100 : 0)));
          return `<tr>
            <td><strong>${escapeHtml(t.name || '未命名')}</strong></td>
            <td><div class="bar"><div class="bar__fill ${p >= 100 ? '' : ''}" style="width:${p}%"></div></div><div class="card__extra num">${p.toFixed(1)}%</div></td>
            <td class="tbl__num">${escapeHtml(t.sizeWhenDone != null ? fmtBytes(t.sizeWhenDone) : '—')}</td>
            <td class="tbl__num">${escapeHtml(t.rateDownload ? fmtBytes(t.rateDownload) + '/s' : '—')}</td>
            <td>${tag(t.status || '—', t.errorString ? 'err' : (p >= 100 ? 'ok' : 'blue'))}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    } catch (err) {
      const box = $('#dl-torrents');
      if (box) box.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  /* ================= 容器 ================= */
  async function renderDocker(body, actions) {
    actions.innerHTML = refreshBtn('dk-refresh');
    body.innerHTML = `<div class="grid grid--2">
      <div class="card"><div class="card__head"><h3 class="card__title">${I.box}Docker 引擎</h3><span class="card__extra" id="dk-status"></span></div>
        <div class="card__body"><dl class="kv" id="dk-kv"><div class="skeleton" style="height:32px"></div></dl></div></div>
      <div class="card"><div class="card__head"><h3 class="card__title">${I.disk}镜像</h3><span class="card__extra" id="dk-img-count"></span></div>
        <div class="card__body" id="dk-images"><div class="skeleton" style="height:32px"></div></div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card__head"><h3 class="card__title">${I.box}容器</h3><span class="card__extra" id="dk-ct-count"></span></div>
      <div class="card__body" id="dk-containers" style="padding:0"><div class="empty">加载中…</div></div></div>`;
    $('#dk-refresh').addEventListener('click', () => N.route('docker'));
    await Promise.all([loadDockerStatus(), loadDockerImages(), loadDockerContainers()]);
  }

  async function loadDockerStatus() {
    try {
      const data = await api.get('/api/docker/status');
      const st = (data && data.data) || {};
      const ok = st.running === true || st.available === true;
      $('#dk-status').innerHTML = tag(ok ? '可用' : '不可用', ok ? 'ok' : 'warn');
      $('#dk-kv').innerHTML = `
        <div><dt>引擎状态</dt><dd>${ok ? '可用' : '不可用'}</dd></div>
        <div><dt>版本</dt><dd class="num">${escapeHtml(st.version || st.serverVersion || '—')}</dd></div>
        <div><dt>容器总数</dt><dd class="num">${escapeHtml(st.containerCount != null ? st.containerCount : (st.containers != null ? st.containers : '—'))}</dd></div>
        <div><dt>镜像总数</dt><dd class="num">${escapeHtml(st.imageCount != null ? st.imageCount : (st.images != null ? st.images : '—'))}</dd></div>`;
    } catch (err) {
      $('#dk-status').innerHTML = tag('不可用', 'warn');
      $('#dk-kv').innerHTML = `<div><dt>说明</dt><dd>${escapeHtml(err.message)}</dd></div>`;
    }
  }

  async function loadDockerImages() {
    const box = $('#dk-images');
    if (!box) return;
    try {
      const data = await api.get('/api/docker/images/list');
      const list = (data.data && (data.data.items || data.data)) || [];
      const arr = Array.isArray(list) ? list : [];
      $('#dk-img-count').textContent = `${arr.length} 个`;
      box.innerHTML = arr.length
        ? `<div class="grid" style="gap:8px">${arr.slice(0, 12).map(im => `
            <div class="nasrow"><span class="nasrow__icon">${I.disk}</span>
              <div class="nasrow__main"><div class="nasrow__title">${escapeHtml(im.repository || im.RepoTags || '未命名镜像')}</div>
              <div class="nasrow__sub mono">${escapeHtml(im.tag || (im.RepoTags && im.RepoTags[0]) || '')}</div></div>
              <span class="card__extra">${escapeHtml(im.size ? fmtBytes(im.size) : '')}</span></div>`).join('')}</div>`
        : '<div class="empty">暂无镜像</div>';
    } catch (err) {
      box.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadDockerContainers() {
    const box = $('#dk-containers');
    if (!box) return;
    try {
      const data = await api.get('/api/docker/containers/list');
      const list = (data.data && (data.data.items || data.data)) || [];
      const arr = Array.isArray(list) ? list : [];
      $('#dk-ct-count').textContent = `${arr.length} 个`;
      if (!arr.length) { box.innerHTML = '<div class="empty">暂无容器</div>'; return; }
      box.innerHTML = `<div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>名称</th><th>镜像</th><th>状态</th><th class="tbl__actions">操作</th></tr></thead>
        <tbody>${arr.map(c => {
          const running = String(c.state || c.status || '').toLowerCase().includes('run') || c.state === 'running';
          const id = escapeHtml(c.id || c.Id || '');
          return `<tr>
            <td><strong>${escapeHtml(c.name || (c.Names && c.Names[0]) || '未命名')}</strong></td>
            <td class="mono">${escapeHtml(c.image || '—')}</td>
            <td>${tag(c.state || c.status || '—', running ? 'ok' : '')}</td>
            <td class="tbl__actions">
              ${running
                ? `<button class="btn btn--ghost btn--sm" data-dk-stop="${id}">${I.stop}停止</button>`
                : `<button class="btn btn--ghost btn--sm" data-dk-start="${id}">${I.play}启动</button>`}
            </td></tr>`;
        }).join('')}</tbody></table></div>`;
      $$('[data-dk-start]', box).forEach(b => b.addEventListener('click', async () => {
        try { await api.post('/api/docker/containers/start', { id: b.dataset.dkStart }); toast('已启动', 'ok'); N.route('docker'); }
        catch (err) { toast(err.message || '启动失败'); }
      }));
      $$('[data-dk-stop]', box).forEach(b => b.addEventListener('click', async () => {
        try { await api.post('/api/docker/containers/stop', { id: b.dataset.dkStop }); toast('已停止', 'ok'); N.route('docker'); }
        catch (err) { toast(err.message || '停止失败'); }
      }));
    } catch (err) {
      box.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  /* ================= 注册 ================= */
  N.registerPage('mounts', renderMounts, { title: '挂载管理', desc: '本地磁盘与云盘挂载点' });
  N.registerPage('shares', renderShares, { title: '分享管理', desc: '对外的文件分享链接' });
  N.registerPage('downloads', renderDownloads, { title: '下载器', desc: 'Transmission 下载任务' });
  N.registerPage('docker', renderDocker, { title: '容器', desc: 'Docker 引擎、镜像与容器' });

  // 离开页面时停掉轮询
  const origRoute = N.route;
  N.route = function (id) {
    if (dlTimer) { clearInterval(dlTimer); dlTimer = null; }
    return origRoute(id);
  };

}

// console.js 已就绪就直接注册；否则等 bootPages() 兜底
window.NasCabPages.push(__register);
if (window.NasCab) {
  try { __register(window.NasCab); } catch (e) { console.error('页面模块注册失败', e); }
}

})();
