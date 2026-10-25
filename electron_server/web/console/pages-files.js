(function () {
'use strict';

/* ============================================================
   文件管理页
   依赖 console.js 暴露的 window.NasCab（api / state / toast / 格式化等）
   ============================================================ */
window.NasCabPages = window.NasCabPages || [];

function __register(N) {
  const { api, state, toast, escapeHtml, fmtBytes, fmtTime, pct } = N;
  const $ = N.$, $$ = N.$$;

  const ICON = {
    dir: '<svg class="fico is-dir" viewBox="0 0 20 20"><path d="M3 6.5a2 2 0 012-2h2.6l1.6 1.8h4.8a2 2 0 012 2v5.7a2 2 0 01-2 2h-9a2 2 0 01-2-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    img: '<svg class="fico is-img" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7.5" cy="8" r="1.3" fill="currentColor"/><path d="M4 14l3.6-3.6 2.4 2.4 2.6-2.2L16 13.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    video: '<svg class="fico is-video" viewBox="0 0 20 20"><rect x="2.5" y="4.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M13.5 8.5l4-2.2v7.4l-4-2.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    audio: '<svg class="fico is-audio" viewBox="0 0 20 20"><path d="M8 14.5V6l6-1.5v8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6.4" cy="14.6" r="1.7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12.4" cy="13" r="1.7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    doc: '<svg class="fico" viewBox="0 0 20 20"><path d="M5 3.5h6l4 4v9h-10z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 3.5v4h4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    file: '<svg class="fico" viewBox="0 0 20 20"><path d="M5 3.5h6l4 4v9h-10z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    up: '<svg viewBox="0 0 20 20"><path d="M10 13V5.5M6.5 9L10 5.5 13.5 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15.5h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    folderPlus: '<svg viewBox="0 0 20 20"><path d="M3 6.5a2 2 0 012-2h2.6l1.6 1.8h4.8a2 2 0 012 2v5.7a2 2 0 01-2 2h-9a2 2 0 01-2-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.4 12.6v-3M8 11.1h2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    refresh: '<svg viewBox="0 0 20 20"><path d="M15 10a5 5 0 11-1.6-3.7M15 3.5V7h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><path d="M4.5 6.5h11M8 6.5V4.8h4v1.7M6 6.5l.7 9h6.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 20 20"><path d="M13.5 3.5l3 3-8 8H5.5v-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    dl: '<svg viewBox="0 0 20 20"><path d="M10 4v8M6.5 8.5L10 12l3.5-3.5M4.5 15.5h11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    grid: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    list: '<svg viewBox="0 0 20 20"><path d="M6.5 5.5h10M6.5 10h10M6.5 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 20 20"><path d="M10 5v10M5 10h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };

  const fm = {
    roots: [],
    cwd: '',           // 当前目录绝对路径
    items: [],
    selected: new Set(),
    view: 'list',      // list | grid
    busy: false,
    uploads: [],
  };

  function fileIcon(item) {
    if (item.type === 'dir') return ICON.dir;
    if (item.type === 'image') return ICON.img;
    if (item.type === 'video') return ICON.video;
    if (item.type === 'audio') return ICON.audio;
    if (['text', 'doc', 'pdf', 'nfo'].includes(item.type)) return ICON.doc;
    return ICON.file;
  }

  /** 带令牌的下载/缩略图 URL */
  function authedUrl(pathname, params) {
    const q = new URLSearchParams(params || {});
    q.set('accessToken', api.token);
    return `${pathname}?${q.toString()}`;
  }

  async function loadRoots() {
    try {
      const data = await api.get('/api/file/userShareFolder/list');
      fm.roots = (data.data && data.data.items) || [];
    } catch (err) {
      fm.roots = [];
    }
  }

  async function loadDir(dirPath) {
    fm.busy = true;
    fm.selected.clear();
    try {
      const data = await api.post('/api/file/list', {
        path: dirPath,
        onlyDir: 'false',
        includeHidden: 'false',
      });
      const payload = (data && data.data) || {};
      fm.cwd = payload.base || dirPath;
      fm.items = (payload.items || []).slice().sort((a, b) => {
        if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'zh-CN');
      });
      paint();
    } catch (err) {
      fm.items = [];
      fm.cwd = dirPath;
      paint();
      toast(err.message || '读取目录失败');
    } finally {
      fm.busy = false;
    }
  }

  function crumbs() {
    const sep = fm.cwd.includes('\\') ? '\\' : '/';
    const parts = fm.cwd.split(/[\\/]+/).filter(Boolean);
    const out = [];
    // Windows 盘符根
    if (/^[a-zA-Z]:$/.test(parts[0])) {
      out.push({ label: parts[0] + sep, path: parts[0] + sep });
      parts.shift();
    } else if (parts.length) {
      out.push({ label: sep, path: sep });
    }
    let acc = out.length ? out[0].path : '';
    parts.forEach((p, i) => {
      acc = acc.replace(/[\\/]+$/, '') + sep + p;
      out.push({ label: p, path: acc });
    });
    return out;
  }

  function goUp() {
    const list = crumbs();
    if (list.length <= 1) return;
    loadDir(list[list.length - 2].path);
  }

  function paint() {
    const body = $('#page-body');
    if (!body) return;
    const list = crumbs();
    const isRoot = list.length <= 1;

    body.innerHTML = `
      <div class="fm">
        <aside class="fm__side">
          <div class="card">
            <div class="card__body">
              <div class="fm__side-title">共享目录</div>
              <div id="fm-roots"></div>
              <button class="fm__root" id="fm-add-root" style="color:var(--blue)">${ICON.plus}<span>添加共享目录</span></button>
              <div class="fm__side-title">快捷入口</div>
              <button class="fm__root" data-src="favorites">${ICON.folderPlus.replace('is-dir', '')}<span>收藏夹</span></button>
              <button class="fm__root" data-src="recent">${ICON.list}<span>最近访问</span></button>
            </div>
          </div>
        </aside>

        <section>
          <div class="fm__bar">
            <button class="btn btn--ghost btn--sm" id="fm-up" ${isRoot ? 'disabled' : ''} title="上一级">${ICON.up}上级</button>
            <div class="fm__crumbs" id="fm-crumbs"></div>
            <div class="fm__spacer"></div>
            <button class="btn btn--ghost btn--sm" id="fm-view" title="切换视图">${fm.view === 'list' ? ICON.grid : ICON.list}</button>
            <button class="btn btn--ghost btn--sm" id="fm-refresh" title="刷新">${ICON.refresh}</button>
            <button class="btn btn--ghost btn--sm" id="fm-mkdir">${ICON.folderPlus}新建文件夹</button>
            <button class="btn btn--primary btn--sm" id="fm-upload-btn">${ICON.dl}上传文件</button>
            <input type="file" id="fm-file-input" multiple hidden>
          </div>

          <div id="fm-selected-bar" class="fm__bar" hidden></div>
          <div id="fm-uploads" class="fm__uploads"></div>
          <div class="fm__drop" id="fm-drop">把文件拖到这里上传，或 <b>点击选择文件</b></div>

          <div class="card">
            <div class="card__head">
              <h3 class="card__title" id="fm-title">${escapeHtml(fm.cwd || '文件')}</h3>
              <span class="card__extra" id="fm-count"></span>
            </div>
            <div class="card__body" id="fm-list" style="padding:0"></div>
          </div>
        </section>
      </div>`;

      // 侧边根目录
      $('#fm-roots').innerHTML = fm.roots.length
        ? fm.roots.map(r => `
            <button class="fm__root ${fm.cwd === r.path ? 'is-active' : ''}" data-path="${escapeHtml(r.path)}">
              ${ICON.dir}<span>${escapeHtml(r.name || r.path)}<small>${escapeHtml(r.path)}</small></span>
            </button>`).join('')
        : '<div class="empty" style="padding:12px">暂无共享目录</div>';

      // 面包屑
      $('#fm-crumbs').innerHTML = list.map((c, i) => `
        ${i ? '<span class="fm__crumb-sep">/</span>' : ''}
        <button class="fm__crumb ${i === list.length - 1 ? 'is-current' : ''}" data-path="${escapeHtml(c.path)}">${escapeHtml(c.label)}</button>
      `).join('');

      paintList();
      bindBar();
      paintSelection();
      paintUploads();
  }

  function paintList() {
    const box = $('#fm-list');
    if (!box) return;
    $('#fm-count').textContent = fm.items.length ? `${fm.items.length} 项` : '';

    if (!fm.items.length) {
      box.innerHTML = `<div class="empty">
        <svg viewBox="0 0 24 24"><path d="M3 7.5A2 2 0 015 5.5h4l2 2h8a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
        <div>${fm.busy ? '加载中…' : '空目录'}</div></div>`;
      return;
    }

    if (fm.view === 'grid') {
      box.innerHTML = `<div class="fm__grid">${fm.items.map(gridCell).join('')}</div>`;
    } else {
      box.innerHTML = `<div style="overflow-x:auto"><table class="fm__table">
        <thead><tr>
          <th style="width:34px"><input type="checkbox" class="fm__check" id="fm-check-all" title="全选"></th>
          <th>名称</th><th class="tbl__num" style="width:110px">大小</th>
          <th style="width:150px">修改时间</th><th style="width:118px"></th>
        </tr></thead>
        <tbody>${fm.items.map(row).join('')}</tbody></table></div>`;
      const all = $('#fm-check-all');
      if (all) {
        all.checked = fm.selected.size === fm.items.length;
        all.addEventListener('change', e => {
          fm.selected.clear();
          if (e.target.checked) fm.items.forEach(i => fm.selected.add(i.path));
          paintList();
          paintSelection();
        });
      }
    }
    bindList();
  }

  function row(item) {
    const sel = fm.selected.has(item.path);
    const isDir = item.type === 'dir';
    const thumb = !isDir && item.type === 'image'
      ? `<img class="fm__thumb" loading="lazy" alt="" src="${authedUrl('/api/file/tiny', { path: item.path })}">`
      : fileIcon(item);
    return `<tr data-path="${escapeHtml(item.path)}" data-dir="${isDir ? 1 : 0}" class="${sel ? 'is-selected' : ''}">
      <td><input type="checkbox" class="fm__check fm-check" ${sel ? 'checked' : ''}></td>
      <td><div class="fm__name">${thumb}<b title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</b></div></td>
      <td class="tbl__num">${isDir ? '—' : escapeHtml(fmtBytes(item.size))}</td>
      <td class="num" style="color:var(--text-3)">${escapeHtml(fmtTime(item.mtimeMs))}</td>
      <td><div class="fm__rowactions">
        ${!isDir ? `<button class="fm__iconbtn" data-act="download" title="下载">${ICON.dl}</button>` : ''}
        <button class="fm__iconbtn" data-act="rename" title="重命名">${ICON.edit}</button>
        <button class="fm__iconbtn is-danger" data-act="delete" title="删除">${ICON.trash}</button>
      </div></td>
    </tr>`;
  }

  function gridCell(item) {
    const isDir = item.type === 'dir';
    const sel = fm.selected.has(item.path);
    const img = !isDir && item.type === 'image'
      ? `<img class="fm__cell-img" loading="lazy" alt="" src="${authedUrl('/api/file/tiny', { path: item.path })}">`
      : `<div style="display:grid;place-items:center;aspect-ratio:1;background:#f6f8fb">${fileIcon(item).replace('fico', 'fico').replace('class="fico', 'class="fico" style="width:34px;height:34px"')}</div>`;
    return `<div class="card fm__cell ${sel ? 'is-selected' : ''}" data-path="${escapeHtml(item.path)}" data-dir="${isDir ? 1 : 0}">
      ${img}
      <div class="fm__cell-body">
        <div class="fm__cell-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="fm__cell-meta">${isDir ? '文件夹' : escapeHtml(fmtBytes(item.size))}</div>
      </div>
    </div>`;
  }

  function paintSelection() {
    const bar = $('#fm-selected-bar');
    if (!bar) return;
    if (!fm.selected.size) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    bar.innerHTML = `<span class="tag tag--blue">已选 ${fm.selected.size} 项</span>
      <button class="btn btn--ghost btn--sm" id="fm-sel-clear">取消选择</button>
      <button class="btn btn--ghost btn--sm" id="fm-sel-delete" style="color:var(--danger)">${ICON.trash}删除所选</button>`;
    $('#fm-sel-clear').addEventListener('click', () => { fm.selected.clear(); paintList(); paintSelection(); });
    $('#fm-sel-delete').addEventListener('click', () => removeSelected());
  }

  function bindBar() {
    $('#fm-up').addEventListener('click', goUp);
    $('#fm-refresh').addEventListener('click', () => loadDir(fm.cwd));
    $('#fm-view').addEventListener('click', () => {
      fm.view = fm.view === 'list' ? 'grid' : 'list';
      paint();
    });
    $('#fm-mkdir').addEventListener('click', promptMkdir);
    $('#fm-upload-btn').addEventListener('click', () => $('#fm-file-input').click());
    $('#fm-file-input').addEventListener('change', e => {
      uploadFiles(Array.from(e.target.files || []));
      e.target.value = '';
    });

    $$('#fm-roots .fm__root').forEach(b => b.addEventListener('click', () => {
      const src = b.dataset.src;
      if (src) return loadSpecial(src);
      loadDir(b.dataset.path);
    }));
    const addRoot = $('#fm-add-root');
    if (addRoot) addRoot.addEventListener('click', promptAddRoot);
    $$('#fm-crumbs .fm__crumb').forEach(b => b.addEventListener('click', () => loadDir(b.dataset.path)));

    // 拖拽上传
    const drop = $('#fm-drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.remove('is-over');
    }));
    drop.addEventListener('drop', e => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) uploadFiles(files);
    });
    drop.addEventListener('click', () => $('#fm-file-input').click());
  }

  function bindList() {
    $$('#fm-list tbody tr, #fm-list .fm__cell').forEach(el => {
      const p = el.dataset.path;
      const isDir = el.dataset.dir === '1';
      el.addEventListener('click', e => {
        if (e.target.classList.contains('fm-check')) {
          e.target.checked ? fm.selected.add(p) : fm.selected.delete(p);
          el.classList.toggle('is-selected', e.target.checked);
          paintSelection();
          return;
        }
        const btn = e.target.closest('[data-act]');
        if (btn) {
          e.stopPropagation();
          const item = fm.items.find(i => i.path === p);
          if (btn.dataset.act === 'download') download(item);
          if (btn.dataset.act === 'rename') promptRename(item);
          if (btn.dataset.act === 'delete') { fm.selected.clear(); fm.selected.add(p); removeSelected(); }
          return;
        }
        if (isDir) loadDir(p);
        else preview(item);
      });
      el.addEventListener('dblclick', () => { if (!isDir) preview(fm.items.find(i => i.path === p)); });
    });
  }

  async function loadSpecial(source) {
    fm.busy = true;
    try {
      const data = await api.post('/api/file/list', { source, onlyDir: 'false' });
      const payload = (data && data.data) || {};
      fm.cwd = source === 'favorites' ? '__favorites__' : '__recent__';
      fm.items = (payload.items || []).slice().sort((a, b) => {
        if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'zh-CN');
      });
      fm.selected.clear();
      paint();
    } catch (err) {
      toast(err.message || '加载失败');
    } finally {
      fm.busy = false;
    }
  }

  /* ---------------- 操作 ---------------- */
  function download(item) {
    const a = document.createElement('a');
    a.href = authedUrl('/api/file/rawFile', { path: item.path, download: '1' });
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function preview(item) {
    const w = 1100, h = 760;
    const left = (screen.width - w) / 2, top = (screen.height - h) / 2;
    const url = authedUrl('/api/file/rawFile', { path: item.path });
    window.open(url, 'nascab_preview', `width=${w},height=${h},left=${left},top=${top}`);
  }

  async function removeSelected() {
    const paths = Array.from(fm.selected);
    if (!paths.length) return;
    if (!confirm(`确定删除选中的 ${paths.length} 项？此操作不可恢复。`)) return;
    try {
      await api.post('/api/file/delete', { paths, recycle: false, deleteScrapeFiles: false });
      toast('已删除', 'ok');
      await loadDir(fm.cwd);
    } catch (err) {
      toast(err.message || '删除失败');
    }
  }

  function modal(title, fields, onOk, okText) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.id = 'fm-modal';
    wrap.innerHTML = `
      <div class="modal__mask" data-close></div>
      <div class="modal__box">
        <h3 class="modal__title">${escapeHtml(title)}</h3>
        ${fields.map(f => `
          <label class="field" style="margin-bottom:12px">
            <span class="field__label">${escapeHtml(f.label)}</span>
            <span class="field__box"><input id="fm-input-${f.key}" type="${f.type || 'text'}" value="${escapeHtml(f.value || '')}" placeholder="${escapeHtml(f.placeholder || '')}"></span>
          </label>`).join('')}
        <p class="auth__error" id="fm-modal-error" hidden></p>
        <div class="modal__foot">
          <button class="btn btn--ghost" data-close>取消</button>
          <button class="btn btn--primary" id="fm-modal-ok">${escapeHtml(okText || '确定')}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const first = wrap.querySelector('input');
    if (first) { first.focus(); first.select(); }
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
    $('#fm-modal-ok').addEventListener('click', async () => {
      const values = {};
      fields.forEach(f => { values[f.key] = $(`#fm-input-${f.key}`).value.trim(); });
      await onOk(values, wrap);
    });
    wrap.addEventListener('keydown', e => { if (e.key === 'Enter') $('#fm-modal-ok').click(); });
  }

  function closeModal() {
    const m = $('#fm-modal');
    if (m) m.remove();
  }

  function modalError(message) {
    const box = $('#fm-modal-error');
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
  }

  function promptAddRoot() {
    modal('添加共享目录', [
      { key: 'path', label: '服务器上的绝对路径', placeholder: '例如 D:\\media 或 /srv/media' },
      { key: 'name', label: '显示名称', placeholder: '留空则用文件夹名' },
    ], async v => {
      if (!v.path) return modalError('路径不能为空');
      try {
        await api.post('/api/file/userShareFolder/add', {
          path: v.path,
          name: v.name || '',
          allowDownload: true,
        });
        closeModal();
        toast('共享目录已添加', 'ok');
        await loadRoots();
        paint();
      } catch (err) {
        modalError(err.message || '添加失败');
      }
    }, '添加');
  }

  function promptMkdir() {
    modal('新建文件夹', [{ key: 'name', label: '文件夹名称', placeholder: '请输入名称' }], async (v, wrap) => {
      if (!v.name) return modalError('名称不能为空');
      try {
        await api.post('/api/file/mkdir', { base: fm.cwd, name: v.name });
        closeModal();
        toast('已创建', 'ok');
        await loadDir(fm.cwd);
      } catch (err) {
        modalError(err.message || '创建失败');
      }
    }, '创建');
  }

  function promptRename(item) {
    modal('重命名', [{ key: 'name', label: '新名称', value: item.name }], async (v, wrap) => {
      if (!v.name || v.name === item.name) return closeModal();
      try {
        await api.post('/api/file/rename', { path: item.path, newName: v.name });
        closeModal();
        toast('已重命名', 'ok');
        await loadDir(fm.cwd);
      } catch (err) {
        modalError(err.message || '重命名失败');
      }
    }, '保存');
  }

  /* ---------------- 分片上传 ---------------- */
  const CHUNK_SIZE = 4 * 1024 * 1024;

  /** 稳定且计算快的文件指纹：首尾各 64KB + 大小 */
  async function fileHash(file) {
    const head = file.slice(0, 64 * 1024);
    const tail = file.size > 64 * 1024 ? file.slice(Math.max(0, file.size - 64 * 1024)) : head;
    const [h1, h2] = await Promise.all([head.arrayBuffer(), tail.arrayBuffer()]);
    const buf = new Uint8Array(h1.byteLength + h2.byteLength + 8);
    buf.set(new Uint8Array(h1), 0);
    buf.set(new Uint8Array(h2), h1.byteLength);
    new DataView(buf.buffer).setFloat64(h1.byteLength + h2.byteLength, file.size);
    let h = 0x811c9dc5;
    for (let i = 0; i < buf.length; i++) {
      h ^= buf[i];
      h = (h * 0x01000193) >>> 0;
    }
    return `${file.size.toString(16)}-${h.toString(16)}`;
  }

  function uploadFiles(files) {
    if (!files.length) return;
    if (!fm.cwd || fm.cwd.startsWith('__')) {
      toast('请先进入一个具体目录再上传');
      return;
    }
    files.forEach(f => {
      const job = { id: `${f.name}-${f.size}-${Date.now()}`, file: f, progress: 0, status: '等待中', error: '' };
      fm.uploads.push(job);
      paintUploads();
      runUpload(job);
    });
  }

  function paintUploads() {
    const box = $('#fm-uploads');
    if (!box) return;
    if (!fm.uploads.length) { box.innerHTML = ''; return; }
    box.innerHTML = fm.uploads.map(u => `
      <div class="card fm__upload">
        <div class="fm__upload-name" title="${escapeHtml(u.file.name)}">${escapeHtml(u.file.name)}</div>
        <div class="fm__upload-meta">${escapeHtml(u.status)}${u.error ? ` · ${escapeHtml(u.error)}` : ''}</div>
        <div class="bar"><div class="bar__fill ${u.error ? 'is-danger' : ''}" style="width:${u.progress}%"></div></div>
      </div>`).join('');
  }

  async function runUpload(job) {
    const { file } = job;
    try {
      const hash = await fileHash(file);
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      job.status = '校验中';
      paintUploads();

      const check = await api.post('/api/file/upload/check', {
        hash, targetDir: fm.cwd, chunkSize: CHUNK_SIZE, fileName: file.name, nameStrategy: 'overwrite',
      });
      const done = new Set(((check.data && check.data.uploadedChunks) || []).map(Number));

      for (let i = 0; i < totalChunks; i++) {
        if (done.has(i)) {
          job.progress = Math.round(((i + 1) / totalChunks) * 100);
          paintUploads();
          continue;
        }
        job.status = `上传中 ${i + 1}/${totalChunks}`;
        paintUploads();
        const start = i * CHUNK_SIZE;
        const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
        const form = new FormData();
        form.append('file', blob, `${file.name}.part${i}`);
        form.append('hash', hash);
        form.append('index', String(i));
        form.append('targetDir', fm.cwd);
        form.append('chunkSize', String(CHUNK_SIZE));
        form.append('fileName', file.name);
        form.append('totalChunks', String(totalChunks));
        form.append('nameStrategy', 'overwrite');

        const resp = await fetch('/api/file/upload/chunk', {
          method: 'POST',
          headers: { Authorization: `Bearer ${api.token}` },
          body: form,
        });
        if (!resp.ok) {
          let msg = `分片 ${i} 失败（${resp.status}）`;
          try {
            const j = await resp.json();
            if (j && j.message) msg = j.message;
          } catch (_) {}
          throw new Error(msg);
        }
        job.progress = Math.round(((i + 1) / totalChunks) * 100);
        paintUploads();
      }

      job.status = '完成';
      job.progress = 100;
      paintUploads();
      toast(`${file.name} 上传完成`, 'ok');
      setTimeout(() => {
        fm.uploads = fm.uploads.filter(u => u.id !== job.id);
        paintUploads();
        if (state.page === 'files') loadDir(fm.cwd);
      }, 1200);
    } catch (err) {
      job.status = '失败';
      job.error = err.message || '上传出错';
      paintUploads();
    }
  }

  /* ---------------- 页面入口 ---------------- */
  N.registerPage('files', async function render(body, actions) {
    actions.innerHTML = '';
    body.innerHTML = `<div class="card"><div class="card__body"><div class="skeleton" style="width:40%"></div></div></div>`;

    await loadRoots();
    // 默认进入第一个共享目录
    const first = fm.roots.find(r => r.exists !== false) || fm.roots[0];
    if (first && !fm.cwd) {
      await loadDir(first.path);
    } else {
      paint();
    }
  }, { title: '文件管理', desc: '浏览、上传、下载与管理服务器文件' });

}

// console.js 已就绪就直接注册；否则等 bootPages() 兜底
window.NasCabPages.push(__register);
if (window.NasCab) {
  try { __register(window.NasCab); } catch (e) { console.error('页面模块注册失败', e); }
}

})();
