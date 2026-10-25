(function () {
'use strict';

/* ============================================================
   相册页面：时间线 / 相册 / 收藏 / 地点 / 回收站
   ------------------------------------------------------------
   服务端 /api/photo 下本来就有一整套相册能力（timeline、album、
   collection、smart_album、places、trash、face、similar），但 Web 控制台
   此前一处都没接——照片只能在手机客户端看，网页上进不去。

   这里把核心浏览体验接出来：按拍摄日期分组的时间线、相册、收藏、
   地点、回收站，外加一个灯箱（大图/EXIF/收藏/删除/加入相册）。
   人脸、相似图、智能相册依赖 AI 模型与扫描任务，本次不接。
   ============================================================ */
window.NasCabPages = window.NasCabPages || [];

function __register(N) {
  const { api, toast, escapeHtml, fmtBytes, fmtTime } = N;
  const $ = N.$, $$ = N.$$;

  const I = {
    photo: '<svg viewBox="0 0 20 20"><rect x="2.6" y="4.4" width="14.8" height="11.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7.4" cy="8.4" r="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.4 14.2l3.6-3.4 2.6 2.3 2.8-2.6 4.2 3.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    album: '<svg viewBox="0 0 20 20"><path d="M3.2 6.2a2 2 0 012-2h9.6a2 2 0 012 2v7.6a2 2 0 01-2 2H5.2a2 2 0 01-2-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3.2 12.4l3.4-3 2.6 2.2 2.6-2.4 4.2 3.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 20 20"><path d="M10 3.4l2.2 4.5 4.9.7-3.6 3.4.9 4.9-4.4-2.4-4.4 2.4.9-4.9L2.9 8.6l4.9-.7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    pin: '<svg viewBox="0 0 20 20"><path d="M10 2.8c2.9 0 5.2 2.3 5.2 5.2 0 3.6-5.2 9.2-5.2 9.2S4.8 11.6 4.8 8c0-2.9 2.3-5.2 5.2-5.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="8" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><path d="M4.5 6.5h11M8 6.5V4.8h4v1.7M6 6.5l.7 9h6.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    refresh: '<svg viewBox="0 0 20 20"><path d="M15 10a5 5 0 11-1.6-3.7M15 3.5V7h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 20 20"><path d="M10 5v10M5 10h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 20 20"><path d="M5.6 5.6l8.8 8.8M14.4 5.6l-8.8 8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    left: '<svg viewBox="0 0 20 20"><path d="M12 4.5L6.5 10 12 15.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 20 20"><path d="M8 4.5L13.5 10 8 15.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dl: '<svg viewBox="0 0 20 20"><path d="M10 3.5v8M6.5 8L10 11.5 13.5 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14.5h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 9v4.2M10 6.6v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 20 20"><path d="M5 10.6l3.2 3.2L15 6.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    video: '<svg viewBox="0 0 20 20"><rect x="2.6" y="4.4" width="14.8" height="11.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 8l4.4 2.6L8 13.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  };

  const PAGE_SIZE = 60;
  const GRID_SIZE = 360;      // 网格缩略图长边
  const BIG_SIZE = 1600;      // 灯箱大图长边

  const VIEWS = [
    { id: 'timeline', label: '时间线', icon: I.photo },
    { id: 'albums', label: '相册', icon: I.album },
    { id: 'favorite', label: '收藏', icon: I.star },
    { id: 'places', label: '地点', icon: I.pin },
    { id: 'trash', label: '回收站', icon: I.trash },
  ];

  const FILE_TYPES = [
    { id: '', label: '全部' },
    { id: 'photo', label: '照片' },
    { id: 'video', label: '视频' },
    { id: 'livephoto', label: 'LivePhoto' },
  ];

  /* ---------------- 状态 ---------------- */
  const S = {
    view: 'timeline',
    groups: [],            // [{date, geo, camera, photos:[]}]
    photos: [],            // 当前视图已加载的全部照片（平铺）
    page: 1, hasMore: false, loading: false, exhausted: false,
    years: [], year: 0, total: 0,
    fileType: '', search: '',
    album: null,           // {id, name, is_owner}
    placeName: '',
    sel: new Set(),        // 多选：file_hash
    lb: -1,                // 灯箱下标
    trash: { page: 1, total: 0, list: [] },
    sentinel: null,
  };

  /* ---------------- 地址 ----------------
     缩略图与原图都走文件接口，<img> 发不出 Authorization 头，
     服务端的 extractTokenFromRequest 认 query.accessToken。 */
  function mediaUrl(pathname, params) {
    const q = new URLSearchParams(params || {});
    q.set('accessToken', api.token);
    return `${pathname}?${q.toString()}`;
  }

  const tinyUrl = (fullpath, size) => mediaUrl('/api/file/tiny', { path: fullpath, size: size || GRID_SIZE });
  const rawUrl = fullpath => mediaUrl('/api/file/rawFile', { path: fullpath });

  /** api.request 返回的是整个响应体（{success, data, message}），取数据统一走这里 */
  const payload = r => (r && r.data) || {};

  /* ---------------- 小工具 ---------------- */
  function dateLabel(date) {
    if (!date) return '未知日期';
    const [y, m, d] = String(date).split('-');
    if (!y || !m || !d) return String(date);
    return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
  }

  function isVideo(p) { return Number(p && p.type) === 2; }
  function isLive(p) { return Number(p && p.is_lvp) === 1; }

  function badgeOf(p) {
    if (isVideo(p)) {
      const sec = Number(p.duration) || 0;
      return sec > 0 ? fmtTime(sec) : '视频';
    }
    if (isLive(p)) return 'Live';
    if (p.raw_show_ext) return escapeHtml(p.raw_show_ext);
    return '';
  }

  /** 缩略图可能还没生成（服务端返回 202 + Retry-After），加载失败就隔一会重试 */
  function bindThumb(img, url) {
    let left = 3;
    img.addEventListener('error', function onErr() {
      if (left-- <= 0) {
        img.removeEventListener('error', onErr);
        img.closest('.ph__img')?.classList.add('is-broken');
        return;
      }
      setTimeout(() => { img.src = `${url}&_r=${Date.now()}`; }, 1500);
    });
  }

  function resetList() {
    S.groups = []; S.photos = []; S.page = 1; S.hasMore = false; S.exhausted = false;
  }

  /* ---------------- 视图外壳 ---------------- */
  function renderPhoto(body, actions) {
    body.innerHTML = `
      <div class="phview">
        <div class="phview__tabs" id="ph-tabs">
          ${VIEWS.map(v => `<button class="phview__tab${v.id === S.view ? ' is-active' : ''}" data-view="${v.id}">${v.icon}<span>${escapeHtml(v.label)}</span></button>`).join('')}
        </div>
        <div class="phview__tools" id="ph-tools"></div>
      </div>
      <div id="ph-main"><div class="card"><div class="card__body">
        <div class="skeleton" style="width:40%"></div>
        <div class="skeleton" style="width:70%;margin-top:10px"></div>
        <div class="skeleton" style="width:55%;margin-top:10px"></div>
      </div></div></div>`;

    $$('#ph-tabs .phview__tab').forEach(btn => btn.addEventListener('click', () => {
      if (S.view === btn.dataset.view) return;
      S.view = btn.dataset.view;
      S.album = null; S.placeName = ''; S.sel.clear();
      renderPhoto(body, actions);
    }));

    const ROUTES = { timeline: renderTimeline, albums: renderAlbums, favorite: renderFavorite, places: renderPlaces, trash: renderTrash };
    (ROUTES[S.view] || renderTimeline)(body);
  }

  /* ============================================================
      时间线 / 收藏：同一个网格，只是查询条件不同
      ============================================================ */
  function listParams() {
    const p = { page: S.page, pageSize: PAGE_SIZE, sort: 'desc' };
    if (S.fileType) p.fileType = S.fileType;
    if (S.search) p.search = S.search;
    if (S.year) p.year = S.year;
    if (S.view === 'favorite') p.list_type = 'favorite';
    if (S.album) p.album_id = S.album.id;
    if (S.placeName) p.place_name = S.placeName;
    return p;
  }

  function renderTools(body, extra) {
    const tools = $('#ph-tools');
    if (!tools) return;
    const chips = FILE_TYPES.map(t =>
      `<button class="chip${t.id === S.fileType ? ' is-on' : ''}" data-ft="${t.id}">${escapeHtml(t.label)}</button>`).join('');
    tools.innerHTML = `
      <div class="mediabar">
        <input class="input" id="ph-search" type="search" placeholder="搜索文件名 / 拍摄设备" value="${escapeHtml(S.search)}">
        <div class="phchips">${chips}</div>
        ${extra || ''}
      </div>`;

    $('#ph-search').addEventListener('change', e => {
      S.search = e.target.value.trim();
      reload(body);
    });
    $$('#ph-tools .chip').forEach(c => c.addEventListener('click', () => {
      S.fileType = c.dataset.ft;
      $$('#ph-tools .chip').forEach(x => x.classList.toggle('is-on', x === c));
      reload(body);
    }));
    if (extra) bindToolExtras(body);
  }

  /** 相册/地点/回收站三个视图不用搜索与类型筛选，别把上一个视图的工具条留着 */
  function clearTools() {
    const tools = $('#ph-tools');
    if (tools) tools.innerHTML = '';
  }

  function bindToolExtras(body) {
    const pick = $('#ph-select-mode');
    pick && pick.addEventListener('click', () => {
      pick.classList.toggle('is-on');
      $$('#ph-main .ph').forEach(el => el.classList.toggle('is-sel-mode', pick.classList.contains('is-on')));
      if (!pick.classList.contains('is-on')) S.sel.clear();
      paintSelBar(body);
    });
    const create = $('#ph-album-new');
    create && create.addEventListener('click', () => promptCreateAlbum(body));
  }

  function renderTimeline(body) {
    renderTools(body, `<button class="btn btn--ghost btn--sm" id="ph-select-mode">${I.check}多选</button>`);
    const main = $('#ph-main');
    main.innerHTML = `
      <div class="media">
        <aside class="media__side" id="ph-years"><div class="skeleton" style="width:70%"></div></aside>
        <section class="media__main">
          <div class="phwrap" id="ph-wrap"><div class="phgrid" id="ph-grid"></div><div id="ph-sentinel"></div></div>
        </section>
      </div>`;
    S.sentinel = $('#ph-sentinel');
    loadYears();
    reload(body);
    observeSentinel(body);
  }

  function renderFavorite(body) {
    renderTools(body, `<button class="btn btn--ghost btn--sm" id="ph-select-mode">${I.check}多选</button>`);
    const main = $('#ph-main');
    main.innerHTML = `<div class="phwrap" id="ph-wrap"><div class="phgrid" id="ph-grid"></div><div id="ph-sentinel"></div></div>`;
    S.sentinel = $('#ph-sentinel');
    reload(body);
    observeSentinel(body);
  }

  /** 年份导航。接口一次给出每年的照片数与封面，点击即筛选。 */
  async function loadYears() {
    const box = $('#ph-years');
    if (!box) return;
    let resp;
    try {
      resp = await api.post('/api/photo/timeline/years', {});
    } catch (err) {
      box.innerHTML = `<div class="mediaside__hint">年份加载失败</div>`;
      return;
    }
    S.years = payload(resp).items || [];
    if (!S.years.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
      box.innerHTML = `<div class="mediaside__group">
        <div class="mediaside__label">年份</div>
        <button class="mediaside__item${S.year ? '' : ' is-active'}" data-year="0">全部</button>
        ${S.years.map(y => `<button class="mediaside__item${Number(S.year) === Number(y.year) ? ' is-active' : ''}" data-year="${y.year}">
          <span class="mediaside__plname">${y.year}</span><span class="phyear__c">${Number(y.count) || 0}</span>
        </button>`).join('')}
      </div>`;
    $$('#ph-years [data-year]').forEach(el => el.addEventListener('click', () => {
      S.year = Number(el.dataset.year) || 0;
      $$('#ph-years [data-year]').forEach(x => x.classList.toggle('is-active', x === el));
      reload($('#page-body'));
    }));
  }

  function observeSentinel(body) {
    if (!S.sentinel || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMore(body);
    }, { rootMargin: '600px 0px' });
    S.sentinel.__io = io;
    io.observe(S.sentinel);
  }

  async function reload(body) {
    resetList();
    await loadMore(body, true);
  }

  async function loadMore(body, fresh) {
    if (S.loading || (S.exhausted && !fresh)) return;
    S.loading = true;
    const grid = $('#ph-grid');
    if (fresh && grid) grid.innerHTML = '';
    if (fresh) paintFoot('加载中…');
    try {
      const data = payload(await api.post('/api/photo/timeline/photos', listParams()));
      const list = data.photoList || [];
      S.hasMore = !!data.hasMore;
      S.exhausted = !S.hasMore;
      S.page += 1;
      appendPhotos(list, data.dateInfoList);
      paintGrid(body);
      paintFoot(S.hasMore ? '' : (S.photos.length ? `共 ${S.photos.length} 张` : ''));
    } catch (err) {
      paintFoot(`加载失败：${err.message || '未知错误'}`);
    } finally {
      S.loading = false;
    }
  }

  function appendPhotos(list, dateInfo) {
    const meta = new Map((dateInfo || []).map(d => [d.original_date, d]));
    for (const p of list) {
      const date = (p.original_date || '').trim();
      let g = S.groups[S.groups.length - 1];
      if (!g || g.date !== date) {
        g = { date, geo: '', camera: '', photos: [] };
        S.groups.push(g);
      }
      const m = meta.get(date);
      if (m) { g.geo = m.geo || g.geo; g.camera = m.camera || g.camera; }
      g.photos.push(p);
      S.photos.push(p);
    }
  }

  function paintGrid(body) {
    const grid = $('#ph-grid');
    if (!grid) return;
    if (!S.photos.length) {
      grid.innerHTML = `<div class="phgrid__empty">${escapeHtml(emptyText())}</div>`;
      return;
    }
    grid.innerHTML = S.groups.map(g => `
      <div class="phgroup">
        <div class="phgroup__head">
          <span class="phgroup__date">${escapeHtml(dateLabel(g.date))}</span>
          <span class="phgroup__meta">${[g.geo ? escapeHtml(g.geo) : '', g.camera ? escapeHtml(g.camera) : ''].filter(Boolean).join(' · ')}</span>
          <span class="phgroup__count">${g.photos.length} 张</span>
        </div>
        <div class="phgroup__grid">
          ${g.photos.map(p => tileHtml(p)).join('')}
        </div>
      </div>`).join('');
    bindTiles(body);
  }

  function emptyText() {
    if (S.view === 'favorite') return '还没有收藏的照片';
    if (S.album) return '这个相册还是空的';
    if (S.placeName) return `「${S.placeName}」下没有照片`;
    if (S.search) return `没有匹配「${S.search}」的照片`;
    return '相册里还没有照片';
  }

  function tileHtml(p) {
    const idx = S.photos.indexOf(p);
    const badge = badgeOf(p);
    const sel = S.sel.has(p.file_hash);
    return `
      <div class="ph${sel ? ' is-sel' : ''}" data-idx="${idx}" data-hash="${escapeHtml(p.file_hash || '')}">
        <div class="ph__img">
          <img loading="lazy" src="${escapeHtml(tinyUrl(p.fullpath))}" alt="${escapeHtml(p.filename || '')}">
          ${badge ? `<span class="ph__badge">${badge}</span>` : ''}
          ${isVideo(p) ? `<span class="ph__vid">${I.video}</span>` : ''}
          ${Number(p.is_favorite) === 1 ? `<span class="ph__fav">${I.star}</span>` : ''}
          <span class="ph__check">${I.check}</span>
        </div>
      </div>`;
  }

  function bindTiles(body) {
    $$('#ph-grid .ph img').forEach(img => bindThumb(img, img.getAttribute('src')));
    $$('#ph-grid .ph').forEach(el => {
      el.addEventListener('click', () => {
        const selMode = $('#ph-select-mode') && $('#ph-select-mode').classList.contains('is-on');
        const p = S.photos[Number(el.dataset.idx)];
        if (!p) return;
        if (selMode) { toggleSelect(p, el); return; }
        openLightbox(body, Number(el.dataset.idx));
      });
    });
  }

  function paintFoot(text) {
    const wrap = $('#ph-wrap');
    if (!wrap) return;
    let foot = $('#ph-foot');
    if (!foot) {
      foot = document.createElement('div');
      foot.id = 'ph-foot';
      foot.className = 'phfoot';
      wrap.appendChild(foot);
    }
    foot.innerHTML = text ? `<span>${escapeHtml(text)}</span>` : (S.hasMore ? '<span class="skeleton" style="width:120px"></span>' : '');
  }

  /* ---------------- 多选 ---------------- */
  function toggleSelect(p, el) {
    if (S.sel.has(p.file_hash)) S.sel.delete(p.file_hash); else S.sel.add(p.file_hash);
    el.classList.toggle('is-sel', S.sel.has(p.file_hash));
    paintSelBar();
  }

  function paintSelBar() {
    let bar = $('#ph-selbar');
    const n = S.sel.size;
    if (!n) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ph-selbar';
      bar.className = 'phselbar';
      document.body.appendChild(bar);
    }
    bar.innerHTML = `<span class="phselbar__n">已选 ${n} 张</span>
      <button class="btn btn--ghost btn--sm" id="ph-sel-fav">${I.star}收藏</button>
      <button class="btn btn--ghost btn--sm" id="ph-sel-album">${I.plus}加入相册</button>
      <button class="btn btn--ghost btn--sm" id="ph-sel-trash">${I.trash}删除</button>
      <button class="btn btn--ghost btn--sm" id="ph-sel-clear">${I.close}取消</button>`;
    $('#ph-sel-fav').addEventListener('click', () => batchOp('favorite'));
    $('#ph-sel-album').addEventListener('click', () => pickAlbumForAdd());
    $('#ph-sel-trash').addEventListener('click', () => batchOp('trash'));
    $('#ph-sel-clear').addEventListener('click', () => { S.sel.clear(); $$('#ph-grid .ph').forEach(el => el.classList.remove('is-sel')); paintSelBar(); });
  }

  async function batchOp(kind) {
    const hashes = [...S.sel];
    if (!hashes.length) return;
    try {
      if (kind === 'favorite') {
        await api.post('/api/photo/favorite/batch', { file_hashes: hashes, is_favorite: true });
        toast('已加入收藏', 'ok');
      } else if (kind === 'trash') {
        const ids = S.photos.filter(p => S.sel.has(p.file_hash)).map(p => p.id);
        await api.post('/api/photo/trash/add', { ids });
        toast('已移入回收站', 'ok');
      }
      S.sel.clear();
      paintSelBar();
      renderPhoto($('#page-body'), $('#pagehead-actions'));
    } catch (err) {
      toast(err.message || '操作失败');
    }
  }

  async function pickAlbumForAdd() {
    let albums;
    try {
      const data = await api.post('/api/photo/album/list', { page: 1, pageSize: 100, type: 'my' });
      albums = payload(data).items || [];
    } catch (err) { toast(err.message || '读取相册失败'); return; }
    if (!albums.length) { toast('还没有相册，先新建一个'); return; }
    const name = window.prompt(`加入哪个相册？\n${albums.map((a, i) => `${i + 1}. ${a.name}`).join('\n')}\n\n输入序号：`);
    const pick = albums[Number(name) - 1];
    if (!pick) return;
    try {
      await api.post('/api/photo/album/index/add', { album_id: pick.id, file_hashes: [...S.sel] });
      toast(`已加入「${pick.name}」`, 'ok');
      S.sel.clear();
      paintSelBar();
    } catch (err) { toast(err.message || '加入失败'); }
  }

  /* ============================================================
      相册
      ============================================================ */
  async function renderAlbums(body) {
    clearTools();
    const main = $('#ph-main');
    main.innerHTML = `<div class="card"><div class="card__body"><div class="skeleton" style="width:40%"></div></div></div>`;
    let data;
    try {
      data = await api.post('/api/photo/album/overview', { limit: 12 });
    } catch (err) {
      main.innerHTML = errBox(err);
      return;
    }
    const albums = payload(data).albums.items || [];
    const colls = payload(data).collections.items || [];
    const smarts = payload(data).smart_albums.items || [];

    main.innerHTML = `
      <div class="card">
        <div class="card__head">
          <h3 class="card__title">${I.album}相册</h3>
          <button class="btn btn--primary btn--sm" id="ph-album-new">${I.plus}新建相册</button>
        </div>
        <div class="card__body">
          <div class="phalbums" id="ph-albums">
            ${albums.length ? albums.map(a => albumCard(a)).join('') : '<div class="empty">还没有相册</div>'}
          </div>
        </div>
      </div>
      ${colls.length ? `<div class="card">
        <div class="card__head"><h3 class="card__title">${I.album}合集</h3><span class="card__extra">按目录归类的照片集合</span></div>
        <div class="card__body"><div class="phalbums">${colls.map(c => `<div class="phalbum" data-coll="${c.id}">
          <div class="phalbum__cover phalbum__cover--empty">${I.album}</div>
          <div class="phalbum__name">${escapeHtml(c.name || '')}</div>
          <div class="phalbum__sub">合集</div>
        </div>`).join('')}</div></div></div>` : ''}
      ${smarts.length ? `<div class="card">
        <div class="card__head"><h3 class="card__title">${I.photo}智能相册</h3><span class="card__extra">由服务端按条件自动归类</span></div>
        <div class="card__body"><div class="phalbums">${smarts.map(s => `<div class="phalbum">
          <div class="phalbum__cover phalbum__cover--empty">${I.photo}</div>
          <div class="phalbum__name">${escapeHtml(s.name || '')}</div>
          <div class="phalbum__sub">智能相册</div>
        </div>`).join('')}</div></div></div>` : ''}`;

    $('#ph-album-new').addEventListener('click', () => promptCreateAlbum(body));
    $$('#ph-albums .phalbum').forEach(el => el.addEventListener('click', () => {
      const id = Number(el.dataset.album);
      if (!id) return;
      openAlbum(body, id, el.dataset.name || '');
    }));
  }

  function albumCard(a) {
    const previews = (a.previews || []).filter(p => p.fullpath).slice(0, 4);
    const cover = previews.length
      ? `<div class="phalbum__cover"><img loading="lazy" src="${escapeHtml(tinyUrl(previews[0].fullpath, 480))}" alt=""></div>`
      : `<div class="phalbum__cover phalbum__cover--empty">${I.album}</div>`;
    return `<div class="phalbum" data-album="${a.id}" data-name="${escapeHtml(a.name || '')}">
      ${cover}
      <div class="phalbum__name">${escapeHtml(a.name || '')}</div>
      <div class="phalbum__sub">${a.is_owner ? '我的相册' : escapeHtml(a.owner_username || '共享相册')}${Number(a.is_public) === 1 ? ' · 公开' : ''}</div>
    </div>`;
  }

  function promptCreateAlbum(body) {
    const name = (window.prompt('相册名称：') || '').trim();
    if (!name) return;
    api.post('/api/photo/album/create', { name })
      .then(() => { toast('已创建', 'ok'); renderAlbums(body); })
      .catch(err => toast(err.message || '创建失败'));
  }

  async function openAlbum(body, id, name) {
    const main = $('#ph-main');
    main.innerHTML = `<div class="card"><div class="card__body"><div class="skeleton" style="width:40%"></div></div></div>`;
    let album;
    try {
      album = payload(await api.post('/api/photo/album/get', { id }));
    } catch (err) { main.innerHTML = errBox(err); return; }
    S.album = { id: album.id, name: album.name, is_owner: Number(album.owner_id) === Number(currentUid()) };
    S.placeName = '';
    main.innerHTML = `
      <div class="mediabar">
        <button class="btn btn--ghost btn--sm" id="ph-album-back">${I.left}返回相册</button>
        <span class="mediabar__title">${escapeHtml(album.name || '')}</span>
        <span class="card__extra">${S.album.is_owner ? '我的相册' : '共享相册'}</span>
        <span class="phgrow"></span>
        ${S.album.is_owner ? `<button class="btn btn--ghost btn--sm" id="ph-album-rename">重命名</button>
        <button class="btn btn--ghost btn--sm" id="ph-album-del">${I.trash}删除</button>` : ''}
      </div>
      <div class="phwrap" id="ph-wrap"><div class="phgrid" id="ph-grid"></div><div id="ph-sentinel"></div></div>`;
    $('#ph-album-back').addEventListener('click', () => { S.album = null; renderAlbums(body); });
    const ren = $('#ph-album-rename');
    ren && ren.addEventListener('click', () => {
      const next = (window.prompt('新的相册名称：', album.name || '') || '').trim();
      if (!next || next === album.name) return;
      api.post('/api/photo/album/update', { album_id: album.id, name: next })
        .then(() => { toast('已重命名', 'ok'); openAlbum(body, album.id, next); })
        .catch(err => toast(err.message || '重命名失败'));
    });
    const del = $('#ph-album-del');
    del && del.addEventListener('click', () => {
      if (!window.confirm(`删除相册「${album.name}」？相册里的照片不会被删除。`)) return;
      api.post('/api/photo/album/delete', { album_id: album.id })
        .then(() => { toast('已删除', 'ok'); S.album = null; renderAlbums(body); })
        .catch(err => toast(err.message || '删除失败'));
    });
    S.sentinel = $('#ph-sentinel');
    renderTools(body, `<button class="btn btn--ghost btn--sm" id="ph-select-mode">${I.check}多选</button>`);
    reload(body);
    observeSentinel(body);
  }

  /* ============================================================
      地点
      ============================================================ */
  async function renderPlaces(body) {
    clearTools();
    const main = $('#ph-main');
    main.innerHTML = `<div class="card"><div class="card__body"><div class="skeleton" style="width:40%"></div></div></div>`;
    let data;
    try {
      data = await api.post('/api/photo/place/list', { page: 1, pageSize: 200, status: 'visible' });
    } catch (err) { main.innerHTML = errBox(err); return; }
    const items = payload(data).items || [];
    if (payload(data).placeEnable === 0) {
      main.innerHTML = `<div class="card"><div class="card__body"><div class="empty">
        地点归类未启用。<br>需要在相册设置里打开「AI 场景/地点识别」，服务端扫描后这里才会有数据。</div></div></div>`;
      return;
    }
    main.innerHTML = `<div class="card">
      <div class="card__head"><h3 class="card__title">${I.pin}地点</h3><span class="card__extra">按拍摄地点归类</span></div>
      <div class="card__body"><div class="phplaces" id="ph-places">
        ${items.length ? items.map(p => `<button class="phplace" data-name="${escapeHtml(p.place_name || '')}">
          <span class="phplace__name">${escapeHtml(p.place_name || '')}</span>
          <span class="phplace__n">${Number(p.photo_count) || 0} 张</span>
        </button>`).join('') : '<div class="empty">还没有地点数据</div>'}
      </div></div></div>`;
    $$('#ph-places .phplace').forEach(el => el.addEventListener('click', () => {
      S.placeName = el.dataset.name;
      renderTools(body, `<button class="btn btn--ghost btn--sm" id="ph-select-mode">${I.check}多选</button>`);
      const main2 = $('#ph-main');
      main2.innerHTML = `
        <div class="mediabar">
          <button class="btn btn--ghost btn--sm" id="ph-place-back">${I.left}返回地点</button>
          <span class="mediabar__title">${escapeHtml(S.placeName)}</span>
        </div>
        <div class="phwrap" id="ph-wrap"><div class="phgrid" id="ph-grid"></div><div id="ph-sentinel"></div></div>`;
      $('#ph-place-back').addEventListener('click', () => { S.placeName = ''; renderPlaces(body); });
      S.sentinel = $('#ph-sentinel');
      reload(body);
      observeSentinel(body);
    }));
  }

  /* ============================================================
      回收站
      ============================================================ */
  async function renderTrash(body) {
    clearTools();
    const main = $('#ph-main');
    main.innerHTML = `<div class="card"><div class="card__body"><div class="skeleton" style="width:40%"></div></div></div>`;
    let data;
    try {
      data = await api.post('/api/photo/trash/list', { page: 1, pageSize: 120, sortField: 'in_trash_time', sortOrder: 'desc' });
    } catch (err) { main.innerHTML = errBox(err); return; }
    resetList();
    const list = payload(data).list || [];
    main.innerHTML = `
      <div class="mediabar">
        <span class="mediabar__title">${I.trash}回收站</span>
        <span class="card__extra">${Number(payload(data).total) || 0} 张</span>
        <span class="phgrow"></span>
        ${list.length ? `<button class="btn btn--ghost btn--sm" id="ph-trash-restore-all">全部恢复</button>
        <button class="btn btn--danger btn--sm" id="ph-trash-empty">${I.trash}清空</button>` : ''}
      </div>
      <div class="phwrap" id="ph-wrap">
        ${list.length ? `<div class="phgroup__grid">${list.map(p => {
          const idx = S.photos.length;
          S.photos.push(p);
          return tileHtml(p);
        }).join('')}</div>` : '<div class="empty">回收站是空的</div>'}
      </div>`;
    const ra = $('#ph-trash-restore-all');
    ra && ra.addEventListener('click', () => {
      if (!window.confirm('恢复回收站里的全部照片？')) return;
      api.post('/api/photo/trash/restore', { restore_all: true })
        .then(() => { toast('已全部恢复', 'ok'); renderTrash(body); })
        .catch(err => toast(err.message || '恢复失败'));
    });
    const em = $('#ph-trash-empty');
    em && em.addEventListener('click', () => {
      if (!window.confirm('清空回收站会永久删除这些照片，且不可恢复。确定继续？')) return;
      api.post('/api/photo/trash/empty', {})
        .then(() => { toast('回收站已清空', 'ok'); renderTrash(body); })
        .catch(err => toast(err.message || '清空失败'));
    });
    bindTiles(body);
  }

  /* ============================================================
      灯箱
      ============================================================ */
  function openLightbox(body, idx) {
    S.lb = idx;
    paintLightbox(body);
  }

  function cur() { return S.photos[S.lb]; }

  function paintLightbox(body) {
    const p = cur();
    if (!p) { closeLightbox(); return; }
    let box = $('#ph-lb');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ph-lb';
      box.className = 'plb';
      box.hidden = true;
      document.body.appendChild(box);
      box.addEventListener('click', e => { if (e.target === box) closeLightbox(); });
    }
    box.hidden = false;
    box.innerHTML = `
      <button class="plb__close" id="plb-close" aria-label="关闭">${I.close}</button>
      <button class="plb__nav plb__nav--prev" id="plb-prev" aria-label="上一张">${I.left}</button>
      <button class="plb__nav plb__nav--next" id="plb-next" aria-label="下一张">${I.right}</button>
      <div class="plb__stage">
        ${isVideo(p)
          ? `<video class="plb__img" id="plb-media" src="${escapeHtml(rawUrl(p.fullpath))}" controls autoplay playsinline></video>`
          : `<img class="plb__img" id="plb-media" src="${escapeHtml(tinyUrl(p.fullpath, BIG_SIZE))}" alt="${escapeHtml(p.filename || '')}">`}
      </div>
      <div class="plb__bar">
        <span class="plb__count" id="plb-count">${S.lb + 1} / ${S.photos.length}</span>
        <span class="plb__name">${escapeHtml(p.filename || '')}</span>
        <span class="plb__spacer"></span>
        <button class="plb__act" id="plb-fav" title="收藏">${I.star}</button>
        <button class="plb__act" id="plb-album" title="加入相册">${I.plus}</button>
        <button class="plb__act" id="plb-info" title="详细信息">${I.info}</button>
        <a class="plb__act" id="plb-dl" href="${escapeHtml(rawUrl(p.fullpath))}" download="${escapeHtml(p.filename || '')}" title="下载">${I.dl}</a>
        <button class="plb__act plb__act--danger" id="plb-trash" title="删除">${I.trash}</button>
      </div>
      <div class="plb__info" id="plb-info-box" hidden></div>`;

    const media = $('#plb-media');
    media && bindThumb(media, media.getAttribute('src'));
    $('#plb-close').addEventListener('click', closeLightbox);
    $('#plb-prev').addEventListener('click', () => step(-1, body));
    $('#plb-next').addEventListener('click', () => step(1, body));
    $('#plb-fav').addEventListener('click', () => toggleFav(body));
    $('#plb-album').addEventListener('click', () => pickAlbumForAdd());
    $('#plb-info').addEventListener('click', toggleInfo);
    $('#plb-trash').addEventListener('click', () => trashCurrent(body));
    paintFavState();
  }

  function paintFavState() {
    const p = cur();
    const btn = $('#plb-fav');
    if (!p || !btn) return;
    btn.classList.toggle('is-on', Number(p.is_favorite) === 1);
  }

  function step(delta, body) {
    const next = S.lb + delta;
    if (next < 0 || next >= S.photos.length) return;
    S.lb = next;
    paintLightbox(body);
  }

  function closeLightbox() {
    const box = $('#ph-lb');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    S.lb = -1;
  }

  async function toggleFav(body) {
    const p = cur();
    if (!p) return;
    try {
      const r = await api.post('/api/photo/favorite/toggle', { file_hash: p.file_hash });
      p.is_favorite = payload(r).is_favorite ? 1 : 0;
      paintFavState();
      paintGrid(body);
    } catch (err) { toast(err.message || '操作失败'); }
  }

  async function trashCurrent(body) {
    const p = cur();
    if (!p) return;
    if (!window.confirm(`把「${p.filename}」移入回收站？`)) return;
    try {
      await api.post('/api/photo/trash/add', { ids: [p.id] });
      toast('已移入回收站', 'ok');
      const keep = S.lb;
      S.photos.splice(keep, 1);
      S.groups = [];
      appendPhotos(S.photos, []);
      if (!S.photos.length) { closeLightbox(); renderPhoto(body, $('#pagehead-actions')); return; }
      S.lb = Math.min(keep, S.photos.length - 1);
      paintGrid(body);
      paintLightbox(body);
    } catch (err) { toast(err.message || '删除失败'); }
  }

  async function toggleInfo() {
    const p = cur();
    const box = $('#plb-info-box');
    if (!p || !box) return;
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="skeleton" style="width:60%"></div>';
    let d;
    try {
      d = await api.post('/api/photo/properties/get', { path: p.fullpath });
    } catch (err) {
      box.innerHTML = `<div class="plb__info-err">读取失败：${escapeHtml(err.message || '')}</div>`;
      return;
    }
    const info = payload(d);
    const exif = info.exif || {};
    const rows = [
      ['文件名', info.filename],
      ['目录', info.dirPath],
      ['尺寸', info.width && info.height ? `${info.width} × ${info.height}` : ''],
      ['大小', fmtBytes(info.size || 0)],
      ['拍摄时间', info.originalTime ? new Date(info.originalTime).toLocaleString() : ''],
      ['设备', [exif.make, exif.model].filter(Boolean).join(' ') || p.camera],
      ['镜头', exif.lensModel],
      ['光圈', exif.fNumber ? `f/${exif.fNumber}` : ''],
      ['快门', exif.exposureTime ? `${exif.exposureTime}s` : ''],
      ['ISO', exif.iso],
      ['焦距', exif.focalLength ? `${exif.focalLength}mm` : ''],
      ['地点', info.geo],
    ].filter(r => r[1]);
    box.innerHTML = `<dl class="plb__dl">${rows.map(r =>
      `<div class="plb__dlrow"><dt>${escapeHtml(r[0])}</dt><dd>${escapeHtml(String(r[1]))}</dd></div>`).join('')}</dl>`;
  }

  /* ---------------- 杂项 ---------------- */
  function errBox(err) {
    return `<div class="card"><div class="card__body"><div class="empty">${escapeHtml(err.message || '加载失败')}</div></div></div>`;
  }

  function currentUid() {
    return (N.state && N.state.user && N.state.user.id) || 0;
  }

  /* ---------------- 快捷键 ----------------
     灯箱开着时只处理它自己的键，别影响背后的网格。 */
  function onKey(e) {
    const box = $('#ph-lb');
    if (!box || box.hidden) return;
    if (e.key === 'Escape') { closeLightbox(); e.preventDefault(); return; }
    if (e.key === 'ArrowLeft') { step(-1, $('#page-body')); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { step(1, $('#page-body')); e.preventDefault(); return; }
    if (e.key === 'i' || e.key === 'I') { toggleInfo(); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);

  /* ---------------- 注册 ---------------- */
  N.registerPage('photo', renderPhoto, { title: '相册', desc: '照片时间线、相册、地点与回收站' });

  // 离开页面时收干净：灯箱、多选条、滚动监听
  const origRoute = N.route;
  N.route = function (id) {
    closeLightbox();
    const bar = $('#ph-selbar');
    if (bar) bar.remove();
    if (S.sentinel && S.sentinel.__io) { S.sentinel.__io.disconnect(); S.sentinel.__io = null; }
    S.sentinel = null;
    S.album = null; S.placeName = ''; S.sel.clear();
    if (id !== 'photo') { resetList(); S.search = ''; S.fileType = ''; S.year = 0; }
    return origRoute(id);
  };
}

window.NasCabPages.push(__register);
if (window.NasCab) {
  try { __register(window.NasCab); } catch (e) { console.error('相册页面注册失败', e); }
}

})();
