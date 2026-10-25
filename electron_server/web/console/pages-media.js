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
    cc: '<svg viewBox="0 0 20 20"><rect x="2.6" y="4.4" width="14.8" height="11.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8.6 8.6a1.9 1.9 0 100 2.8M13.4 8.6a1.9 1.9 0 100 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    audio: '<svg viewBox="0 0 20 20"><path d="M10 4.2L6.4 7.2H4v5.6h2.4L10 15.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 7.6a3.4 3.4 0 010 4.8M15.4 5.6a6.2 6.2 0 010 8.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 20 20"><path d="M10 4.2L6.4 7.2H4v5.6h2.4L10 15.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13.4 8l4 4M17.4 8l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    speed: '<svg viewBox="0 0 20 20"><path d="M3.6 14.4a7 7 0 1112.8 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10 10.6l3.4-2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="11.4" r="1.2" fill="currentColor"/></svg>',
    fs: '<svg viewBox="0 0 20 20"><path d="M4 8V4.6h4M16 12v3.4h-4M16 8V4.6h-4M4 12v3.4h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    pip: '<svg viewBox="0 0 20 20"><rect x="2.6" y="4.4" width="14.8" height="11.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11.4" y="9.6" width="4.6" height="4" rx=".8" fill="currentColor"/></svg>',
    text: '<svg viewBox="0 0 20 20"><path d="M4.5 5.5h11M10 5.5v10M7.4 15.5h5.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
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
    /* 音轨 / 字幕 / 倍速：都由 GET /api/videoPlayer/tracks 给出候选 */
    audioTracks: [],
    audioIndex: 0,
    subtitleTracks: [],
    subtitleRef: '',          // '' 表示关闭字幕
    subOffset: 0,             // 字幕延时（秒），正数延后
    speed: '1',
    /* 片头片尾（video_index.open_skip_*_sec） */
    openSkip: { startSec: 0, endSec: 0 },
    autoSkipIntro: false,
    /* 连播：tvPlayInfo 的 playlist */
    episodes: [],
    epIndex: -1,
    autoplayNext: true,
    _fellBack: false,
    /* 源能不能直连播放（/tracks 的 directPlay）。false 时原画档位必然放不出来 */
    directPlay: null,
    _autoSwitched: false,
    _introSkipped: false,
    _nextTimer: 0,
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

  /** 剧集列表：tv 走 /episodes，season 直接就是一级列表 */
  async function loadEpisodeList(item) {
    const type = String(item.media_type || '');
    if (type !== 'tv' && type !== 'season') return [];
    try {
      const data = await api.get(`/api/video/episodes?index_id=${encodeURIComponent(item.id)}&page=1&page_size=200&sort_order=asc`);
      const d = data.data || {};
      const items = Array.isArray(d.items) ? d.items : (Array.isArray(d.list) ? d.list : []);
      return items.filter(x => x && Number(x.is_file) === 1);
    } catch (_) {
      return [];
    }
  }

  function openVideoDetailModal(d) {
    const item = d.item || {};
    const poster = artUrl(item.poster_path, 400);
    const hist = d.history || {};
    const progress = hist.duration ? Math.min(100, (hist.playback_position / hist.duration) * 100) : 0;
    const seasons = Array.isArray(d.seasonList) ? d.seasonList : [];
    const episodes = Array.isArray(d.episodeList) ? d.episodeList : [];
    const isSeries = String(item.media_type || '') === 'tv' || String(item.media_type || '') === 'season';
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
        </div>
        ${isSeries ? `<div class="eplist" id="vd-eplist"><div class="eplist__hd">剧集加载中…</div></div>` : ''}`,
      okText: hist.playback_position ? '继续播放' : '播放',
      onOk: () => { startVideo(item, Number(hist.playback_position) || 0); return true; },
      after: () => { if (isSeries) paintEpisodes(item, seasons, episodes); },
    });
  }

  async function paintEpisodes(item, seasons, episodes) {
    const box = $('#vd-eplist');
    if (!box) return;
    let list = episodes;
    if (!list.length) list = await loadEpisodeList(item);
    if (!list.length) { box.innerHTML = '<div class="eplist__hd">没有取到剧集列表</div>'; return; }
    box.innerHTML = `<div class="eplist__hd">共 ${list.length} 集${seasons.length ? ` · ${seasons.length} 季` : ''}</div>
      <div class="eplist__grid">${list.map((ep, i) => {
        const num = Number(ep.episod_num) || (i + 1);
        const name = ep.nfo_name || ep.filename || `第 ${num} 集`;
        const p = Number(ep.duration) || 0;
        return `<button class="eplist__item" data-ep="${i}" title="${escapeHtml(String(name))}">
          <b>${num}</b><span>${escapeHtml(String(name))}</span>${p ? `<i>${fmtDur(p)}</i>` : ''}</button>`;
      }).join('')}</div>`;
    $$('[data-ep]', box).forEach(b => b.addEventListener('click', () => {
      const ep = list[Number(b.dataset.ep)];
      if (ep) startVideo(ep, 0);
    }));
  }

  /* ---------------- 视频播放器 ---------------- */

  /** 字幕 WebVTT 地址。内嵌轨按 ffprobe 流号取，外挂轨直接给字幕文件路径 */
  function subtitleVttUrl(t) {
    if (!t) return '';
    const p = t.kind === 'external'
      ? { subtitlePath: t.path, subtitleIndex: 0 }
      : { filePath: V.filePath, subtitleIndex: t.index };
    return mediaUrl('/api/videoPlayer/subtitle-vtt', p);
  }

  function ensureVideoStage() {
    if ($('#vstage')) return;
    const st = document.createElement('div');
    st.className = 'vstage';
    st.id = 'vstage';
    st.hidden = true;
    st.innerHTML = `
      <video id="vstage-video" class="vstage__video" playsinline preload="metadata"></video>
      <div class="vstage__load" id="vstage-load" hidden><i class="vstage__spin"></i><span id="vstage-loadtxt">起播中…</span></div>
      <div class="vstage__top">
        <div class="vstage__title" id="vstage-title">—</div>
        <div class="vstage__topact">
          <div class="qsel" id="vstage-qsel">
            <button class="qsel__btn" id="vstage-qbtn" title="清晰度"><span id="vstage-qlabel">清晰度</span>${I.gear}</button>
            <div class="qsel__menu" id="vstage-qmenu" hidden></div>
          </div>
          <div class="qsel" id="vstage-ssel">
            <button class="qsel__btn" id="vstage-sbtn" title="字幕">${I.cc}<span id="vstage-slabel">字幕</span></button>
            <div class="qsel__menu qsel__menu--wide" id="vstage-smenu" hidden></div>
          </div>
          <div class="qsel" id="vstage-asel">
            <button class="qsel__btn" id="vstage-abtn" title="音轨">${I.audio}<span id="vstage-alabel">音轨</span></button>
            <div class="qsel__menu" id="vstage-amenu" hidden></div>
          </div>
          <div class="qsel" id="vstage-rsel">
            <button class="qsel__btn" id="vstage-rbtn" title="倍速">${I.speed}<span id="vstage-rlabel">倍速</span></button>
            <div class="qsel__menu" id="vstage-rmenu" hidden></div>
          </div>
          <button class="vstage__btn" id="vstage-pip" title="画中画">${I.pip}</button>
          <button class="vstage__btn" id="vstage-fs" title="全屏 (F)">${I.fs}</button>
          <button class="vstage__btn" id="vstage-close" title="退出播放 (Esc)">${I.close}</button>
        </div>
      </div>
      <button class="vstage__skip" id="vstage-skipintro" hidden>跳过片头</button>
      <div class="vstage__next" id="vstage-next" hidden></div>
      <div class="vstage__err" id="vstage-err" hidden></div>
      <div class="vstage__bottom">
        <div class="vstage__seek">
          <span id="vstage-cur">0:00</span>
          <div class="vstage__barwrap">
            <div class="vstage__buffered"><i id="vstage-buf"></i></div>
            <input id="vstage-bar" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度">
          </div>
          <span id="vstage-dur">0:00</span>
        </div>
        <div class="vstage__ctrls">
          <button class="vstage__btn" id="vstage-prev" title="上一集" hidden>${I.prev}</button>
          <button class="vstage__btn vstage__btn--main" id="vstage-toggle" title="播放/暂停 (空格)">${I.play}</button>
          <button class="vstage__btn" id="vstage-next" title="下一集 (N)" hidden>${I.next}</button>
          <span class="vstage__stat" id="vstage-stat"></span>
          <div class="vstage__vol">
            <button class="vstage__btn" id="vstage-mute" title="静音 (M)">${I.audio}</button>
            <input id="vstage-vol" type="range" min="0" max="100" value="100" aria-label="音量">
          </div>
        </div>
      </div>`;
    document.body.appendChild(st);

    const v = $('#vstage-video');
    v.addEventListener('timeupdate', onVideoTime);
    v.addEventListener('progress', paintBuffered);
    v.addEventListener('play', () => { $('#vstage-toggle').innerHTML = I.pause; setLoading(false); });
    v.addEventListener('playing', () => setLoading(false));
    v.addEventListener('waiting', () => setLoading(true, '缓冲中…'));
    v.addEventListener('pause', () => { $('#vstage-toggle').innerHTML = I.play; });
    v.addEventListener('error', onVideoError);
    v.addEventListener('ended', onVideoEnded);
    v.addEventListener('loadedmetadata', () => { setLoading(false); paintBuffered(); });

    $('#vstage-toggle').addEventListener('click', () => { if (v.paused) v.play().catch(() => {}); else v.pause(); });
    $('#vstage-close').addEventListener('click', closeVideo);
    $('#vstage-bar').addEventListener('input', e => {
      seekVideo((Number(e.target.value) / 1000) * (V.duration || 0));
    });
    $('#vstage-vol').addEventListener('input', e => setVolume(Number(e.target.value) / 100));
    $('#vstage-mute').addEventListener('click', toggleMute);
    $('#vstage-fs').addEventListener('click', toggleFullscreen);
    $('#vstage-pip').addEventListener('click', togglePip);
    $('#vstage-skipintro').addEventListener('click', () => seekVideo(V.openSkip.endSec));
    $('#vstage-prev').addEventListener('click', () => playEpisode(V.epIndex - 1));
    $('#vstage-next').addEventListener('click', () => playEpisode(V.epIndex + 1));

    bindMenu('#vstage-qsel', '#vstage-qmenu', '#vstage-qbtn');
    bindMenu('#vstage-ssel', '#vstage-smenu', '#vstage-sbtn');
    bindMenu('#vstage-asel', '#vstage-amenu', '#vstage-abtn');
    bindMenu('#vstage-rsel', '#vstage-rmenu', '#vstage-rbtn');

    document.addEventListener('click', e => {
      $$('.qsel__menu').forEach(m => {
        if (!m.hidden && !e.target.closest('.qsel')) m.hidden = true;
      });
    });
    document.addEventListener('keydown', onVideoKey);
    document.addEventListener('fullscreenchange', () => {
      $('#vstage-fs').innerHTML = document.fullscreenElement ? I.close : I.fs;
    });
    applyCueStyle();
  }

  /** 菜单外层点击切换、点选项后收起。每个菜单一个闭包，避免互相干扰 */
  function bindMenu(wrapSel, menuSel, btnSel) {
    const btn = $(btnSel);
    if (!btn) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const menu = $(menuSel);
      const willOpen = menu.hidden;
      $$('.qsel__menu').forEach(m => { m.hidden = true; });
      menu.hidden = !willOpen;
    });
  }

  /* ---------------- 加载态 / 缓冲条 ---------------- */
  function setLoading(on, text) {
    const box = $('#vstage-load');
    if (!box) return;
    box.hidden = !on;
    if (on) {
      const t = $('#vstage-loadtxt');
      if (t) t.textContent = text || '起播中…';
    }
  }

  function paintBuffered() {
    const v = $('#vstage-video');
    const bar = $('#vstage-buf');
    if (!v || !bar) return;
    let end = 0;
    try {
      if (v.buffered && v.buffered.length) end = v.buffered.end(v.buffered.length - 1);
    } catch (_) {}
    // 直播式流的 duration 可能是 Infinity，只能按元数据时长算比例
    const pct = V.duration > 0 ? Math.min(100, (end / V.duration) * 100) : 0;
    bar.style.width = `${pct.toFixed(1)}%`;
  }

  /* ---------------- 进度 / 续播 / 片头 ---------------- */
  function currentPos() {
    const v = $('#vstage-video');
    if (!v) return V.baseSeek;
    return V.baseSeek + (Number(v.currentTime) || 0);
  }

  function onVideoTime() {
    const v = $('#vstage-video');
    if (!v) return;
    const pos = currentPos();
    const cur = $('#vstage-cur');
    const dur = $('#vstage-dur');
    const bar = $('#vstage-bar');
    if (cur) cur.textContent = fmtDur(pos);
    if (dur) dur.textContent = V.duration ? fmtDur(V.duration) : '--:--';
    if (bar && V.duration > 0 && document.activeElement !== bar) {
      bar.value = String(Math.floor((pos / V.duration) * 1000));
    }
    // 断点续播：整数秒时落一次，关掉页面也不丢
    if (V.filePath && Math.floor(pos) % 10 === 0) saveVideoProgress(pos);
    paintSkipIntro(pos);
  }

  function paintSkipIntro(pos) {
    const btn = $('#vstage-skipintro');
    if (!btn) return;
    const { startSec, endSec } = V.openSkip;
    const inIntro = startSec > 0 && endSec > startSec + 1 && pos >= startSec - 0.5 && pos < endSec - 1;
    btn.hidden = !inIntro;
    if (!inIntro) return;
    if (V.autoSkipIntro && !V._introSkipped) {
      V._introSkipped = true;
      seekVideo(endSec);
      toast('已自动跳过片头', 'ok');
    }
  }

  let _progTimer = 0;
  function saveVideoProgress(pos) {
    clearTimeout(_progTimer);
    _progTimer = setTimeout(() => {
      api.post('/api/videoPlayer/preference', {
        filePath: V.filePath,
        playback_position: Math.floor(pos),
        quality: V.quality,
        subtitle_ref: V.subtitleRef,
        audio_index: V.audioIndex,
        speed: V.speed,
      }).catch(() => {});
    }, 1500);
  }

  /**
   * 源编码浏览器解不了时，从原画切到转码档位。
   *
   * 上游播放器的做法是等 videojs 报错再转码，并且**先**弹「已为您自动转码播放」
   * 再发请求——转码服务没起来、ffmpeg 缺失、m3u8 生成失败时，这句话就是假的，
   * 用户看到提示接着看到错误，比没有提示更难受。这里反过来：先确认放不出来，
   * 切过去并等流真正开始（playing 事件）再告知，切失败了由 onVideoError 说清原因。
   */
  /**
   * 浏览器自己说放不放得了这个编码。
   *
   * 服务端的 directPlay 只是「主流浏览器交集」的参考，不能当结论用——HEVC 就是
   * 活例子：Safari 能放，Windows 上带 HEVC 硬解的 Edge/Chrome 也能放，服务端
   * 一张硬编码的表必然误判，而误判的代价是让原本能硬解直看的 4K 原片去走实时
   * 重编码（4K 的 libx264 服务器跟不上，反而看不了）。
   * 所以最终以浏览器为准：MediaSource.isTypeSupported 和 canPlayType 有一个说
   * 能播就当能播，两个都说不能才认定放不出来。
   */
  function browserCanPlay(mime) {
    if (!mime) return false;
    try {
      const MS = window.MediaSource;
      if (MS && typeof MS.isTypeSupported === 'function' && MS.isTypeSupported(mime)) return true;
    } catch (_) {}
    try {
      const v = document.createElement('video');
      if (v && typeof v.canPlayType === 'function' && v.canPlayType(mime)) return true;
    } catch (_) {}
    return false;
  }

  /** 浏览器放得了原片吗？服务端给出候选 mime，逐个问浏览器 */
  function canDirectPlayInThisBrowser() {
    const dp = V.directPlay;
    if (!dp) return true;                       // 没信息就当能放，别误杀原画
    const list = Array.isArray(dp.mimeCandidates) ? dp.mimeCandidates : [];
    if (!list.length) return true;              // 老服务端没这个字段，保持原行为
    return list.some(browserCanPlay);
  }

  function autoSwitchOffDirectPlay() {
    if (V._autoSwitched) return;
    if (!V.directPlay || V.directPlay.ok) return;
    // 浏览器实测放得了就保持原画。这一步是「昨天还能直接看 4K 原片」的保证：
    // 服务端说不在交集里，但浏览器说自己能硬解，那就该直连。
    if (canDirectPlayInThisBrowser()) {
      V.directPlay = Object.assign({}, V.directPlay, { ok: true, reason: '', note: '' });
      return;
    }
    if (V.quality === 'original') {
      V._autoSwitched = true;
      const tier = V.qualities.find(q => q.recommended && q.available)
        || V.qualities.find(q => q.key !== 'original' && q.available)
        || null;
      const key = tier ? tier.key : '720p';
      V.quality = key;
      $('#vstage-qlabel').textContent = (tier && tier.label) || key;
      reloadVideo();
      paintQualityMenu();
      saveVideoProgress(currentPos());
      toast(`${V.directPlay.note || '源编码浏览器不支持'}，已切换到 ${(tier && tier.label) || key} 转码播放`, 'warn');
      return;
    }
    // 已经在转码档位还是放不出来：不是编码问题，让 onVideoError 报
  }

  function onVideoError() {
    const box = $('#vstage-err');
    setLoading(false);
    if (!box) return;
    // 非原画起播失败时回落一次原画，别直接把用户扔在错误页上
    if (V.quality !== 'original' && !V._fellBack) {
      V._fellBack = true;
      setQuality('original', true);
      toast('该清晰度起播失败，已回落到原画', 'warn');
      return;
    }
    // 原画失败：先看是不是编码问题。是就自动转码一次，而不是只给一句
    // 「可尝试切换清晰度」让用户自己猜——转码正是唯一能放出来的路。
    if (V.quality === 'original' && !V._autoSwitched && V.directPlay && !V.directPlay.ok) {
      V._autoSwitched = true;
      autoSwitchOffDirectPlay();
      return;
    }
    box.hidden = false;
    box.textContent = V.directPlay && !V.directPlay.ok
      ? `播放失败：${V.directPlay.note || '源编码浏览器不支持'}，已尝试自动转码但仍未起来。可检查转码服务（libs/ffmpeg）后重试，或下载后用本地播放器观看。`
      : '播放失败：浏览器无法解码这个源。可尝试切换清晰度（会重编码），或下载后用本地播放器观看。';
  }

  function onVideoEnded() {
    clearTimeout(V._nextTimer);
    const box = $('#vstage-next');
    if (!box) return;
    const nextIdx = V.epIndex + 1;
    if (!V.autoplayNext || nextIdx >= V.episodes.length) { box.hidden = true; return; }
    let left = 5;
    const ep = V.episodes[nextIdx];
    box.hidden = false;
    const paint = () => {
      box.innerHTML = `<span>${left} 秒后播放下一集：${escapeHtml(ep && ep.name ? ep.name : '')}</span>
        <button class="btn btn--sm btn--primary" id="vstage-nextnow">立即播放</button>
        <button class="btn btn--sm btn--ghost" id="vstage-nextcancel">取消</button>`;
      $('#vstage-nextnow').addEventListener('click', () => { clearTimeout(V._nextTimer); box.hidden = true; playEpisode(nextIdx); });
      $('#vstage-nextcancel').addEventListener('click', () => { clearTimeout(V._nextTimer); box.hidden = true; });
    };
    paint();
    V._nextTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearTimeout(V._nextTimer);
        box.hidden = true;
        playEpisode(nextIdx);
      } else {
        paint();
      }
    }, 1000);
  }

  function videoStreamUrl(seek) {
    const params = { filePath: V.filePath, mode: 'copy' };
    if (seek > 0) params.seek = String(Math.floor(seek));
    // 原画 = 纯 remux 不重编码；其它档位交给服务端按档位缩放+控码率
    if (V.quality && V.quality !== 'original') {
      params.quality = V.quality;
      delete params.mode;
    }
    // 音轨只能靠服务端重封装选出，所以切音轨必须重连流
    if (V.audioIndex > 0) params.audioMapIndex = String(V.audioIndex);
    return mediaUrl('/api/videoPlayer/stream-mp4', params);
  }

  /** 换源但保留当前位置：清晰度 / 音轨切换都走这儿 */
  function reloadVideo() {
    const v = $('#vstage-video');
    const pos = currentPos();
    V.baseSeek = Math.max(0, Math.floor(pos));
    V._fellBack = false;
    $('#vstage-err').hidden = true;
    setLoading(true, V.quality === 'original' ? '起播中…' : '转码起播中…');
    v.src = videoStreamUrl(V.baseSeek);
    v.play().catch(() => {});
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
    V.directPlay = null;
    V._autoSwitched = false;
    V._introSkipped = false;
    V.subtitleRef = '';
    V.subOffset = 0;
    V.audioIndex = 0;
    V.speed = '1';
    clearTimeout(V._nextTimer);
    const nextBox = $('#vstage-next');
    if (nextBox) nextBox.hidden = true;

    ensureVideoStage();
    $('#vstage').hidden = false;
    document.body.classList.add('has-vstage');
    $('#vstage-title').textContent = item.nfo_name || item.filename || '—';
    $('#vstage-err').hidden = true;
    $('#vstage-qlabel').textContent = '原画';
    $('#vstage-slabel').textContent = '字幕';
    $('#vstage-alabel').textContent = '音轨';
    $('#vstage-rlabel').textContent = '倍速';
    removeSubtitleTracks();
    paintQualityMenu();
    paintSubtitleMenu();
    paintAudioMenu();
    paintSpeedMenu();

    const v = $('#vstage-video');
    setLoading(true, '起播中…');
    v.src = videoStreamUrl(V.baseSeek);
    v.play().catch(() => {});
    setVolume(loadPrefs().videoVolume == null ? 1 : Number(loadPrefs().videoVolume), true);
    v.playbackRate = 1;

    // 档位表 + 用户上次的选择（一次请求恢复全部偏好）
    try {
      const q = await api.get(`/api/videoPlayer/qualities?filePath=${encodeURIComponent(filePath)}`);
      V.qualities = (q.data && q.data.qualities) || [];
      const pref = (q.data && q.data.preference) || {};
      if (pref.quality && pref.quality !== 'original') {
        const tier = V.qualities.find(x => x.key === pref.quality);
        if (tier && tier.available) {
          V.quality = pref.quality;
          $('#vstage-qlabel').textContent = tier.label;
        }
      }
      if (pref.audio_index != null && Number(pref.audio_index) > 0) V.audioIndex = Number(pref.audio_index);
      if (pref.speed) V.speed = String(pref.speed);
      if (pref.subtitle_ref) V.subtitleRef = String(pref.subtitle_ref);
      if (V.audioIndex > 0 || (V.quality !== 'original') || (V.speed && V.speed !== '1')) {
        // 偏好与原画直连不一致，按偏好重连一次
        reloadVideo();
      }
      if (V.speed && V.speed !== '1') {
        v.playbackRate = Number(V.speed);
        $('#vstage-rlabel').textContent = `${V.speed}x`;
      }
      paintQualityMenu();
      paintAudioMenu();
      paintSpeedMenu();
    } catch (_) {}

    // 音轨 / 字幕 / 片头片尾：单独一个请求，失败不影响播放
    try {
      const t = await api.get(`/api/videoPlayer/tracks?filePath=${encodeURIComponent(filePath)}`);
      const d = t.data || {};
      V.audioTracks = Array.isArray(d.audio) ? d.audio : [];
      V.subtitleTracks = Array.isArray(d.subtitles) ? d.subtitles : [];
      V.openSkip = d.openSkip && typeof d.openSkip === 'object' ? d.openSkip : { startSec: 0, endSec: 0 };
      V.directPlay = d.directPlay && typeof d.directPlay === 'object' ? d.directPlay : null;
      if (V.audioIndex > 0 && !V.audioTracks.some(a => a.index === V.audioIndex)) V.audioIndex = 0;
      buildSubtitleTracks();
      paintAudioMenu();
      paintSubtitleMenu();
      paintSkipIntro(currentPos());
      // 源编码浏览器解不了时，原画档位放出来只有一个黑屏 + 错误框。
      // 服务端已经按编码判过（webPlayableUtil），这里直接切到转码档位。
      autoSwitchOffDirectPlay();
    } catch (_) {}

    // 剧集连播：只有多集才有意义
    V.episodes = [];
    V.epIndex = -1;
    $('#vstage-prev').hidden = true;
    $('#vstage-next').hidden = true;
    try {
      const info = await api.get(`/api/video/tvPlayInfo?index_id=${encodeURIComponent(item.id)}`);
      const pl = (info.data && info.data.playlist) || [];
      if (pl.length > 1) {
        V.episodes = pl;
        V.epIndex = Math.max(0, Number(info.data.initialIndex) || 0);
        $('#vstage-prev').hidden = V.epIndex <= 0;
        $('#vstage-next').hidden = V.epIndex >= pl.length - 1;
      }
    } catch (_) {}
  }

  function playEpisode(i) {
    if (i < 0 || i >= V.episodes.length) return;
    const ep = V.episodes[i];
    V.epIndex = i;
    const name = ep && ep.name ? ep.name : `第 ${i + 1} 集`;
    $('#vstage-title').textContent = name;
    $('#vstage-prev').hidden = i <= 0;
    $('#vstage-next').hidden = i >= V.episodes.length - 1;
    V.baseSeek = 0;
    V._introSkipped = false;
    V._fellBack = false;
    V._autoSwitched = false;
    $('#vstage-err').hidden = true;
    const v = $('#vstage-video');
    setLoading(true, '起播中…');
    v.src = videoStreamUrl(0);
    v.play().catch(() => {});
  }

  /* ---------------- 清晰度 ---------------- */
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
    V.quality = key;
    $('#vstage-qlabel').textContent = (tier && tier.label) || '原画';
    reloadVideo();
    paintQualityMenu();
    saveVideoProgress(currentPos());
    if (!silent) toast(`已切换到 ${(tier && tier.label) || key}${key === 'original' ? '' : '（转码需要几秒起播）'}`, 'ok');
  }

  /* ---------------- 字幕 ---------------- */
  function removeSubtitleTracks() {
    const v = $('#vstage-video');
    if (!v) return;
    $$('track', v).forEach(t => t.remove());
    try {
      const list = v.textTracks;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i] && list[i].kind === 'subtitles') list[i].mode = 'disabled';
      }
    } catch (_) {}
  }

  /**
   * 把可选字幕挂成 <track>。
   * 走 WebVTT 而不是让服务端把字幕烧进画面：文本字幕转 VTT 是零成本导出，
   * 切换即时、不用重连流、原画路径也不被破坏；图像字幕（PGS/VOBSUB）转不出
   * 文本，服务端那条路本来就到不了，就在菜单里禁用并说明原因。
   */
  function buildSubtitleTracks() {
    const v = $('#vstage-video');
    if (!v) return;
    removeSubtitleTracks();
    const usable = V.subtitleTracks.filter(t => t && t.render === 'vtt' && !t.disabled);
    for (const t of usable) {
      const el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = t.label;
      el.srclang = (t.language || 'zh').toLowerCase();
      el.src = subtitleVttUrl(t);
      el.dataset.ref = t.ref;
      el.addEventListener('load', () => {
        const tt = findTextTrack(t.ref);
        if (tt) applySubtitleOffset(tt, V.subOffset);
      });
      el.addEventListener('error', () => {
        toast(`字幕「${t.label}」加载失败`, 'warn');
      });
      v.appendChild(el);
    }
    applySubtitleRef(V.subtitleRef, true);
  }

  function findTextTrack(ref) {
    const v = $('#vstage-video');
    if (!v) return null;
    try {
      const list = v.textTracks;
      for (let i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].ref === ref) return list[i];
        if (list[i] && list[i].label && list[i].label === ref) return list[i];
      }
    } catch (_) {}
    return null;
  }

  function paintSubtitleMenu() {
    const menu = $('#vstage-smenu');
    if (!menu) return;
    const rows = [{ ref: '', label: '关闭字幕', disabled: false, reason: '' }].concat(V.subtitleTracks);
    menu.innerHTML = rows.map(t => `
      <button class="qsel__item ${String(t.ref || '') === V.subtitleRef ? 'is-active' : ''}" data-s="${escapeHtml(String(t.ref || ''))}" ${t.disabled ? 'disabled' : ''}>
        <span class="qsel__key">${escapeHtml(t.label || '字幕')}</span>
        <span class="qsel__desc">${escapeHtml(t.reason || '')}</span>
      </button>`).join('');
    // 底部固定动作：样式 / 上传 / 在线搜索
    menu.innerHTML += `<div class="qsel__acts">
        <button class="btn btn--ghost btn--sm" id="vstage-sub-style">样式</button>
        <button class="btn btn--ghost btn--sm" id="vstage-sub-upload">上传</button>
        <button class="btn btn--ghost btn--sm" id="vstage-sub-search">搜索</button>
      </div>`;
    $$('[data-s]', menu).forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = true;
      applySubtitleRef(b.dataset.s, false);
    }));
    const sty = $('#vstage-sub-style');
    if (sty) sty.addEventListener('click', e => { e.stopPropagation(); menu.hidden = true; openSubtitleStylePanel(); });
    const up = $('#vstage-sub-upload');
    if (up) up.addEventListener('click', e => { e.stopPropagation(); menu.hidden = true; uploadSubtitleFlow(); });
    const se = $('#vstage-sub-search');
    if (se) se.addEventListener('click', e => { e.stopPropagation(); menu.hidden = true; searchSubtitleFlow(); });
  }

  function applySubtitleRef(ref, silent) {
    const v = $('#vstage-video');
    V.subtitleRef = ref || '';
    const hit = V.subtitleTracks.find(t => String(t.ref || '') === V.subtitleRef);
    $('#vstage-slabel').textContent = hit ? shortSubLabel(hit.label) : '字幕';
    if (v) {
      try {
        const list = v.textTracks;
        for (let i = 0; i < list.length; i += 1) {
          const tt = list[i];
          if (!tt) continue;
          tt.mode = 'disabled';
        }
        if (V.subtitleRef) {
          const tt = findTextTrack(V.subtitleRef);
          if (tt) {
            tt.mode = 'showing';
            applySubtitleOffset(tt, V.subOffset);
          } else {
            // <track> 可能还没被浏览器收进 textTracks，用元素上的 mode 再推一次
            const el = $$('track', v).find(t => t.dataset.ref === V.subtitleRef);
            if (el) el.mode = 'showing';
          }
        }
      } catch (_) {}
    }
    paintSubtitleMenu();
    saveVideoProgress(currentPos());
    if (!silent) toast(hit ? `字幕：${hit.label}` : '已关闭字幕');
  }

  function shortSubLabel(label) {
    const s = String(label || '');
    // 顶栏空间有限，「国语 · SRT（同目录）」截成「国语 · SRT」
    return s.split('（')[0].slice(0, 10);
  }

  /* ---------------- 字幕外观 ----------------
     原生 <track> 只暴露 ::cue 一个样式口子，能改的是字号/颜色/背景/描边；
     垂直位置要动 -webkit-media-text-track-container（Chromium 有效，其余内核忽略）。
     这些值写进 CSS 变量，改一处即可全局生效，用户偏好存 localStorage。 */
  const CUE_PRESETS = {
    fg: { white: '#ffffff', yellow: '#ffe066', cyan: '#8ee7f5', green: '#b6f09b' },
    bg: { dim: 'rgba(0,0,0,.72)', solid: 'rgba(0,0,0,.94)', none: 'transparent' },
    shadow: { none: 'none', soft: '0 1px 2px rgba(0,0,0,.9)', strong: '0 0 3px #000, 0 2px 4px #000' },
  };

  function cueStyle() {
    const s = loadPrefs().cue || {};
    return {
      scale: Number(s.scale) || 1,
      bottom: Number(s.bottom) || 7,
      fg: CUE_PRESETS.fg[s.fg] ? s.fg : 'white',
      bg: CUE_PRESETS.bg[s.bg] ? s.bg : 'dim',
      shadow: CUE_PRESETS.shadow[s.shadow] ? s.shadow : 'soft',
    };
  }

  function applyCueStyle() {
    const v = $('#vstage-video');
    if (!v) return;
    const s = cueStyle();
    v.style.setProperty('--cue-scale', String(s.scale));
    v.style.setProperty('--cue-bottom', `${s.bottom}%`);
    v.style.setProperty('--cue-fg', CUE_PRESETS.fg[s.fg]);
    v.style.setProperty('--cue-bg', CUE_PRESETS.bg[s.bg]);
    v.style.setProperty('--cue-shadow', CUE_PRESETS.shadow[s.shadow]);
  }

  function openSubtitleStylePanel() {
    const s = cueStyle();
    const opt = (map, cur) => Object.keys(map).map(k =>
      `<option value="${k}" ${k === cur ? 'selected' : ''}>${k === 'white' ? '白' : k === 'yellow' ? '黄' : k === 'cyan' ? '青' : k === 'green' ? '绿' : k === 'dim' ? '半透明' : k === 'solid' ? '不透明' : k === 'none' ? '无' : k === 'soft' ? '轻' : '重'}</option>`).join('');
    openModal({
      title: '字幕样式',
      body: `<div class="cueform">
        <label class="cueform__row"><span>字号</span>
          <input id="cue-scale" type="range" min="0.7" max="2" step="0.05" value="${s.scale}">
          <b>${Math.round(s.scale * 100)}%</b></label>
        <label class="cueform__row"><span>位置</span>
          <input id="cue-bottom" type="range" min="0" max="45" step="1" value="${s.bottom}">
          <b>距底 ${s.bottom}%</b></label>
        <label class="cueform__row"><span>颜色</span>
          <select class="input input--sel" id="cue-fg">${opt(CUE_PRESETS.fg, s.fg)}</select></label>
        <label class="cueform__row"><span>背景</span>
          <select class="input input--sel" id="cue-bg">${opt(CUE_PRESETS.bg, s.bg)}</select></label>
        <label class="cueform__row"><span>描边</span>
          <select class="input input--sel" id="cue-shadow">${opt(CUE_PRESETS.shadow, s.shadow)}</select></label>
        <label class="cueform__row"><span>延时</span>
          <input id="cue-offset" type="range" min="-10" max="10" step="0.5" value="${V.subOffset}">
          <b>${V.subOffset > 0 ? '+' : ''}${V.subOffset.toFixed(1)}s</b></label>
        <div class="u-muted" style="font-size:11.5px">位置只在 Chromium 内核浏览器生效，其余内核会保持默认底部。</div>
      </div>`,
      okText: '完成',
      onOk: () => true,
      after: () => {
        const p = loadPrefs();
        p.cue = p.cue || {};
        const sync = () => {
          p.cue.scale = Number($('#cue-scale').value);
          p.cue.bottom = Number($('#cue-bottom').value);
          p.cue.fg = $('#cue-fg').value;
          p.cue.bg = $('#cue-bg').value;
          p.cue.shadow = $('#cue-shadow').value;
          savePrefs(p);
          applyCueStyle();
        };
        $('#cue-scale').addEventListener('input', e => { e.target.nextElementSibling.textContent = `${Math.round(Number(e.target.value) * 100)}%`; sync(); });
        $('#cue-bottom').addEventListener('input', e => { e.target.nextElementSibling.textContent = `距底 ${e.target.value}%`; sync(); });
        ['#cue-fg', '#cue-bg', '#cue-shadow'].forEach(sel => $(sel).addEventListener('change', sync));
        $('#cue-offset').addEventListener('input', e => {
          V.subOffset = Number(e.target.value);
          e.target.nextElementSibling.textContent = `${V.subOffset > 0 ? '+' : ''}${V.subOffset.toFixed(1)}s`;
          const tt = V.subtitleRef ? findTextTrack(V.subtitleRef) : null;
          if (tt) applySubtitleOffset(tt, V.subOffset);
        });
        applyCueStyle();
      },
    });
  }

  /** 字幕延时：直接改 cue 的起止时间，不动播放位置 */
  function applySubtitleOffset(track, offsetSec) {
    if (!track || !track.cues) return;
    const cues = track.cues;
    for (let i = 0; i < cues.length; i += 1) {
      const c = cues[i];
      if (!c) continue;
      if (c.__origStart === undefined) { c.__origStart = c.startTime; c.__origEnd = c.endTime; }
      c.startTime = Math.max(0, c.__origStart + offsetSec);
      c.endTime = Math.max(c.startTime + 0.01, c.__origEnd + offsetSec);
    }
  }

  function nudgeSubtitleOffset(delta) {
    V.subOffset = Math.round((V.subOffset + delta) * 100) / 100;
    const tt = V.subtitleRef ? findTextTrack(V.subtitleRef) : null;
    if (tt) applySubtitleOffset(tt, V.subOffset);
    toast(`字幕延时 ${V.subOffset > 0 ? '+' : ''}${V.subOffset.toFixed(2)} 秒`);
  }

  /* ---------------- 上传 / 搜索字幕 ---------------- */
  function uploadSubtitleFlow() {
    openModal({
      title: '上传字幕',
      body: `<div class="field"><label class="field__label">字幕文件（.srt / .ass / .ssa / .vtt / .sub）</label>
        <input class="input" id="sub-file" type="file" accept=".srt,.ass,.ssa,.vtt,.sub"></div>`,
      okText: '上传',
      onOk: async () => {
        const input = $('#sub-file');
        const file = input && input.files && input.files[0];
        if (!file) { toast('先选一个字幕文件', 'warn'); return false; }
        const fd = new FormData();
        fd.append('filePath', V.filePath);
        fd.append('file', file);
        try {
          // 只能用裸 fetch：api.post 会 JSON.stringify 请求体，会把二进制字幕弄坏
          const resp = await fetch('/api/videoPlayer/uploadSubtitle', {
            method: 'POST',
            headers: { Authorization: `Bearer ${api.token}` },
            body: fd,
          });
          const text = await resp.text();
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch (_) {}
          if (!resp.ok || (json && json.success === false)) {
            throw new Error((json && json.message) || `上传失败（${resp.status}）`);
          }
          toast('字幕已上传，正在刷新列表', 'ok');
          await refreshTracks();
          return true;
        } catch (err) {
          toast(err.message || '上传失败', 'warn');
          return false;
        }
      },
    });
  }

  async function refreshTracks() {
    try {
      const t = await api.get(`/api/videoPlayer/tracks?filePath=${encodeURIComponent(V.filePath)}`);
      const d = t.data || {};
      V.subtitleTracks = Array.isArray(d.subtitles) ? d.subtitles : [];
      buildSubtitleTracks();
      paintSubtitleMenu();
    } catch (_) {}
  }

  function searchSubtitleFlow() {
    const guess = (V.filePath || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    openModal({
      title: '搜索字幕',
      body: `<div class="field"><label class="field__label">关键字</label>
        <input class="input" id="sub-kw" type="text" value="${escapeHtml(guess)}"></div>
        <div id="sub-res" class="picklist"></div>`,
      okText: '',
      after: () => {
        const kw = $('#sub-kw');
        const run = async () => {
          const box = $('#sub-res');
          box.innerHTML = '<div class="u-muted">搜索中…</div>';
          try {
            const data = await api.post('/api/videoPlayer/searchSubtitle', {
              filePath: V.filePath,
              searchType: 'keyword',
              keyword: kw.value.trim(),
            });
            const items = (data.data && data.data.items) || [];
            if (!items.length) { box.innerHTML = '<div class="u-muted">没有搜到</div>'; return; }
            box.innerHTML = items.map((s, i) => `
              <button class="picklist__item" data-sub="${i}">
                <span>${escapeHtml(s.sname || s.name || '字幕')}</span>
                <em>${escapeHtml(s.language || '')}</em></button>`).join('');
            $$('[data-sub]', box).forEach(b => b.addEventListener('click', async () => {
              const s = items[Number(b.dataset.sub)];
              try {
                await api.post('/api/videoPlayer/downloadSearchedSubtitle', {
                  filePath: V.filePath,
                  surl: s.surl,
                  sname: s.sname || s.name,
                  language: s.language,
                });
                toast('字幕已下载', 'ok');
                await refreshTracks();
                closeModal();
              } catch (err) {
                toast(err.message || '下载失败', 'warn');
              }
            }));
          } catch (err) {
            box.innerHTML = `<div class="u-muted">${escapeHtml(err.message || '搜索失败')}</div>`;
          }
        };
        kw.addEventListener('change', run);
        run();
      },
    });
  }

  /* ---------------- 音轨 ---------------- */
  function paintAudioMenu() {
    const menu = $('#vstage-amenu');
    if (!menu) return;
    if (!V.audioTracks.length) {
      menu.innerHTML = '<div class="qsel__item is-static"><span class="qsel__desc">没有取到音轨信息</span></div>';
      return;
    }
    menu.innerHTML = V.audioTracks.map(a => `
      <button class="qsel__item ${a.index === V.audioIndex ? 'is-active' : ''}" data-a="${a.index}">
        <span class="qsel__key">${escapeHtml(a.label || `音轨 ${a.index + 1}`)}</span>
        <span class="qsel__desc">${a.index === 0 ? '默认' : ''}</span>
      </button>`).join('');
    $$('[data-a]', menu).forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = true;
      setAudio(Number(b.dataset.a));
    }));
  }

  function setAudio(index) {
    if (index === V.audioIndex) return;
    const hit = V.audioTracks.find(a => a.index === index);
    V.audioIndex = index;
    $('#vstage-alabel').textContent = hit ? shortSubLabel(hit.label) : '音轨';
    // 音轨只能由服务端重封装选出，必须重连流；位置由 reloadVideo 保留
    reloadVideo();
    paintAudioMenu();
    saveVideoProgress(currentPos());
    toast(`音轨：${hit ? hit.label : index}`);
  }

  /* ---------------- 倍速 / 音量 ---------------- */
  const SPEEDS = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2', '3'];

  function paintSpeedMenu() {
    const menu = $('#vstage-rmenu');
    if (!menu) return;
    menu.innerHTML = SPEEDS.map(s => `
      <button class="qsel__item ${s === V.speed ? 'is-active' : ''}" data-r="${s}">
        <span class="qsel__key">${s}x${s === '1' ? ' <em>正常</em>' : ''}</span>
        <span class="qsel__desc"></span>
      </button>`).join('');
    // 倍速菜单同时也是「播放行为」的入口：这两个开关都影响播放流程，
    // 单独再开一个设置面板只会让顶栏更挤
    menu.innerHTML += `<div class="qsel__acts qsel__acts--col">
        <label class="vswitch"><input type="checkbox" id="v-auto-skip" ${V.autoSkipIntro ? 'checked' : ''}><span>自动跳过片头</span></label>
        <label class="vswitch"><input type="checkbox" id="v-auto-next" ${V.autoplayNext ? 'checked' : ''}><span>自动连播下一集</span></label>
      </div>`;
    $$('[data-r]', menu).forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = true;
      setSpeed(b.dataset.r);
    }));
    const skip = $('#v-auto-skip');
    if (skip) skip.addEventListener('change', () => {
      V.autoSkipIntro = !!skip.checked;
      const p = loadPrefs(); p.autoSkipIntro = V.autoSkipIntro; savePrefs(p);
      if (V.autoSkipIntro) paintSkipIntro(currentPos());
    });
    const next = $('#v-auto-next');
    if (next) next.addEventListener('change', () => {
      V.autoplayNext = !!next.checked;
      const p = loadPrefs(); p.autoplayNext = V.autoplayNext; savePrefs(p);
    });
  }

  function setSpeed(s) {
    V.speed = s;
    const v = $('#vstage-video');
    if (v) v.playbackRate = Number(s);
    $('#vstage-rlabel').textContent = s === '1' ? '倍速' : `${s}x`;
    paintSpeedMenu();
    const p = loadPrefs(); p.videoSpeed = s; savePrefs(p);
  }

  function setVolume(val, silent) {
    const v = $('#vstage-video');
    if (!v) return;
    const n = Math.max(0, Math.min(1, Number(val) || 0));
    v.volume = n;
    v.muted = n === 0;
    const bar = $('#vstage-vol');
    if (bar) bar.value = String(Math.round(n * 100));
    $('#vstage-mute').innerHTML = n === 0 ? I.mute : I.audio;
    if (!silent) { const p = loadPrefs(); p.videoVolume = n; savePrefs(p); }
  }

  function toggleMute() {
    const v = $('#vstage-video');
    if (!v) return;
    if (v.muted || v.volume === 0) setVolume(loadPrefs().videoVolume || 1);
    else setVolume(0);
  }

  function toggleFullscreen() {
    const st = $('#vstage');
    if (!st) return;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } else if (st.requestFullscreen) {
      st.requestFullscreen().catch(() => toast('浏览器拒绝了全屏请求', 'warn'));
    }
  }

  function togglePip() {
    const v = $('#vstage-video');
    if (!v) return;
    if (document.pictureInPictureElement) {
      if (document.exitPictureInPicture) document.exitPictureInPicture().catch(() => {});
    } else if (v.requestPictureInPicture) {
      v.requestPictureInPicture().catch(() => toast('浏览器拒绝了画中画请求', 'warn'));
    } else {
      toast('当前浏览器不支持画中画', 'warn');
    }
  }

  /* ---------------- 快捷键 ---------------- */
  function onVideoKey(e) {
    if ($('#vstage').hidden) return;
    const tag = e.target && e.target.tagName ? String(e.target.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const v = $('#vstage-video');
    const k = e.key;
    const seekBy = sec => { seekVideo(Math.max(0, Math.min(V.duration || 0, currentPos() + sec))); };
    switch (k) {
      case ' ': case 'k': e.preventDefault(); $('#vstage-toggle').click(); return;
      case 'ArrowLeft': e.preventDefault(); seekBy(-10); return;
      case 'ArrowRight': e.preventDefault(); seekBy(10); return;
      case 'j': case 'J': seekBy(-30); return;
      case 'l': case 'L': seekBy(30); return;
      case 'ArrowUp': e.preventDefault(); setVolume((Number(v.volume) || 0) + 0.05); return;
      case 'ArrowDown': e.preventDefault(); setVolume((Number(v.volume) || 0) - 0.05); return;
      case 'm': case 'M': toggleMute(); return;
      case 'f': case 'F': toggleFullscreen(); return;
      case 'p': case 'P': togglePip(); return;
      case 'c': case 'C': $('#vstage-sbtn').click(); return;
      case 'a': case 'A': $('#vstage-abtn').click(); return;
      case 's': case 'S': $('#vstage-rbtn').click(); return;
      case 'n': case 'N': playEpisode(V.epIndex + 1); return;
      case ',': nudgeSubtitleOffset(-0.5); return;
      case '.': nudgeSubtitleOffset(0.5); return;
      case '<': stepSpeed(-1); return;
      case '>': stepSpeed(1); return;
      case 'Escape':
        // 全屏时先退全屏，再按一次才关播放器
        if (document.fullscreenElement) return;
        closeVideo();
        return;
      default: break;
    }
    if (/^[0-9]$/.test(k) && V.duration > 0) {
      e.preventDefault();
      seekVideo((Number(k) / 10) * V.duration);
    }
  }

  function stepSpeed(dir) {
    const i = SPEEDS.indexOf(V.speed);
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + dir))];
    setSpeed(next);
    toast(`倍速 ${next}x`);
  }

  function seekVideo(t) {
    const v = $('#vstage-video');
    V.baseSeek = Math.max(0, Math.floor(t));
    setLoading(true, V.quality === 'original' ? '起播中…' : '转码起播中…');
    v.src = videoStreamUrl(V.baseSeek);
    v.play().catch(() => {});
    saveVideoProgress(V.baseSeek);
  }

  function closeVideo() {
    const st = $('#vstage');
    if (!st) return;
    clearTimeout(V._nextTimer);
    const v = $('#vstage-video');
    const pos = currentPos();
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
    removeSubtitleTracks();
    st.hidden = true;
    document.body.classList.remove('has-vstage');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
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
  // 播放行为偏好：这两个开关是纯本地体验项，没必要落库
  V.autoSkipIntro = prefs.autoSkipIntro === true;
  V.autoplayNext = prefs.autoplayNext !== false;
  restoreQueue();
}

// console.js 已就绪就直接注册；否则等 bootPages() 兜底
window.NasCabPages.push(__register);
if (window.NasCab) {
  try { __register(window.NasCab); } catch (e) { console.error('媒体页面模块注册失败', e); }
}

})();
