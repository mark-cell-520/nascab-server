(function () {
'use strict';

/* ============================================================
   媒体页面：音乐库 + 播放器（歌单 / 播放队列 / 歌词）
            影视库 + 播放器（清晰度选择 / 字幕）
   ============================================================ */
window.NasCabPages = window.NasCabPages || [];

function __register(N) {
  const { api, toast, escapeHtml, fmtBytes, fmtTime, $, $$ } = N;

  /* ---------------- 图标 ---------------- */
  const I = {
    music: '<svg viewBox="0 0 20 20"><path d="M8 15.5V5.2l7-1.6v10.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6.2" cy="15.5" r="1.9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="13.2" cy="13.9" r="1.9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    film: '<svg viewBox="0 0 20 20"><rect x="2.6" y="4.4" width="14.8" height="11.2" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.4 4.4v11.2M13.6 4.4v11.2M2.6 10h14.8" stroke="currentColor" stroke-width="1.3"/></svg>',
    play: '<svg viewBox="0 0 20 20"><path d="M7 5.5l7 4.5-7 4.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 20 20"><rect x="6.4" y="5.4" width="2.6" height="9.2" rx=".8" fill="currentColor"/><rect x="11" y="5.4" width="2.6" height="9.2" rx=".8" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 20 20"><path d="M6.5 5.5l6 4.5-6 4.5z" fill="currentColor"/><rect x="14" y="5.4" width="1.8" height="9.2" rx=".7" fill="currentColor"/></svg>',
    prev: '<svg viewBox="0 0 20 20"><path d="M13.5 5.5l-6 4.5 6 4.5z" fill="currentColor"/><rect x="4.2" y="5.4" width="1.8" height="9.2" rx=".7" fill="currentColor"/></svg>',
    list: '<svg viewBox="0 0 20 20"><path d="M6.6 6h9M6.6 10h9M6.6 14h9M3.4 6h.1M3.4 10h.1M3.4 14h.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    lyric: '<svg viewBox="0 0 20 20"><path d="M4.5 5.5h11M4.5 9h8M4.5 12.5h9M4.5 16h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    heart: '<svg viewBox="0 0 20 20"><path d="M10 16.2S3.6 12.4 3.6 8.2A3.2 3.2 0 0110 6.6a3.2 3.2 0 016.4 1.6c0 4.2-6.4 8-6.4 8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 20 20"><path d="M10 5v10M5 10h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><path d="M4.5 6.5h11M8 6.5V4.8h4v1.7M6 6.5l.7 9h6.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    up: '<svg viewBox="0 0 20 20"><path d="M10 15.5V5M6 9l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 20 20"><path d="M10 4.5V15M6 11l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 20 20"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 3.2v1.6M10 15.2v1.6M4.6 6.4l1.4.8M13.9 12.8l1.4.8M4.6 13.6l1.4-.8M13.9 7.2l1.4-.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    shuffle: '<svg viewBox="0 0 20 20"><path d="M4 5.5h3l6 9h3M14 5.5h2v2M14 12.5h2v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.4 4.2l1.6 1.3-1.6 1.3M16.4 11.2l1.6 1.3-1.6 1.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    repeat: '<svg viewBox="0 0 20 20"><path d="M5 7.5h8.5a2.5 2.5 0 012.5 2.5v0M15 12.5H6.5a2.5 2.5 0 01-2.5-2.5v0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 5.2L4.8 7.5 7 9.8M13 10.2l2.2 2.3L13 14.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    repeat1: '<svg viewBox="0 0 20 20"><path d="M5 7.5h8.5a2.5 2.5 0 012.5 2.5v0M15 12.5H6.5a2.5 2.5 0 01-2.5-2.5v0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 5.2L4.8 7.5 7 9.8M13 10.2l2.2 2.3L13 14.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 7.4v4h-1.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  };

  /* ---------------- 工具 ---------------- */
  const LS_Q = 'nascab.media.queue';
  const LS_P = 'nascab.media.prefs';

  function fmtDur(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const p = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
  }

  /**
   * 带 accessToken 的媒体地址。
   * <audio>/<video> 的 src 发不出 Authorization 头，服务端的
   * extractTokenFromRequest 认 query.accessToken，所以只能这么串。
   */
  function mediaUrl(pathname, params) {
    const q = new URLSearchParams(params || {});
    q.set('accessToken', api.token);
    return `${pathname}?${q.toString()}`;
  }

  function coverUrl(track, size) {
    // series 行 has_inner_cover 恒 0，只能拿它目录下第一首有封面的曲子
    const p = track && track.has_inner_cover ? track.full_path : (track && track.first_file_path);
    if (!p) return '';
    return mediaUrl('/api/music/cover', { file_path: p, size: size || 300 });
  }

  /** 海报是扫描时落到本地的图片文件，走通用文件接口取，size 让 sharp 缩放 */
  function artUrl(absPath, size) {
    if (!absPath) return '';
    return mediaUrl('/api/file/rawFile', { path: absPath, size: size || 300 });
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(LS_P) || '{}') || {}; } catch (_) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(LS_P, JSON.stringify(p)); } catch (_) {}
  }

  /* ============================================================
     音乐播放器（常驻，跨页面不中断）
     ============================================================ */
  const P = {
    audio: null,
    queue: [],
    index: -1,
    playing: false,
    mode: 'list',          // list | shuffle | single
    lyrics: [],
    lyricOn: false,
    barBuilt: false,
  };

  function ensureAudio() {
    if (P.audio) return P.audio;
    const vol = loadPrefs().volume;
    const a = new Audio();
    a.preload = 'metadata';
    a.volume = vol == null ? 0.8 : Number(vol);
    a.addEventListener('timeupdate', onAudioTime);
    a.addEventListener('ended', onAudioEnded);
    a.addEventListener('play', () => { P.playing = true; paintPlayer(); });
    a.addEventListener('pause', () => { P.playing = false; paintPlayer(); });
    a.addEventListener('error', onAudioError);
    P.audio = a;
    return a;
  }

  /** rawFile 解不了的格式（ape/wma/…）退回转码 MP3 */
  function onAudioError() {
    const t = P.queue[P.index];
    if (!t || t._fellBack) return;
    t._fellBack = true;
    const a = ensureAudio();
    a.src = mediaUrl('/api/music/transcode', { path: t.full_path });
    a.play().catch(() => {});
    toast('该格式浏览器无法直接解码，已切换为转码播放', 'warn');
  }

  function onAudioTime() {
    const a = P.audio;
    if (!a) return;
    const cur = $('#mp-cur');
    const dur = $('#mp-dur');
    const bar = $('#mp-seek');
    if (cur) cur.textContent = fmtDur(a.currentTime);
    if (dur && Number.isFinite(a.duration) && a.duration > 0) dur.textContent = fmtDur(a.duration);
    if (bar && Number.isFinite(a.duration) && a.duration > 0) {
      bar.value = String(Math.floor((a.currentTime / a.duration) * 1000));
    }
    paintLyricLine(a.currentTime);
  }

  function onAudioEnded() {
    if (P.mode === 'single') {
      P.audio.currentTime = 0;
      P.audio.play().catch(() => {});
      return;
    }
    playNext(1);
  }

  /** 播放一批曲目。tracks 来自 /api/music/list 的 items */
  function playTracks(tracks, startIndex) {
    const list = (tracks || []).filter(t => t && t.full_path && t.show_type !== 'series');
    if (!list.length) { toast('没有可播放的曲目'); return; }
    P.queue = list.map(t => ({ ...t }));
    let i = Number(startIndex) || 0;
    if (P.mode === 'shuffle' && list.length > 1) i = Math.floor(Math.random() * list.length);
    P.index = i;
    playAt(i, true);
    toast(`开始播放：${list[i].title || list[i].filename}`, 'ok');
  }

  function playAt(i, autoplay) {
    if (i < 0 || i >= P.queue.length) return;
    P.index = i;
    const t = P.queue[i];
    t._fellBack = false;
    const a = ensureAudio();
    a.src = mediaUrl('/api/file/rawFile', { path: t.full_path });
    P.lyrics = [];
    _lyricIdx = -1;
    if (autoplay !== false) {
      a.play().catch(err => toast(err.message || '播放失败'));
    }
    paintPlayer();
    persistQueue();
    // 上报播放次数；同时把详情（含 LRC）取回来
    api.post('/api/music/history/refresh', { index_id: t.id }).catch(() => {});
    loadLyrics(t);
  }

  function playNext(step) {
    if (!P.queue.length) return;
    let i = P.index;
    if (P.mode === 'shuffle') {
      if (P.queue.length === 1) i = 0;
      else {
        let n = i;
        while (n === i) n = Math.floor(Math.random() * P.queue.length);
        i = n;
      }
    } else {
      i += step;
      if (i >= P.queue.length) i = 0;
      if (i < 0) i = P.queue.length - 1;
    }
    playAt(i, true);
  }

  function togglePlay() {
    const a = ensureAudio();
    if (!P.queue.length) { toast('播放队列是空的'); return; }
    if (P.index < 0) { playAt(0, true); return; }
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function cycleMode() {
    P.mode = P.mode === 'list' ? 'shuffle' : P.mode === 'shuffle' ? 'single' : 'list';
    const p = loadPrefs(); p.mode = P.mode; savePrefs(p);
    paintPlayer();
    toast({ list: '顺序播放', shuffle: '随机播放', single: '单曲循环' }[P.mode]);
  }

  async function loadLyrics(t) {
    if (!t || !t.full_path) return;
    try {
      const data = await api.post('/api/music/detail/get', { file_path: t.full_path });
      const lrc = (data.data && (data.data.lyrics || (data.data.item && data.data.item.lyrics))) || '';
      P.lyrics = parseLrc(lrc);
      if (P.lyricOn) renderLyricPanel();
    } catch (_) {}
  }

  function parseLrc(text) {
    const out = [];
    const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      re.lastIndex = 0;
      let m;
      let last = -1;
      const times = [];
      while ((m = re.exec(line)) !== null) {
        const min = Number(m[1]);
        const sec = Number(m[2]);
        const frac = m[3] ? Number(m[3]) : 0;
        const ms = m[3] ? (m[3].length === 3 ? frac : frac * 10) : 0;
        times.push(min * 60 + sec + ms / 1000);
        last = m.index + m[0].length;
      }
      if (!times.length) continue;
      const content = line.slice(last).trim();
      if (!content) continue;
      // 一行多个时间戳（[00:01][00:30]副歌）要展开成多条
      for (const t of times) out.push({ t, text: content });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  let _lyricIdx = -1;
  function paintLyricLine(curSec) {
    if (!P.lyricOn || !P.lyrics.length) return;
    let idx = -1;
    for (let i = 0; i < P.lyrics.length; i += 1) {
      if (P.lyrics[i].t <= curSec + 0.15) idx = i;
      else break;
    }
    if (idx === _lyricIdx) return;
    _lyricIdx = idx;
    $$('#mp-lyric-panel .mplyric__line').forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
    });
    const box = $('#mp-lyric-panel');
    const act = box && box.querySelector('.mplyric__line.is-active');
    if (box && act) {
      const top = act.offsetTop - box.clientHeight / 2 + act.clientHeight / 2;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  /* ---------------- 播放器栏 DOM ---------------- */
  function ensurePlayerBar() {
    if (P.barBuilt) return;
    P.barBuilt = true;
    const bar = document.createElement('div');
    bar.className = 'mpbar';
    bar.id = 'mpbar';
    bar.hidden = true;
    bar.innerHTML = `
      <div class="mpbar__inner">
        <div class="mpbar__track">
          <div class="mpbar__cover" id="mp-cover"></div>
          <div class="mpbar__meta">
            <strong id="mp-title">—</strong>
            <span id="mp-sub"></span>
          </div>
        </div>
        <div class="mpbar__center">
          <div class="mpbar__btns">
            <button class="mpbar__btn" id="mp-mode" title="播放模式">${I.list}</button>
            <button class="mpbar__btn" id="mp-prev" title="上一首">${I.prev}</button>
            <button class="mpbar__btn mpbar__btn--main" id="mp-toggle" title="播放/暂停">${I.play}</button>
            <button class="mpbar__btn" id="mp-next" title="下一首">${I.next}</button>
            <button class="mpbar__btn" id="mp-lyric-toggle" title="歌词">${I.lyric}</button>
          </div>
          <div class="mpbar__seek">
            <span id="mp-cur">0:00</span>
            <input id="mp-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度">
            <span id="mp-dur">0:00</span>
          </div>
        </div>
        <div class="mpbar__right">
          <button class="mpbar__btn" id="mp-queue-toggle" title="播放队列">${I.list}<span id="mp-qcount" class="mpbar__badge">0</span></button>
          <input id="mp-vol" type="range" min="0" max="100" value="80" aria-label="音量">
        </div>
      </div>
      <div class="mplyric" id="mp-lyric-panel" hidden></div>`;
    document.body.appendChild(bar);

    const queue = document.createElement('div');
    queue.className = 'mpqueue';
    queue.id = 'mpqueue';
    queue.hidden = true;
    queue.innerHTML = `
      <div class="mpqueue__head">
        <strong>播放队列</strong>
        <span id="mpqueue-count" class="u-muted"></span>
        <div class="mpqueue__heract">
          <button class="btn btn--ghost btn--sm" id="mpqueue-clear">清空</button>
          <button class="btn btn--ghost btn--sm" id="mpqueue-close">${I.close}</button>
        </div>
      </div>
      <div class="mpqueue__list" id="mpqueue-list"></div>`;
    document.body.appendChild(queue);

    $('#mp-toggle').addEventListener('click', togglePlay);
    $('#mp-next').addEventListener('click', () => playNext(1));
    $('#mp-prev').addEventListener('click', () => playNext(-1));
    $('#mp-mode').addEventListener('click', cycleMode);
    $('#mp-seek').addEventListener('input', e => {
      const a = ensureAudio();
      if (!Number.isFinite(a.duration) || a.duration <= 0) return;
      a.currentTime = (Number(e.target.value) / 1000) * a.duration;
    });
    $('#mp-vol').addEventListener('input', e => {
      const v = Number(e.target.value) / 100;
      ensureAudio().volume = v;
      const p = loadPrefs(); p.volume = v; savePrefs(p);
    });
    $('#mp-queue-toggle').addEventListener('click', () => {
      const q = $('#mpqueue');
      q.hidden = !q.hidden;
      if (!q.hidden) renderQueue();
    });
    $('#mpqueue-close').addEventListener('click', () => { $('#mpqueue').hidden = true; });
    $('#mpqueue-clear').addEventListener('click', () => {
      P.queue = [];
      P.index = -1;
      const a = ensureAudio();
      a.pause();
      a.removeAttribute('src');
      persistQueue();
      renderQueue();
      paintPlayer();
    });
    $('#mp-lyric-toggle').addEventListener('click', () => {
      P.lyricOn = !P.lyricOn;
      $('#mp-lyric-panel').hidden = !P.lyricOn;
      if (P.lyricOn) renderLyricPanel();
      paintPlayer();
    });
  }

  function paintPlayer() {
    ensurePlayerBar();
    const t = P.queue[P.index];
    $('#mpbar').hidden = !t;
    if (!t) return;
    const cu = coverUrl(t, 200);
    $('#mp-cover').innerHTML = cu
      ? `<img src="${escapeHtml(cu)}" alt="">`
      : `<span class="mpbar__coverph">${I.music}</span>`;
    $('#mp-title').textContent = t.title || t.filename || '—';
    $('#mp-sub').textContent = [t.artist, t.album].filter(Boolean).join(' · ') || '—';
    $('#mp-toggle').innerHTML = P.playing ? I.pause : I.play;
    $('#mp-qcount').textContent = String(P.queue.length);
    $('#mp-mode').innerHTML = P.mode === 'shuffle' ? I.shuffle : P.mode === 'single' ? I.repeat1 : I.list;
    $('#mp-mode').title = { list: '顺序播放', shuffle: '随机播放', single: '单曲循环' }[P.mode];
    $('#mp-lyric-toggle').classList.toggle('is-on', P.lyricOn);
    $('#mp-dur').textContent = t.duration ? fmtDur(t.duration) : '--:--';
    renderQueue();
  }

  function renderLyricPanel() {
    const panel = $('#mp-lyric-panel');
    if (!panel) return;
    if (!P.lyrics.length) {
      panel.innerHTML = '<div class="mplyric__empty">暂无歌词</div>';
      return;
    }
    _lyricIdx = -1;
    panel.innerHTML = `<div class="mplyric__lines">${P.lyrics.map(l =>
      `<div class="mplyric__line">${escapeHtml(l.text)}</div>`).join('')}</div>`;
  }

  function renderQueue() {
    const box = $('#mpqueue-list');
    if (!box || $('#mpqueue').hidden) return;
    const cnt = $('#mpqueue-count');
    if (cnt) cnt.textContent = `${P.queue.length} 首`;
    if (!P.queue.length) {
      box.innerHTML = '<div class="empty">队列是空的</div>';
      return;
    }
    box.innerHTML = P.queue.map((t, i) => `
      <div class="mpqueue__item ${i === P.index ? 'is-current' : ''}" data-q="${i}">
        <span class="mpqueue__idx">${i === P.index ? I.play : i + 1}</span>
        <div class="mpqueue__main">
          <div class="mpqueue__title">${escapeHtml(t.title || t.filename)}</div>
          <div class="mpqueue__sub">${escapeHtml([t.artist, t.album].filter(Boolean).join(' · ') || '—')}</div>
        </div>
        <span class="mpqueue__dur">${t.duration ? fmtDur(t.duration) : ''}</span>
        <div class="mpqueue__ops">
          <button class="fm__iconbtn" data-q-up="${i}" title="上移" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
          <button class="fm__iconbtn" data-q-down="${i}" title="下移" ${i === P.queue.length - 1 ? 'disabled' : ''}>${I.down}</button>
          <button class="fm__iconbtn is-danger" data-q-del="${i}" title="移出队列">${I.trash}</button>
        </div>
      </div>`).join('');

    $$('[data-q]', box).forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      playAt(Number(el.dataset.q), true);
    }));
    $$('[data-q-up]', box).forEach(b => b.addEventListener('click', () => moveQueue(Number(b.dataset.qUp), -1)));
    $$('[data-q-down]', box).forEach(b => b.addEventListener('click', () => moveQueue(Number(b.dataset.qDown), 1)));
    $$('[data-q-del]', box).forEach(b => b.addEventListener('click', () => removeFromQueue(Number(b.dataset.qDel))));
  }

  function moveQueue(i, step) {
    const j = i + step;
    if (j < 0 || j >= P.queue.length) return;
    // 先记住当前播的是哪一首，重排后再把下标找回来
    const cur = P.queue[P.index];
    const [it] = P.queue.splice(i, 1);
    P.queue.splice(j, 0, it);
    if (cur) {
      const at = P.queue.indexOf(cur);
      if (at >= 0) P.index = at;
    }
    persistQueue();
    renderQueue();
    paintPlayer();
  }

  function removeFromQueue(i) {
    if (i < 0 || i >= P.queue.length) return;
    const wasCurrent = i === P.index;
    P.queue.splice(i, 1);
    if (wasCurrent) {
      const a = ensureAudio();
      a.pause();
      if (P.queue.length) playAt(Math.min(i, P.queue.length - 1), true);
      else {
        P.index = -1;
        a.removeAttribute('src');
        $('#mpbar').hidden = true;
      }
    } else if (i < P.index) {
      P.index -= 1;
    }
    persistQueue();
    renderQueue();
    paintPlayer();
  }

  function persistQueue() {
    try {
      localStorage.setItem(LS_Q, JSON.stringify({
        queue: P.queue.map(t => ({
          id: t.id, full_path: t.full_path, title: t.title, artist: t.artist,
          album: t.album, duration: t.duration, has_inner_cover: t.has_inner_cover,
          first_file_path: t.first_file_path, filename: t.filename,
        })),
        index: P.index,
      }));
    } catch (_) {}
  }

  /** 从 localStorage 恢复队列：刷新页面后队列与当前曲目都不丢 */
  function restoreQueue() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_Q) || 'null');
      if (!raw || !Array.isArray(raw.queue) || !raw.queue.length) return;
      P.queue = raw.queue;
      P.index = Number.isFinite(raw.index) ? raw.index : -1;
      const t = P.queue[P.index];
      if (t) {
        ensureAudio().src = mediaUrl('/api/file/rawFile', { path: t.full_path });
        paintPlayer();
        loadLyrics(t);
      }
    } catch (_) {}
  }

  /* ============================================================
     音乐页
     ============================================================ */
  const M = {
    view: 'songs',       // songs | albums | artists | group | recent | favorite | playlist
    playlistId: 0,
    groupKey: 'album',
    groupName: '',
    items: [],
    page: 1,
    total: 0,
    search: '',
    sort: 'title',
    playlists: [],
  };

  const MUSIC_VIEWS = [
    { id: 'songs', label: '全部歌曲' },
    { id: 'albums', label: '专辑' },
    { id: 'artists', label: '艺人' },
    { id: 'recent', label: '最近播放' },
    { id: 'favorite', label: '我的收藏' },
  ];

  async function renderMusic(body, actions) {
    ensurePlayerBar();
    restoreQueue();
    actions.innerHTML = `
      <button class="btn btn--ghost btn--sm" id="mu-refresh">刷新</button>
      <button class="btn btn--primary btn--sm" id="mu-newlist">${I.plus}新建歌单</button>`;
    $('#mu-refresh').addEventListener('click', () => N.route('music'));
    $('#mu-newlist').addEventListener('click', promptCreatePlaylist);

    const title = M.view === 'playlist'
      ? (M.playlists.find(p => p.id === M.playlistId) || {}).name || '歌单'
      : M.view === 'group' ? M.groupName : (MUSIC_VIEWS.find(v => v.id === M.view) || {}).label || '音乐';

    body.innerHTML = `
      <div class="media">
        <aside class="media__side">
          <div class="mediaside__group">
            ${MUSIC_VIEWS.map(v => `
              <button class="mediaside__item ${M.view === v.id ? 'is-active' : ''}" data-mv="${v.id}">${escapeHtml(v.label)}</button>`).join('')}
          </div>
          <div class="mediaside__group">
            <div class="mediaside__label">歌单<span class="u-muted" id="mu-pl-count"></span></div>
            <div id="mu-playlists"><div class="mediaside__hint">加载中…</div></div>
          </div>
        </aside>
        <section class="media__main">
          <div class="mediabar">
            <div class="mediabar__title">${escapeHtml(title)}</div>
            <input class="input" id="mu-search" type="search" placeholder="搜索标题 / 歌手 / 专辑" value="${escapeHtml(M.search)}">
            <select class="input input--sel" id="mu-sort">
              <option value="title">按标题</option>
              <option value="artist">按艺人</option>
              <option value="album">按专辑</option>
              <option value="duration">按时长</option>
              <option value="mtime">按添加时间</option>
            </select>
            <button class="btn btn--ghost btn--sm" id="mu-playall">${I.play}播放全部</button>
          </div>
          <div id="mu-list"><div class="card"><div class="card__body"><div class="skeleton" style="width:60%"></div></div></div></div>
          <div class="media__pager" id="mu-pager"></div>
        </section>
      </div>`;

    $$('[data-mv]', body).forEach(b => b.addEventListener('click', () => {
      M.view = b.dataset.mv;
      M.playlistId = 0;
      M.page = 1;
      N.route('music');
    }));

    $('#mu-search').addEventListener('change', e => { M.search = e.target.value.trim(); M.page = 1; loadMusic(); });
    $('#mu-sort').value = M.sort;
    $('#mu-sort').addEventListener('change', e => { M.sort = e.target.value; M.page = 1; loadMusic(); });
    $('#mu-playall').addEventListener('click', () => {
      if (!M.items.length) { toast('列表是空的'); return; }
      playTracks(M.items, 0);
    });

    await Promise.all([loadPlaylists(), loadMusic()]);
  }

  async function loadPlaylists() {
    const box = $('#mu-playlists');
    if (!box) return;
    try {
      const data = await api.post('/api/music/playlist/list', { page: 1, page_size: 100 });
      M.playlists = (data.data && data.data.items) || [];
      const cnt = $('#mu-pl-count');
      if (cnt) cnt.textContent = M.playlists.length ? ` ${M.playlists.length}` : '';
      if (!M.playlists.length) {
        box.innerHTML = '<div class="mediaside__hint">还没有歌单</div>';
        return;
      }
      box.innerHTML = M.playlists.map(p => `
        <div class="mediaside__item mediaside__item--pl ${M.view === 'playlist' && M.playlistId === p.id ? 'is-active' : ''}" data-pl="${p.id}">
          <span class="mediaside__plname">${escapeHtml(p.name)}</span>
          <button class="fm__iconbtn is-danger" data-pl-del="${p.id}" title="删除歌单">${I.trash}</button>
        </div>`).join('');
      $$('[data-pl]', box).forEach(el => el.addEventListener('click', e => {
        if (e.target.closest('[data-pl-del]')) return;
        M.view = 'playlist';
        M.playlistId = Number(el.dataset.pl);
        M.page = 1;
        N.route('music');
      }));
      $$('[data-pl-del]', box).forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('确定删除这个歌单？不会删除磁盘上的音乐文件。')) return;
        try {
          await api.post('/api/music/playlist/delete', { list_id: Number(b.dataset.plDel) });
          toast('已删除', 'ok');
          if (M.view === 'playlist' && M.playlistId === Number(b.dataset.plDel)) {
            M.view = 'songs';
            M.playlistId = 0;
          }
          N.route('music');
        } catch (err) { toast(err.message || '删除失败'); }
      }));
    } catch (err) {
      box.innerHTML = `<div class="mediaside__hint">${escapeHtml(err.message)}</div>`;
    }
  }

  function musicListParams() {
    const p = { page: M.page, page_size: 50, sort_by: M.sort, sort_order: 'asc' };
    if (M.search) p.search = M.search;
    switch (M.view) {
      case 'songs': p.listType = 'music'; break;
      case 'recent': p.is_history = 1; p.listType = 'music'; break;
      case 'favorite': p.is_favorite = 1; break;
      case 'playlist': p.list_id = M.playlistId; break;
      case 'group':
        p.listType = 'music';
        p[M.groupKey === 'album' ? 'albums' : 'artists'] = [M.groupName];
        break;
      default: return null;
    }
    return p;
  }

  async function loadMusic() {
    const box = $('#mu-list');
    if (!box) return;
    if (M.view === 'albums' || M.view === 'artists') {
      await loadGroups(box, M.view === 'albums' ? 'album' : 'artist');
      return;
    }
    const params = musicListParams();
    if (!params) {
      box.innerHTML = '<div class="card"><div class="card__body"><div class="empty">不支持的视图</div></div></div>';
      return;
    }
    box.innerHTML = '<div class="card"><div class="card__body"><div class="skeleton" style="width:55%"></div></div></div>';
    try {
      const data = await api.post('/api/music/list', params);
      M.items = (data.data && data.data.items) || [];
      M.total = (data.data && data.data.pagination && data.data.pagination.total) || 0;
      renderTrackTable(box);
      renderPager();
    } catch (err) {
      box.innerHTML = `<div class="card"><div class="card__body"><div class="empty">${escapeHtml(err.message)}</div></div></div>`;
    }
  }

  async function loadGroups(box, keyType) {
    box.innerHTML = '<div class="card"><div class="card__body"><div class="skeleton" style="width:50%"></div></div></div>';
    try {
      const data = await api.post(`/api/music/${keyType}/list`, { page: M.page, page_size: 60, search: M.search || '' });
      const items = (data.data && data.data.items) || [];
      M.total = (data.data && data.data.pagination && data.data.pagination.total) || 0;
      if (!items.length) {
        box.innerHTML = '<div class="card"><div class="card__body"><div class="empty">暂无数据</div></div></div>';
        renderPager();
        return;
      }
      box.innerHTML = `<div class="cards cards--tiles">${items.map((g, i) => {
        const cu = g.first_file_path ? mediaUrl('/api/music/cover', { file_path: g.first_file_path, size: 300 }) : '';
        return `<div class="tile" data-gi="${i}">
          <div class="tile__cover">${cu ? `<img src="${escapeHtml(cu)}" alt="" loading="lazy">` : `<span class="tile__coverph">${I.music}</span>`}
            <button class="tile__play" data-gplay="${i}" title="播放">${I.play}</button></div>
          <div class="tile__name">${escapeHtml(g.name || '—')}</div>
          <div class="tile__sub">${g.index_count || 0} 首</div>
        </div>`;
      }).join('')}</div>`;

      $$('[data-gplay]', box).forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        const g = items[Number(b.dataset.gplay)];
        try {
          const d = await api.post('/api/music/list', {
            page: 1, page_size: 200, listType: 'music',
            [keyType === 'album' ? 'albums' : 'artists']: [g.name],
          });
          playTracks((d.data && d.data.items) || [], 0);
        } catch (err) { toast(err.message || '加载失败'); }
      }));
      $$('[data-gi]', box).forEach(el => el.addEventListener('click', () => {
        M.groupKey = keyType;
        M.groupName = items[Number(el.dataset.gi)].name;
        M.view = 'group';
        M.page = 1;
        N.route('music');
      }));
      renderPager();
    } catch (err) {
      box.innerHTML = `<div class="card"><div class="card__body"><div class="empty">${escapeHtml(err.message)}</div></div></div>`;
    }
  }

  function renderTrackTable(box) {
    if (!M.items.length) {
      box.innerHTML = '<div class="card"><div class="card__body"><div class="empty">没有曲目</div></div></div>';
      return;
    }
    const inPlaylist = M.view === 'playlist';
    const currentId = P.queue[P.index] ? P.queue[P.index].id : 0;
    box.innerHTML = `<div class="card"><div class="card__body card__body--flush">
      <div class="tbl-wrap"><table class="tbl tbl--tracks">
      <thead><tr>
        <th class="tbl__idx">#</th><th>标题</th><th>艺人</th><th>专辑</th>
        <th class="tbl__num">时长</th><th class="tbl__num">大小</th><th class="tbl__ops">操作</th>
      </tr></thead>
      <tbody>${M.items.map((t, i) => {
        const cu = coverUrl(t, 100);
        return `<tr data-ti="${i}" class="${currentId === t.id ? 'is-current' : ''}">
          <td class="tbl__idx">
            <button class="tbl__play" data-tplay="${i}" title="播放">${I.play}</button>
            <span class="tbl__num">${(M.page - 1) * 50 + i + 1}</span>
          </td>
          <td><div class="track__name">${cu ? `<img class="track__cover" src="${escapeHtml(cu)}" alt="" loading="lazy">` : ''}
            <div><b>${escapeHtml(t.title || t.filename)}</b>
            ${t.has_inner_cover ? '' : '<span class="u-muted"> · 无封面</span>'}</div></div></td>
          <td>${escapeHtml(t.artist || '—')}</td>
          <td>${escapeHtml(t.album || '—')}</td>
          <td class="tbl__num">${t.duration ? fmtDur(t.duration) : '—'}</td>
          <td class="tbl__num">${fmtBytes(t.size)}</td>
          <td class="tbl__ops">
            <button class="fm__iconbtn" data-tnext="${i}" title="下一首播放">${I.next}</button>
            <button class="fm__iconbtn" data-tpl="${i}" title="添加到歌单">${I.plus}</button>
            <button class="fm__iconbtn" data-tfav="${i}" title="收藏">${I.heart}</button>
            ${inPlaylist ? `<button class="fm__iconbtn" data-tup="${i}" title="上移" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
              <button class="fm__iconbtn" data-tdown="${i}" title="下移" ${i === M.items.length - 1 ? 'disabled' : ''}>${I.down}</button>
              <button class="fm__iconbtn is-danger" data-tdel="${i}" title="从歌单移除">${I.trash}</button>` : ''}
          </td>
        </tr>`;
      }).join('')}</tbody></table></div></div></div>`;

    $$('[data-tplay]', box).forEach(b => b.addEventListener('click', () => playTracks(M.items, Number(b.dataset.tplay))));
    $$('[data-tnext]', box).forEach(b => b.addEventListener('click', () => {
      const t = M.items[Number(b.dataset.tnext)];
      P.queue.splice(P.index + 1, 0, { ...t });
      persistQueue();
      renderQueue();
      paintPlayer();
      toast('已插入到下一首', 'ok');
    }));
    $$('[data-tpl]', box).forEach(b => b.addEventListener('click', () => openAddToPlaylist(M.items[Number(b.dataset.tpl)])));
    $$('[data-tfav]', box).forEach(b => b.addEventListener('click', async () => {
      const t = M.items[Number(b.dataset.tfav)];
      try {
        await api.post('/api/music/favorite/add', { index_id: t.id });
        toast('已收藏', 'ok');
      } catch (err) { toast(err.message || '操作失败'); }
    }));
    if (inPlaylist) {
      $$('[data-tup]', box).forEach(b => b.addEventListener('click', () => playlistMove(Number(b.dataset.tup), -1)));
      $$('[data-tdown]', box).forEach(b => b.addEventListener('click', () => playlistMove(Number(b.dataset.tdown), 1)));
      $$('[data-tdel]', box).forEach(b => b.addEventListener('click', async () => {
        const t = M.items[Number(b.dataset.tdel)];
        try {
          await api.post('/api/music/playlist/index/remove', { list_id: M.playlistId, index_ids: [t.id] });
          toast('已从歌单移除', 'ok');
          loadMusic();
        } catch (err) { toast(err.message || '操作失败'); }
      }));
    }
  }

  /** 歌单内上移/下移：把整表顺序重排后一次性提交 */
  async function playlistMove(i, step) {
    const j = i + step;
    if (j < 0 || j >= M.items.length) return;
    const ids = M.items.map(t => t.id);
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
    try {
      await api.post('/api/music/playlist/index/reorder', { list_id: M.playlistId, index_ids: ids });
      await loadMusic();
    } catch (err) { toast(err.message || '排序失败'); }
  }

  function renderPager() {
    const box = $('#mu-pager');
    if (!box) return;
    const pages = Math.max(1, Math.ceil(M.total / 50));
    if (pages <= 1) {
      box.innerHTML = `<span class="u-muted">共 ${M.total} 项</span>`;
      return;
    }
    box.innerHTML = `
      <span class="u-muted">共 ${M.total} 项 · 第 ${M.page}/${pages} 页</span>
      <div class="pager__btns">
        <button class="btn btn--ghost btn--sm" id="mu-prev-page" ${M.page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn btn--ghost btn--sm" id="mu-next-page" ${M.page >= pages ? 'disabled' : ''}>下一页</button>
      </div>`;
    const prev = $('#mu-prev-page');
    const next = $('#mu-next-page');
    if (prev) prev.addEventListener('click', () => { M.page -= 1; loadMusic(); });
    if (next) next.addEventListener('click', () => { M.page += 1; loadMusic(); });
  }

  function promptCreatePlaylist() {
    openModal({
      title: '新建歌单',
      body: `<label class="field"><span>歌单名称</span>
        <input class="input" id="pl-name" maxlength="60" placeholder="例如：通勤路上"></label>`,
      okText: '创建',
      onOk: async () => {
        const name = ($('#pl-name').value || '').trim();
        if (!name) { toast('请输入名称'); return false; }
        try {
          await api.post('/api/music/playlist/create', { name });
          toast('已创建', 'ok');
          N.route('music');
          return true;
        } catch (err) { toast(err.message || '创建失败'); return false; }
      },
    });
  }

  function openAddToPlaylist(track) {
    if (!track) return;
    openModal({
      title: '添加到歌单',
      body: `
        <div class="u-muted" style="margin-bottom:8px">${escapeHtml(track.title || track.filename)}</div>
        ${M.playlists.length ? `<div class="picklist">${M.playlists.map(p => `
          <button class="picklist__item" data-pick="${p.id}">${escapeHtml(p.name)}</button>`).join('')}</div>`
          : '<div class="empty">还没有歌单，请先新建</div>'}`,
      after: () => {
        $$('[data-pick]').forEach(b => b.addEventListener('click', async () => {
          try {
            await api.post('/api/music/playlist/index/add', { list_id: Number(b.dataset.pick), index_ids: [track.id] });
            toast('已添加', 'ok');
            closeModal();
          } catch (err) { toast(err.message || '添加失败'); }
        }));
      },
    });
  }

  /* ============================================================
     影视页
     ============================================================ */
  const V = {
    items: [],
    page: 1,
    total: 0,
    mediaType: '',
    sort: 'create_time',
    search: '',
    qualities: [],
    quality: 'original',
    duration: 0,
    baseSeek: 0,
    filePath: '',
  };

  async function renderVideo(body, actions) {
    actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="vd-refresh">刷新</button>`;
    $('#vd-refresh').addEventListener('click', () => N.route('video'));
    body.innerHTML = `
      <div class="mediabar mediabar--video">
        <input class="input" id="vd-search" type="search" placeholder="搜索片名 / 演员 / 导演" value="${escapeHtml(V.search)}">
        <select class="input input--sel" id="vd-type">
          <option value="">全部类型</option>
          <option value="movie" ${V.mediaType === 'movie' ? 'selected' : ''}>电影</option>
          <option value="tv" ${V.mediaType === 'tv' ? 'selected' : ''}>剧集</option>
        </select>
        <select class="input input--sel" id="vd-sort">
          <option value="create_time" ${V.sort === 'create_time' ? 'selected' : ''}>最近添加</option>
          <option value="year" ${V.sort === 'year' ? 'selected' : ''}>年份</option>
          <option value="score" ${V.sort === 'score' ? 'selected' : ''}>评分</option>
          <option value="name" ${V.sort === 'name' ? 'selected' : ''}>片名</option>
        </select>
        <span class="u-muted" id="vd-total"></span>
      </div>
      <div id="vd-grid"><div class="cards cards--posters">${'<div class="skeleton" style="height:220px"></div>'.repeat(8)}</div></div>
      <div class="media__pager" id="vd-pager"></div>`;

    $('#vd-search').addEventListener('change', e => { V.search = e.target.value.trim(); V.page = 1; loadVideos(); });
    $('#vd-type').addEventListener('change', e => { V.mediaType = e.target.value; V.page = 1; loadVideos(); });
    $('#vd-sort').addEventListener('change', e => { V.sort = e.target.value; V.page = 1; loadVideos(); });
    await loadVideos();
  }

  async function loadVideos() {
    const box = $('#vd-grid');
    if (!box) return;
    try {
      const data = await api.post('/api/video/list', {
        page: V.page,
        page_size: 48,
        media_type: V.mediaType || undefined,
        sort_by: V.sort,
        sort_order: V.sort === 'name' ? 'asc' : 'desc',
        search: V.search || undefined,
      });
      V.items = (data.data && data.data.items) || [];
      V.total = (data.data && data.data.pagination && data.data.pagination.total) || 0;
      const t = $('#vd-total');
      if (t) t.textContent = `共 ${V.total} 部`;
      renderVideoGrid(box);
      renderVideoPager();
    } catch (err) {
      box.innerHTML = `<div class="card"><div class="card__body"><div class="empty">${escapeHtml(err.message)}</div></div></div>`;
    }
  }

  function renderVideoGrid(box) {
    if (!V.items.length) {
      box.innerHTML = '<div class="card"><div class="card__body"><div class="empty">还没有影片。先在「应用中心」启用影视，添加媒体库并扫描入库。</div></div></div>';
      return;
    }
    box.innerHTML = `<div class="cards cards--posters">${V.items.map((it, i) => {
      const poster = artUrl(it.poster_path, 300);
      const year = it.nfo_year ? ` · ${escapeHtml(String(it.nfo_year))}` : '';
      return `<div class="poster" data-vi="${i}">
        <div class="poster__img">${poster ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy">` : `<span class="poster__ph">${I.film}</span>`}
          <button class="poster__play" data-vplay="${i}" title="播放">${I.play}</button>
          ${it.nfo_score ? `<span class="poster__score">${escapeHtml(String(it.nfo_score))}</span>` : ''}</div>
        <div class="poster__name">${escapeHtml(it.nfo_name || it.filename)}${year}</div>
      </div>`;
    }).join('')}</div>`;

    $$('[data-vplay]', box).forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const it = V.items[Number(b.dataset.vplay)];
      try {
        const data = await api.get(`/api/video/detail?index_id=${encodeURIComponent(it.id)}`);
        const d = data.data || {};
        const item = d.item || it;
        startVideo(item, Number((d.history || {}).playback_position) || 0);
      } catch (err) {
        toast(err.message || '加载失败');
      }
    }));
    $$('[data-vi]', box).forEach(el => el.addEventListener('click', () => openVideoDetail(Number(el.dataset.vi))));
  }

  function renderVideoPager() {
    const box = $('#vd-pager');
    if (!box) return;
    const pages = Math.max(1, Math.ceil(V.total / 48));
    if (pages <= 1) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <span class="u-muted">第 ${V.page}/${pages} 页</span>
      <div class="pager__btns">
        <button class="btn btn--ghost btn--sm" id="vd-prev" ${V.page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn btn--ghost btn--sm" id="vd-next" ${V.page >= pages ? 'disabled' : ''}>下一页</button>
      </div>`;
    const p = $('#vd-prev');
    const n = $('#vd-next');
    if (p) p.addEventListener('click', () => { V.page -= 1; loadVideos(); });
    if (n) n.addEventListener('click', () => { V.page += 1; loadVideos(); });
  }

  async function openVideoDetail(i) {
    const it = V.items[i];
    if (!it) return;
    try {
      const data = await api.get(`/api/video/detail?index_id=${encodeURIComponent(it.id)}`);
      openVideoDetailModal(data.data || { item: it });
    } catch (err) {
      openVideoDetailModal({ item: it });
    }
  }

  function openVideoDetailModal(d) {
    const item = d.item || {};
    const poster = artUrl(item.poster_path, 400);
    const hist = d.history || {};
    const progress = hist.duration ? Math.min(100, (hist.playback_position / hist.duration) * 100) : 0;
    openModal({
      title: item.nfo_name || item.filename || '影片详情',
      wide: true,
      body: `
        <div class="vdetail">
          <div class="vdetail__poster">${poster ? `<img src="${escapeHtml(poster)}" alt="">` : `<span class="poster__ph">${I.film}</span>`}</div>
          <div class="vdetail__meta">
            <div class="vdetail__row"><span>年份</span><b>${escapeHtml(item.nfo_year || '—')}</b></div>
            <div class="vdetail__row"><span>评分</span><b>${escapeHtml(item.nfo_score || '—')}</b></div>
            <div class="vdetail__row"><span>类型</span><b>${escapeHtml(item.media_type || '—')}</b></div>
            <div class="vdetail__row"><span>地区</span><b>${escapeHtml(item.nfo_regions || '—')}</b></div>
            <div class="vdetail__row"><span>时长</span><b>${item.duration ? fmtDur(item.duration) : '—'}</b></div>
            <div class="vdetail__row"><span>分辨率</span><b>${item.width && item.height ? `${item.width}×${item.height}` : '—'}</b></div>
            <div class="vdetail__row"><span>演员</span><b>${escapeHtml(item.nfo_actor || '—')}</b></div>
            <div class="vdetail__row"><span>导演</span><b>${escapeHtml(item.nfo_director || '—')}</b></div>
            ${progress > 0 ? `<div class="vdetail__progress"><div class="vdetail__progressbar"><i style="width:${progress.toFixed(1)}%"></i></div><span>已看 ${progress.toFixed(0)}%</span></div>` : ''}
            <div class="vdetail__plot">${escapeHtml(item.nfo_storyline || '暂无简介')}</div>
          </div>
        </div>`,
      okText: hist.playback_position ? '继续播放' : '播放',
      onOk: () => { startVideo(item, Number(hist.playback_position) || 0); return true; },
    });
  }

  /* ---------------- 视频播放器 ---------------- */
  function ensureVideoStage() {
    if ($('#vstage')) return;
    const st = document.createElement('div');
    st.className = 'vstage';
    st.id = 'vstage';
    st.hidden = true;
    st.innerHTML = `
      <video id="vstage-video" class="vstage__video" playsinline preload="metadata"></video>
      <div class="vstage__top">
        <div class="vstage__title" id="vstage-title">—</div>
        <div class="vstage__topact">
          <div class="qsel" id="vstage-qsel">
            <button class="qsel__btn" id="vstage-qbtn"><span id="vstage-qlabel">清晰度</span>${I.gear}</button>
            <div class="qsel__menu" id="vstage-qmenu" hidden></div>
          </div>
          <button class="vstage__btn" id="vstage-close" title="退出播放">${I.close}</button>
        </div>
      </div>
      <div class="vstage__err" id="vstage-err" hidden></div>
      <div class="vstage__bottom">
        <div class="vstage__seek">
          <span id="vstage-cur">0:00</span>
          <input id="vstage-bar" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度">
          <span id="vstage-dur">0:00</span>
        </div>
        <div class="vstage__ctrls">
          <button class="vstage__btn vstage__btn--main" id="vstage-toggle">${I.play}</button>
          <span class="vstage__stat" id="vstage-stat"></span>
        </div>
      </div>`;
    document.body.appendChild(st);

    const v = $('#vstage-video');
    v.addEventListener('timeupdate', onVideoTime);
    v.addEventListener('play', () => { $('#vstage-toggle').innerHTML = I.pause; });
    v.addEventListener('pause', () => { $('#vstage-toggle').innerHTML = I.play; });
    v.addEventListener('error', onVideoError);
    $('#vstage-toggle').addEventListener('click', () => { if (v.paused) v.play().catch(() => {}); else v.pause(); });
    $('#vstage-close').addEventListener('click', closeVideo);
    $('#vstage-bar').addEventListener('input', e => {
      seekVideo((Number(e.target.value) / 1000) * (V.duration || 0));
    });
    $('#vstage-qbtn').addEventListener('click', e => {
      e.stopPropagation();
      $('#vstage-qmenu').hidden = !$('#vstage-qmenu').hidden;
    });
    document.addEventListener('click', e => {
      const m = $('#vstage-qmenu');
      if (m && !m.hidden && !e.target.closest('#vstage-qsel')) m.hidden = true;
    });
    document.addEventListener('keydown', e => {
      if ($('#vstage').hidden) return;
      if (e.key === 'Escape') closeVideo();
      else if (e.key === ' ') { e.preventDefault(); $('#vstage-toggle').click(); }
    });
  }

  function onVideoTime() {
    const v = $('#vstage-video');
    if (!v) return;
    const pos = V.baseSeek + (Number(v.currentTime) || 0);
    const cur = $('#vstage-cur');
    const dur = $('#vstage-dur');
    const bar = $('#vstage-bar');
    if (cur) cur.textContent = fmtDur(pos);
    if (dur) dur.textContent = V.duration ? fmtDur(V.duration) : '--:--';
    if (bar && V.duration > 0) bar.value = String(Math.floor((pos / V.duration) * 1000));
    // 断点续播：整数秒时落一次，关掉页面也不丢
    if (V.filePath && Math.floor(pos) % 10 === 0) saveVideoProgress(pos);
  }

  let _progTimer = 0;
  function saveVideoProgress(pos) {
    clearTimeout(_progTimer);
    _progTimer = setTimeout(() => {
      api.post('/api/videoPlayer/preference', {
        filePath: V.filePath,
        playback_position: Math.floor(pos),
        quality: V.quality,
      }).catch(() => {});
    }, 1500);
  }

  function onVideoError() {
    const box = $('#vstage-err');
    if (!box) return;
    // 非原画起播失败时回落一次原画，别直接把用户扔在错误页上
    if (V.quality !== 'original' && !V._fellBack) {
      V._fellBack = true;
      setQuality('original', true);
      toast('该清晰度起播失败，已回落到原画', 'warn');
      return;
    }
    box.hidden = false;
    box.textContent = '播放失败：浏览器无法解码这个源。可尝试切换清晰度（会重编码），或下载后用本地播放器观看。';
  }

  function videoStreamUrl(seek) {
    const params = { filePath: V.filePath, mode: 'copy' };
    if (seek > 0) params.seek = String(Math.floor(seek));
    // 原画 = 纯 remux 不重编码；其它档位交给服务端按档位缩放+控码率
    if (V.quality && V.quality !== 'original') {
      params.quality = V.quality;
      delete params.mode;
    }
    return mediaUrl('/api/videoPlayer/stream-mp4', params);
  }

  async function startVideo(item, seek) {
    if (!item) return;
    const filePath = item.play_file_path || item.first_file_path || item.full_path;
    if (!filePath) { toast('这个条目没有可播放的文件'); return; }
    V.filePath = filePath;
    V.duration = Number(item.duration) || 0;
    V.baseSeek = Number(seek) || 0;
    V.quality = 'original';
    V._fellBack = false;

    ensureVideoStage();
    $('#vstage').hidden = false;
    document.body.classList.add('has-vstage');
    $('#vstage-title').textContent = item.nfo_name || item.filename || '—';
    $('#vstage-err').hidden = true;
    $('#vstage-qlabel').textContent = '原画';

    const v = $('#vstage-video');
    v.src = videoStreamUrl(V.baseSeek);
    v.play().catch(() => {});
    paintQualityMenu();

    // 档位表 + 用户上次的选择
    try {
      const q = await api.get(`/api/videoPlayer/qualities?filePath=${encodeURIComponent(filePath)}`);
      V.qualities = (q.data && q.data.qualities) || [];
      const pref = q.data && q.data.preference && q.data.preference.quality;
      if (pref && pref !== 'original') {
        const tier = V.qualities.find(x => x.key === pref);
        if (tier && tier.available) {
          V.quality = pref;
          v.src = videoStreamUrl(V.baseSeek);
          $('#vstage-qlabel').textContent = tier.label;
        }
      }
      paintQualityMenu();
    } catch (_) {}
  }

  function paintQualityMenu() {
    const menu = $('#vstage-qmenu');
    if (!menu) return;
    const rows = V.qualities.length ? V.qualities : [{ key: 'original', label: '原画', available: true, desc: '' }];
    menu.innerHTML = rows.map(q => `
      <button class="qsel__item ${q.key === V.quality ? 'is-active' : ''}" data-q="${escapeHtml(q.key)}" ${q.available ? '' : 'disabled'}>
        <span class="qsel__key">${escapeHtml(q.label)}${q.recommended ? ' <em>推荐</em>' : ''}</span>
        <span class="qsel__desc">${escapeHtml(q.upscale ? '高于源分辨率，不推荐' : q.desc || '')}</span>
      </button>`).join('');
    $$('[data-q]', menu).forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = true;
      setQuality(b.dataset.q, false);
    }));
  }

  function setQuality(key, silent) {
    const tier = V.qualities.find(q => q.key === key);
    if (tier && tier.available === false) {
      toast('源分辨率低于该档位，切过去只会更大不会更清晰');
      return;
    }
    if (key === V.quality) return;
    const v = $('#vstage-video');
    // 从当前播放位置接着切，不让用户从头看
    const pos = V.baseSeek + (Number(v.currentTime) || 0);
    V.quality = key;
    V.baseSeek = pos;
    V._fellBack = false;
    $('#vstage-qlabel').textContent = (tier && tier.label) || '原画';
    v.src = videoStreamUrl(pos);
    v.play().catch(() => {});
    paintQualityMenu();
    saveVideoProgress(pos);
    if (!silent) toast(`已切换到 ${(tier && tier.label) || key}${key === 'original' ? '' : '（转码需要几秒起播）'}`, 'ok');
  }

  function seekVideo(t) {
    const v = $('#vstage-video');
    V.baseSeek = Math.max(0, Math.floor(t));
    v.src = videoStreamUrl(V.baseSeek);
    v.play().catch(() => {});
    saveVideoProgress(V.baseSeek);
  }

  function closeVideo() {
    const st = $('#vstage');
    if (!st) return;
    const v = $('#vstage-video');
    const pos = V.baseSeek + (Number(v.currentTime) || 0);
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
    st.hidden = true;
    document.body.classList.remove('has-vstage');
    if (V.filePath && pos > 3) saveVideoProgress(pos);
  }

  /* ============================================================
     弹层
     ============================================================ */
  function openModal({ title, body, okText, onOk, after, wide }) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.id = 'media-modal';
    wrap.innerHTML = `
      <div class="modal__mask" data-close="1"></div>
      <div class="modal__box ${wide ? 'modal__box--wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal__head"><h3>${escapeHtml(title || '')}</h3>
          <button class="modal__x" data-close="1" aria-label="关闭">${I.close}</button></div>
        <div class="modal__body">${body || ''}</div>
        ${okText ? `<div class="modal__foot"><button class="btn btn--ghost" data-close="1">取消</button>
          <button class="btn btn--primary" id="modal-ok">${escapeHtml(okText)}</button></div>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    $$('[data-close]', wrap).forEach(el => el.addEventListener('click', closeModal));
    if (okText && onOk) {
      $('#modal-ok').addEventListener('click', async () => {
        const keep = await onOk();
        if (keep !== true) closeModal();
      });
    }
    if (after) after();
  }

  function closeModal() {
    const m = $('#media-modal');
    if (m) m.remove();
  }

  /* ============================================================
     注册
     ============================================================ */
  N.registerPage('music', renderMusic, { title: '音乐', desc: '音乐库、歌单与播放队列' });
  N.registerPage('video', renderVideo, { title: '影视', desc: '影片海报墙与在线播放' });

  // 离开页面时收起队列/歌词抽屉；音频继续播放，这才叫常驻播放器
  const origRoute = N.route;
  N.route = function (id) {
    const q = $('#mpqueue');
    if (q) q.hidden = true;
    if (id !== 'music') {
      const panel = $('#mp-lyric-panel');
      if (panel) panel.hidden = true;
      P.lyricOn = false;
    }
    return origRoute(id);
  };

  ensurePlayerBar();
  const prefs = loadPrefs();
  if (prefs.mode) P.mode = prefs.mode;
  restoreQueue();
}

// console.js 已就绪就直接注册；否则等 bootPages() 兜底
window.NasCabPages.push(__register);
if (window.NasCab) {
  try { __register(window.NasCab); } catch (e) { console.error('媒体页面模块注册失败', e); }
}

})();
