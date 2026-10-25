/* ============================================================
   NasCabOS Web 控制台
   纯静态、无构建步骤。所有数据来自服务端既有 API。
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const LS_TOKEN = 'nascab.console.token';
  const LS_REFRESH = 'nascab.console.refresh';
  const LS_USER = 'nascab.console.user';
  const LS_DEVICE = 'nascab.console.device';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  /** UTF-8 安全的 base64（btoa 只能处理 Latin1） */
  function b64Encode(text) {
    const bytes = new TextEncoder().encode(String(text));
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function fmtBytes(bytes, digits) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const val = n / Math.pow(1024, i);
    const d = digits == null ? (i === 0 ? 0 : val >= 100 ? 0 : val >= 10 ? 1 : 2) : digits;
    return `${val.toFixed(d)} ${units[i]}`;
  }

  function fmtSpeed(bytesPerSec) {
    return `${fmtBytes(bytesPerSec, 1)}/s`;
  }

  function fmtUptime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d} 天 ${h} 小时`;
    if (h > 0) return `${h} 小时 ${m} 分`;
    if (m > 0) return `${m} 分钟`;
    return `${s} 秒`;
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function pct(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  }

  function barClass(p) {
    if (p >= 90) return 'is-danger';
    if (p >= 75) return 'is-warn';
    return '';
  }

  function toast(message, kind) {
    const root = $('#toast-root');
    const node = document.createElement('div');
    node.className = `toast${kind ? ` toast--${kind}` : ''}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity .25s ease';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 260);
    }, 2400);
  }

  /* ---------------- API 客户端 ---------------- */
  const api = {
    token: localStorage.getItem(LS_TOKEN) || '',
    refreshToken: localStorage.getItem(LS_REFRESH) || '',

    deviceFingerprint() {
      let fp = localStorage.getItem(LS_DEVICE);
      if (!fp) {
        const uuid = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fp = JSON.stringify({
          storage_id: uuid,
          device_name: 'Web 控制台',
          os_version: navigator.platform || 'web',
        });
        localStorage.setItem(LS_DEVICE, fp);
      }
      return fp;
    },

    async request(path, options = {}, _retry) {
      const headers = Object.assign({}, options.headers);
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

      let resp;
      try {
        resp = await fetch(path, {
          method: options.method || 'GET',
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          credentials: 'same-origin',
        });
      } catch (err) {
        throw new Error('无法连接服务器，请检查网络或服务状态');
      }

      // 响应体只能读一次，先取文本再按需解析
      const text = await resp.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = { success: false, message: text }; }

      if (resp.status === 401 && !_retry) {
        const code = data && data.code;
        if (this.refreshToken && (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN')) {
          const refreshed = await this.refresh();
          if (refreshed) return this.request(path, options, true);
        }
        // 刷新失败或没有刷新令牌：登录态已失效，回到登录页
        onSessionExpired();
      }

      if (!resp.ok) {
        const msg = (data && (data.message || data.error)) || `请求失败（${resp.status}）`;
        const err = new Error(msg);
        err.status = resp.status;
        err.payload = data;
        throw err;
      }
      return data;
    },

    get(path) { return this.request(path); },
    post(path, body) { return this.request(path, { method: 'POST', body }); },

    async refresh() {
      try {
        const resp = await fetch('/api/auth/refreshJwt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });
        const data = await resp.json().catch(() => null);
        const next = data && data.data && data.data.accessToken;
        if (resp.ok && next) {
          this.token = next;
          if (data.data.refreshToken) {
            this.refreshToken = data.data.refreshToken;
            localStorage.setItem(LS_REFRESH, this.refreshToken);
          }
          localStorage.setItem(LS_TOKEN, next);
          return true;
        }
      } catch (_) {}
      return false;
    },

    saveSession(payload) {
      this.token = payload.accessToken;
      this.refreshToken = payload.refreshToken || '';
      localStorage.setItem(LS_TOKEN, this.token);
      if (this.refreshToken) localStorage.setItem(LS_REFRESH, this.refreshToken);
      if (payload.user) localStorage.setItem(LS_USER, JSON.stringify(payload.user));
    },

    clearSession() {
      this.token = '';
      this.refreshToken = '';
      localStorage.removeItem(LS_TOKEN);
      localStorage.removeItem(LS_REFRESH);
      localStorage.removeItem(LS_USER);
    },
  };

  /** 把配置的产品名/版本应用到登录页、侧边栏与文档标题 */
  function applyBranding(title, version) {
    const name = title || 'NasCabOS';
    $('#auth-title').textContent = name;
    $('#brand-name').textContent = name;
    $('#auth-version').textContent = version ? `v${version}` : '';
    document.title = `${name} · 服务端控制台`;
  }

  /** 登录态失效：清会话并回到登录页 */
  let sessionExpiredHandled = false;
  function onSessionExpired() {
    if (sessionExpiredHandled) return;
    sessionExpiredHandled = true;
    setTimeout(() => { sessionExpiredHandled = false; }, 3000);
    api.clearSession();
    state.user = null;
    state.system = null;
    state.metrics = null;
    showAuth();
    checkInitState();
    toast('登录已过期，请重新登录');
  }

  /* ---------------- 菜单定义 ---------------- */
  const ICONS = {
    overview: '<svg viewBox="0 0 20 20"><path d="M3 10.5h5V17H3zM3 3.5h5v4H3zM12 3.5h5v7h-5zM12 13.5h5V17h-5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    storage: '<svg viewBox="0 0 20 20"><ellipse cx="10" cy="5.2" rx="6.5" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 5.2v9.6c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6V5.2M3.5 10c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    users: '<svg viewBox="0 0 20 20"><circle cx="8" cy="7" r="2.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 16c0-2.6 2.2-4.2 5-4.2s5 1.6 5 4.2M13.5 5.4a2.6 2.6 0 010 5M15 16c0-1.6-.6-2.8-1.6-3.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    network: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.8 10h14.4M10 2.8c2.4 2 3.6 4.5 3.6 7.2s-1.2 5.2-3.6 7.2c-2.4-2-3.6-4.5-3.6-7.2S7.6 4.8 10 2.8z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    security: '<svg viewBox="0 0 20 20"><path d="M10 2.6l6 2.2v5c0 4-2.6 6.4-6 7.6-3.4-1.2-6-3.6-6-7.6v-5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.4 10.2l1.9 1.9 3.4-3.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    apps: '<svg viewBox="0 0 20 20"><rect x="3" y="3" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    docker: '<svg viewBox="0 0 20 20"><path d="M3 9.5h14M6.5 6.5h2v2h-2zM9.5 6.5h2v2h-2zM12.5 6.5h2v2h-2zM6.5 3.5h2v2h-2zM9.5 3.5h2v2h-2z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.6 12.4c1.6 2.2 4.3 3.3 7.6 3.3 3.6 0 6.2-1.4 7.6-3.6H2.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    process: '<svg viewBox="0 0 20 20"><rect x="3" y="3.5" width="14" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 7h7M6.5 10h7M6.5 13h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    logs: '<svg viewBox="0 0 20 20"><path d="M4.5 3.5h11v13h-11z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    about: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 9v4.2M10 6.6v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };

  const NAV = [
    {
      group: '系统', items: [
        { id: 'overview', label: '概览', icon: ICONS.overview },
        { id: 'storage', label: '存储管理', icon: ICONS.storage },
        { id: 'users', label: '用户管理', icon: ICONS.users },
        { id: 'network', label: '网络服务', icon: ICONS.network },
        { id: 'security', label: '安全中心', icon: ICONS.security },
      ],
    },
    {
      group: '应用与服务', items: [
        { id: 'apps', label: '应用中心', icon: ICONS.apps },
        { id: 'processes', label: '进程管理', icon: ICONS.process },
      ],
    },
    {
      group: '维护', items: [
        { id: 'logs', label: '系统日志', icon: ICONS.logs },
        { id: 'about', label: '关于本机', icon: ICONS.about },
      ],
    },
  ];

  const PAGES = {
    overview: { title: '概览', desc: '设备运行状态一览' },
    storage: { title: '存储管理', desc: '磁盘挂载点与容量使用情况' },
    users: { title: '用户管理', desc: '系统账号、权限与登录记录' },
    network: { title: '网络服务', desc: '远程访问、内网穿透与端口' },
    security: { title: '安全中心', desc: '登录防护与 IP 黑名单' },
    apps: { title: '应用中心', desc: '已安装的服务与应用' },
    processes: { title: '进程管理', desc: '服务端各进程资源占用' },
    logs: { title: '系统日志', desc: '在线查看服务端日志尾部' },
    about: { title: '关于本机', desc: '版本与运行环境信息' },
  };

  /** 应用标识 → 中文名与说明（服务端只返回标识，这里做展示层映射） */
  const APP_META = {
    folder: { name: '文件管理', desc: '浏览、上传、下载与分享服务器文件' },
    photo: { name: '相册', desc: '照片时间线、地点与人物归类' },
    movie: { name: '影视', desc: '影片海报墙与在线播放' },
    book: { name: '图书', desc: '电子书书架与阅读器' },
    music: { name: '音乐', desc: '音乐库与播放列表' },
    note: { name: '笔记', desc: 'Markdown 笔记与备忘录' },
    encrypted: { name: '加密空间', desc: '独立密码保护的私密目录' },
    media_tool: { name: '媒体工具', desc: '转码、刮削与批量处理' },
    user: { name: '用户中心', desc: '账号信息与个人设置' },
    terminal: { name: '终端', desc: 'Web 命令行，需谨慎授权' },
    mounts: { name: '挂载管理', desc: '本地磁盘与远程存储挂载' },
    docker: { name: '容器', desc: 'Docker 容器与镜像管理' },
    backup: { name: '备份', desc: '文件备份与同步任务' },
    nascab_service: { name: '穿透服务', desc: 'NasCab 远程访问账号' },
    security: { name: '安全中心', desc: '登录防护与访问控制' },
    share: { name: '共享', desc: '对外的文件分享链接' },
    monitor: { name: '监控', desc: '硬件与进程运行状态' },
    task_center: { name: '任务中心', desc: '进行中的上传下载与转码任务' },
    transmission: { name: '下载器', desc: 'Transmission BT 下载' },
    setting: { name: '设置', desc: '系统参数与偏好' },
  };

  /* ---------------- 运行时状态 ---------------- */
  const state = {
    page: 'overview',
    user: null,
    system: null,
    metrics: null,
    history: { cpu: [], mem: [], net: [] },
    message: '',
    timers: { overview: null, logs: null },
    logFile: 'combined',
    logAuto: true,
    users: null,
    apps: null,
    processes: null,
    ddns: null,
    p2p: null,
    securityConfig: null,
    blacklist: null,
  };

  /* ---------------- 视图切换 ---------------- */
  function showAuth() {
    $('#app-view').hidden = true;
    $('#auth-view').hidden = false;
    stopPolling();
  }

  function showApp() {
    $('#auth-view').hidden = true;
    $('#app-view').hidden = false;
    renderNav();
    renderUserbox();
    route(state.page || 'overview');
  }

  function renderNav() {
    const nav = $('#nav');
    nav.innerHTML = NAV.map(section => `
      <div class="sidebar__group">${escapeHtml(section.group)}</div>
      ${section.items.map(item => `
        <button class="navitem" data-page="${item.id}" data-label="${escapeHtml(item.label)}">
          ${item.icon}<span>${escapeHtml(item.label)}</span>
        </button>`).join('')}
    `).join('');

    $$('.navitem', nav).forEach(btn => {
      btn.addEventListener('click', () => {
        route(btn.dataset.page);
        closeSidebar();
      });
    });
  }

  function markActiveNav() {
    $$('.navitem').forEach(btn => btn.classList.toggle('is-active', btn.dataset.page === state.page));
  }

  function renderUserbox() {
    const user = state.user || {};
    const name = user.username || '—';
    const role = roleText(user.type);
    $('#user-name').textContent = name;
    $('#user-role').textContent = role;
    $('#user-avatar').textContent = (name[0] || '?').toUpperCase();
    $('#menu-username').textContent = name;
    $('#menu-role').textContent = role;
  }

  function roleText(type) {
    if (type === 'super_admin') return '超级管理员';
    if (type === 'admin') return '管理员';
    return '普通用户';
  }

  /* ---------------- 路由 ---------------- */
  function route(pageId) {
    if (!PAGES[pageId]) pageId = 'overview';
    state.page = pageId;
    markActiveNav();
    const meta = PAGES[pageId];
    const content = $('#content');
    content.innerHTML = `
      <div class="pagehead">
        <div class="pagehead__titles">
          <h2>${escapeHtml(meta.title)}</h2>
          <p>${escapeHtml(meta.desc)}</p>
        </div>
        <div class="pagehead__actions" id="pagehead-actions"></div>
      </div>
      <div id="page-body"><div class="card"><div class="card__body"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="width:70%;margin-top:10px"></div><div class="skeleton" style="width:55%;margin-top:10px"></div></div></div></div>`;

    stopPolling();
    const render = RENDERERS[pageId];
    if (render) render($('#page-body'), $('#pagehead-actions'));
  }

  function stopPolling() {
    if (state.timers.overview) { clearInterval(state.timers.overview); state.timers.overview = null; }
    if (state.timers.logs) { clearInterval(state.timers.logs); state.timers.logs = null; }
  }

  function pageError(body, message) {
    body.innerHTML = `<div class="card"><div class="card__body"><div class="empty">
      <svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
      <div>${escapeHtml(message || '加载失败')}</div></div></div></div>`;
  }

  /* ============================================================
     页面渲染器
     ============================================================ */
  const RENDERERS = {
    /* ---------------- 概览 ---------------- */
    async overview(body, actions) {
      actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="btn-refresh-overview">刷新</button>`;
      $('#btn-refresh-overview').addEventListener('click', () => route('overview'));

      body.innerHTML = `
        <div class="grid grid--metrics" id="metrics"></div>
        <div class="grid grid--2" style="margin-top:14px">
          <div class="card">
            <div class="card__head">
              <h3 class="card__title">${ICONS.storage}存储池</h3>
              <span class="card__extra" id="disk-count"></span>
            </div>
            <div class="card__body" id="disk-body"><div class="empty">加载中…</div></div>
          </div>
          <div class="grid" style="gap:14px">
            <div class="card">
              <div class="card__head"><h3 class="card__title">${ICONS.about}设备信息</h3></div>
              <div class="card__body"><dl class="kv" id="device-kv"><div class="skeleton" style="height:34px"></div></dl></div>
            </div>
            <div class="card">
              <div class="card__head"><h3 class="card__title">${ICONS.overview}服务状态</h3></div>
              <div class="card__body"><dl class="kv" id="service-kv"></dl></div>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:14px" id="notice-card" hidden>
          <div class="card__head"><h3 class="card__title">${ICONS.logs}系统通知</h3></div>
          <div class="card__body" id="notice-body" style="font-size:13px;color:var(--text-2)"></div>
        </div>`;

      const load = async () => {
        try {
          const [overview, home] = await Promise.all([
            api.get('/api/console/overview'),
            api.get('/api/home/config').catch(() => null),
          ]);
          state.system = overview.data.system;
          state.metrics = overview.data.metrics;
          state.message = (home && home.data && home.data.newMessage) || '';
          paintMetrics();
          paintDisks();
          paintDevice();
          paintService();
          paintNotice();
        } catch (err) {
          pageError(body, err.message);
        }
      };

      await load();
      state.timers.overview = setInterval(load, 3000);
    },

    /* ---------------- 存储管理 ---------------- */
    async storage(body, actions) {
      actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="btn-refresh-storage">刷新</button>`;
      $('#btn-refresh-storage').addEventListener('click', () => route('storage'));
      body.innerHTML = `<div class="grid grid--disks" id="disk-grid"><div class="empty">加载中…</div></div>`;

      try {
        const overview = await api.get('/api/console/overview');
        state.metrics = overview.data.metrics;
        state.system = overview.data.system;
        const disks = (state.metrics && state.metrics.disks && state.metrics.disks.usage) || [];
        if (!disks.length) {
          body.innerHTML = `<div class="card"><div class="card__body"><div class="empty">暂无磁盘数据（需要管理员权限，或系统未被监控覆盖）</div></div></div>`;
          return;
        }
        $('#disk-grid').innerHTML = disks.map(renderDiskCard).join('');
      } catch (err) {
        pageError(body, err.message);
      }
    },

    /* ---------------- 用户管理 ---------------- */
    async users(body, actions) {
      actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="btn-refresh-users">刷新</button>`;
      $('#btn-refresh-users').addEventListener('click', () => route('users'));
      body.innerHTML = `<div class="card"><div class="card__body"><div class="skeleton" style="width:60%"></div></div></div>`;

      try {
        const data = await api.post('/api/user/list', { page: 1, limit: 50 });
        const items = (data.data && data.data.items) || [];
        state.users = items;
        if (!items.length) {
          body.innerHTML = `<div class="card"><div class="card__body"><div class="empty">暂无用户</div></div></div>`;
          return;
        }
        body.innerHTML = `
          <div class="card">
            <div class="card__head">
              <h3 class="card__title">${ICONS.users}账号列表</h3>
              <span class="card__extra">共 ${escapeHtml((data.data.pagination && data.data.pagination.total) || items.length)} 个账号</span>
            </div>
            <div class="card__body" style="padding-top:6px">
              <div style="overflow-x:auto">
                <table class="tbl">
                  <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>最近登录</th></tr></thead>
                  <tbody>
                    ${items.map(u => `<tr>
                      <td><strong>${escapeHtml(u.username)}</strong></td>
                      <td><span class="tag ${u.type === 'super_admin' ? 'tag--blue' : ''}">${escapeHtml(roleText(u.type))}</span></td>
                      <td>${u.is_active === 0 || u.is_active === false ? '<span class="tag tag--err">已禁用</span>' : '<span class="tag tag--ok">正常</span>'}</td>
                      <td class="num">${escapeHtml(fmtTime(u.create_time))}</td>
                      <td class="num">${escapeHtml(fmtTime(u.last_login_time))}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
              <p class="card__extra" style="margin-top:12px">权限与密码修改请在桌面端或移动端完成，Web 控制台当前为只读。</p>
            </div>
          </div>`;
      } catch (err) {
        pageError(body, err.message);
      }
    },

    /* ---------------- 网络服务 ---------------- */
    async network(body, actions) {
      actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="btn-refresh-net">刷新</button>`;
      $('#btn-refresh-net').addEventListener('click', () => route('network'));
      body.innerHTML = `<div class="grid grid--2"><div class="card"><div class="card__body"><div class="skeleton" style="width:50%"></div></div></div><div class="card"><div class="card__body"><div class="skeleton" style="width:50%"></div></div></div></div>`;

      const [ddns, p2p] = await Promise.all([
        api.get('/api/service/ddns/status').catch(() => null),
        api.get('/api/service/nascab/p2p/remoteAccess').catch(() => null),
      ]);
      state.ddns = ddns && ddns.data;
      state.p2p = p2p && p2p.data;
      const listen = (state.system && state.system.listen) || {};

      const statusTag = v => (v ? '<span class="tag tag--ok">已开启</span>' : '<span class="tag">未开启</span>');

      body.innerHTML = `
        <div class="grid grid--2">
          <div class="card">
            <div class="card__head"><h3 class="card__title">${ICONS.network}监听地址</h3></div>
            <div class="card__body"><dl class="kv">
              <div><dt>HTTP</dt><dd class="num">${escapeHtml(listen.host || '—')}:${escapeHtml(listen.port || '—')}</dd></div>
              <div><dt>HTTPS</dt><dd class="num">${listen.httpsEnabled ? `${escapeHtml(listen.host || '—')}:${escapeHtml(listen.httpsPort || '—')}` : '未启用'}</dd></div>
              <div><dt>外网访问</dt><dd>${statusTag(!!(state.p2p && state.p2p.enabled))}</dd></div>
              <div><dt>主机名</dt><dd>${escapeHtml((state.system && state.system.hostname) || '—')}</dd></div>
            </dl></div>
          </div>
          <div class="card">
            <div class="card__head"><h3 class="card__title">${ICONS.security}远程访问（P2P）</h3></div>
            <div class="card__body"><dl class="kv">
              <div><dt>状态</dt><dd>${statusTag(!!(state.p2p && state.p2p.enabled))}</dd></div>
              <div><dt>配对码</dt><dd class="mono">${escapeHtml((state.p2p && (state.p2p.pairCode || state.p2p.code)) || '—')}</dd></div>
              <div><dt>DDNS</dt><dd>${statusTag(!!(state.ddns && state.ddns.enabled))}</dd></div>
              <div><dt>域名</dt><dd class="mono">${escapeHtml((state.ddns && state.ddns.domain) || '—')}</dd></div>
            </dl></div>
          </div>
        </div>
        <div class="card" style="margin-top:14px">
          <div class="card__head"><h3 class="card__title">${ICONS.about}实时速率</h3><span class="card__extra">来自硬件监控，概览页每 3 秒刷新</span></div>
          <div class="card__body"><dl class="kv" id="net-kv"></dl></div>
        </div>`;
      paintNetRate();
      state.timers.overview = setInterval(paintNetRate, 3000);
    },

    /* ---------------- 安全中心 ---------------- */
    async security(body, actions) {
      actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="btn-refresh-sec">刷新</button>`;
      $('#btn-refresh-sec').addEventListener('click', () => route('security'));
      body.innerHTML = `<div class="card"><div class="card__body"><div class="skeleton" style="width:50%"></div></div></div>`;

      const [cfg, bl] = await Promise.all([
        api.get('/api/security/config').catch(() => null),
        api.get('/api/security/ipBlacklist').catch(() => null),
      ]);
      state.securityConfig = cfg && cfg.data;
      state.blacklist = bl && bl.data;
      const list = Array.isArray(state.blacklist) ? state.blacklist : (state.blacklist && state.blacklist.items) || [];

      body.innerHTML = `
        <div class="grid grid--2">
          <div class="card">
            <div class="card__head"><h3 class="card__title">${ICONS.security}登录防护</h3></div>
            <div class="card__body">
              <dl class="kv">
                <div><dt>IP 黑名单</dt><dd><span class="tag ${list.length ? 'tag--warn' : 'tag--ok'}">${list.length} 条</span></dd></div>
                <div><dt>防护策略</dt><dd>连续登录失败自动拉黑</dd></div>
                <div><dt>传输加密</dt><dd>${(state.system && state.system.listen && state.system.listen.httpsEnabled) ? 'HTTPS 已启用' : 'HTTP（建议经反向代理启用 TLS）'}</dd></div>
              </dl>
              <p class="card__extra" style="margin-top:12px">黑名单在服务端维护，多次输错密码的 IP 会被自动拉黑；解禁请在桌面端「安全中心」操作。</p>
            </div>
          </div>
          <div class="card">
            <div class="card__head"><h3 class="card__title">${ICONS.users}登录设备</h3></div>
            <div class="card__body" id="device-list"><div class="empty">加载中…</div></div>
          </div>
        </div>
        <div class="card" style="margin-top:14px">
          <div class="card__head"><h3 class="card__title">${ICONS.logs}IP 黑名单</h3></div>
          <div class="card__body" style="padding-top:6px">
            ${list.length ? `<div style="overflow-x:auto"><table class="tbl">
              <thead><tr><th>IP</th><th>失败次数</th><th>拉黑时间</th><th>解禁时间</th></tr></thead>
              <tbody>${list.map(it => `<tr>
                <td class="mono">${escapeHtml(it.ip || '—')}</td>
                <td class="num">${escapeHtml(it.fail_count != null ? it.fail_count : (it.failCount != null ? it.failCount : '—'))}</td>
                <td class="num">${escapeHtml(fmtTime(it.create_time || it.banned_at))}</td>
                <td class="num">${escapeHtml(fmtTime(it.expire_time || it.banned_until))}</td>
              </tr>`).join('')}</tbody></table></div>` : '<div class="empty">当前没有被拉黑的 IP</div>'}
          </div>
        </div>`;

      try {
        const dev = await api.get('/api/auth/devices');
        const devices = (dev.data && (dev.data.items || dev.data)) || [];
        $('#device-list').innerHTML = Array.isArray(devices) && devices.length
          ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>设备</th><th>系统</th><th>最近活跃</th></tr></thead><tbody>
              ${devices.map(d => `<tr><td>${escapeHtml(d.device_name || d.deviceName || '未知设备')}</td><td>${escapeHtml(d.os_version || d.osVersion || '—')}</td><td class="num">${escapeHtml(fmtTime(d.last_active_time || d.lastActiveTime))}</td></tr>`).join('')}
            </tbody></table></div>`
          : '<div class="empty">暂无设备记录</div>';
      } catch (err) {
        $('#device-list').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
      }
    },

    /* ---------------- 应用中心 ---------------- */
    async apps(body, actions) {
      actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="btn-refresh-apps">刷新</button>`;
      $('#btn-refresh-apps').addEventListener('click', () => route('apps'));
      body.innerHTML = `<div class="grid grid--apps"><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div></div>`;

      try {
        const data = await api.get('/api/apps/getApps');
        const raw = (data && data.data) || {};
        // 接口返回 { hide_app: [...], all_app: [...] }，元素是应用标识字符串
        const all = Array.isArray(raw.all_app) ? raw.all_app : [];
        const hide = Array.isArray(raw.hide_app) ? raw.hide_app : [];
        state.apps = all;
        if (!all.length) {
          body.innerHTML = `<div class="card"><div class="card__body"><div class="empty">暂无应用数据</div></div></div>`;
          return;
        }
        body.innerHTML = `<div class="grid grid--apps">${all.map(id => {
          const meta = APP_META[id] || { name: id, desc: '' };
          const hidden = hide.includes(id);
          return `<div class="card appcard">
            <div class="appcard__top">
              <span class="appcard__icon">${ICONS.apps}</span>
              <div><div class="appcard__name">${escapeHtml(meta.name)}</div></div>
            </div>
            <p class="appcard__desc">${escapeHtml(meta.desc || `应用标识：${id}`)}</p>
            <div class="appcard__foot">
              <span class="tag ${hidden ? '' : 'tag--ok'}">${hidden ? '已隐藏' : '已启用'}</span>
              <span class="card__extra mono">${escapeHtml(id)}</span>
            </div>
          </div>`;
        }).join('')}</div>`;
      } catch (err) {
        pageError(body, err.message);
      }
    },

    /* ---------------- 进程管理 ---------------- */
    async processes(body, actions) {
      actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="btn-refresh-proc">刷新</button>`;
      $('#btn-refresh-proc').addEventListener('click', () => route('processes'));
      body.innerHTML = `<div class="card"><div class="card__body"><div class="skeleton" style="width:60%"></div><p class="card__extra" style="margin-top:10px">进程信息由主进程汇总，首次拉取可能需要几秒</p></div></div>`;

      try {
        const data = await api.get('/api/service/process');
        const list = (data.data && (data.data.items || data.data)) || [];
        state.processes = list;
        if (!Array.isArray(list) || !list.length) {
          body.innerHTML = `<div class="card"><div class="card__body"><div class="empty">暂无进程数据（需要管理员权限）</div></div></div>`;
          return;
        }
        body.innerHTML = `
          <div class="card">
            <div class="card__head"><h3 class="card__title">${ICONS.process}进程列表</h3><span class="card__extra">${list.length} 个进程</span></div>
            <div class="card__body" style="padding-top:6px"><div style="overflow-x:auto">
              <table class="tbl">
                <thead><tr><th>名称</th><th class="tbl__num">PID</th><th class="tbl__num">CPU</th><th class="tbl__num">内存</th><th>状态</th></tr></thead>
                <tbody>${list.map(p => `<tr>
                  <td><strong>${escapeHtml(p.name || p.workerName || '—')}</strong></td>
                  <td class="num mono">${escapeHtml(p.pid || '—')}</td>
                  <td class="tbl__num">${escapeHtml(p.cpu != null ? `${Number(p.cpu).toFixed(1)}%` : '—')}</td>
                  <td class="tbl__num">${escapeHtml(p.memory != null ? fmtBytes(p.memory) : (p.memoryFormatted || '—'))}</td>
                  <td>${p.connected === false ? '<span class="tag tag--warn">已断开</span>' : '<span class="tag tag--ok">运行中</span>'}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div></div>
          </div>`;
      } catch (err) {
        pageError(body, err.message);
      }
    },

    /* ---------------- 系统日志 ---------------- */
    async logs(body, actions) {
      actions.innerHTML = `
        <label class="tag" style="gap:6px;height:30px;cursor:pointer">
          <input type="checkbox" id="log-auto" ${state.logAuto ? 'checked' : ''}> 自动刷新
        </label>
        <button class="btn btn--ghost btn--sm" id="btn-refresh-logs">刷新</button>`;

      body.innerHTML = `
        <div class="card">
          <div class="card__head"><h3 class="card__title">${ICONS.logs}日志</h3><span class="card__extra" id="log-meta"></span></div>
          <div class="card__body">
            <div class="logtabs">
              <button class="logtab ${state.logFile === 'combined' ? 'is-active' : ''}" data-file="combined">运行日志</button>
              <button class="logtab ${state.logFile === 'error' ? 'is-active' : ''}" data-file="error">错误</button>
              <button class="logtab ${state.logFile === 'access' ? 'is-active' : ''}" data-file="access">访问日志</button>
            </div>
            <div class="logview" id="logview"><span class="logview__line">加载中…</span></div>
          </div>
        </div>`;

      $$('.logtab', body).forEach(tab => tab.addEventListener('click', () => {
        state.logFile = tab.dataset.file;
        route('logs');
      }));
      $('#log-auto').addEventListener('change', e => {
        state.logAuto = e.target.checked;
        route('logs');
      });
      $('#btn-refresh-logs').addEventListener('click', () => loadLogs());

      const loadLogs = async () => {
        const view = $('#logview');
        if (!view) return;
        try {
          const data = await api.get(`/api/console/logs?file=${encodeURIComponent(state.logFile)}&lines=300`);
          const lines = (data.data && data.data.lines) || [];
          $('#log-meta').textContent = data.data && data.data.exists
            ? `${data.data.file} · ${fmtBytes(data.data.size)}${data.data.truncated ? ' · 仅显示尾部' : ''}`
            : '日志文件不存在（可能未开启文件日志）';
          view.innerHTML = lines.length
            ? lines.map(line => `<span class="logview__line ${logLineClass(line)}">${escapeHtml(line)}</span>`).join('')
            : '<span class="logview__line">（暂无日志）</span>';
          view.scrollTop = view.scrollHeight;
        } catch (err) {
          view.innerHTML = `<span class="logview__line logview__line--error">${escapeHtml(err.message)}</span>`;
        }
      };

      await loadLogs();
      if (state.logAuto) state.timers.logs = setInterval(loadLogs, 5000);
    },

    /* ---------------- 关于本机 ---------------- */
    async about(body) {
      try {
        const overview = await api.get('/api/console/overview');
        state.system = overview.data.system;
      } catch (err) {
        pageError(body, err.message);
        return;
      }
      const s = state.system || {};
      body.innerHTML = `
        <div class="grid grid--2">
          <div class="card">
            <div class="card__head"><h3 class="card__title">${ICONS.about}系统版本</h3></div>
            <div class="card__body"><dl class="kv">
              <div><dt>产品</dt><dd>${escapeHtml(s.title || '—')}</dd></div>
              <div><dt>版本号</dt><dd class="num">${escapeHtml(s.version || '—')}</dd></div>
              <div><dt>服务器标识</dt><dd class="mono">${escapeHtml(s.serverId || '—')}</dd></div>
              <div><dt>Node</dt><dd class="num">${escapeHtml(s.nodeVersion || '—')}</dd></div>
              <div><dt>Electron</dt><dd class="num">${escapeHtml(s.electron || '未使用（无界面模式）')}</dd></div>
              <div><dt>数据库目录</dt><dd class="mono">${escapeHtml(s.dataDir || '—')}</dd></div>
            </dl></div>
          </div>
          <div class="card">
            <div class="card__head"><h3 class="card__title">${ICONS.storage}硬件环境</h3></div>
            <div class="card__body"><dl class="kv">
              <div><dt>主机名</dt><dd>${escapeHtml(s.hostname || '—')}</dd></div>
              <div><dt>操作系统</dt><dd class="num">${escapeHtml(`${s.osType || ''} ${s.osRelease || ''}`.trim() || '—')}</dd></div>
              <div><dt>架构</dt><dd class="num">${escapeHtml(`${s.platform || ''} / ${s.arch || ''}`)}</dd></div>
              <div><dt>处理器</dt><dd>${escapeHtml(s.cpuModel || '—')}</dd></div>
              <div><dt>核心数</dt><dd class="num">${escapeHtml(s.cpuCores || '—')}</dd></div>
              <div><dt>物理内存</dt><dd class="num">${escapeHtml(fmtBytes(s.totalMemory))}</dd></div>
            </dl></div>
          </div>
        </div>
        <div class="card" style="margin-top:14px">
          <div class="card__head"><h3 class="card__title">${ICONS.logs}开源许可</h3></div>
          <div class="card__body" style="font-size:13px;color:var(--text-2)">
            本项目基于 <a href="https://github.com/nascab/NasCabOS" target="_blank" rel="noopener">NasCabOS</a> 改造，遵循 GPL-3.0 开源许可。
            服务端改造内容见仓库中的 <code>MODIFICATIONS.md</code> 与 <code>DEPLOY.md</code>。
          </div>
        </div>`;
    },
  };

  /* ---------------- 概览页各区块绘制 ---------------- */
  function pushHistory(key, value, max) {
    const arr = state.history[key];
    arr.push(value);
    while (arr.length > max) arr.shift();
  }

  function sparkline(values) {
    if (!values.length) return '';
    const max = Math.max(...values, 1);
    return `<div class="metric__spark">${values.map(v => `<i style="height:${Math.max(6, (v / max) * 100)}%"></i>`).join('')}</div>`;
  }

  function paintMetrics() {
    const m = state.metrics;
    const box = $('#metrics');
    if (!box) return;

    if (!m) {
      box.innerHTML = `
        <div class="card metric"><div class="metric__top"><span class="metric__icon">${ICONS.overview}</span><span class="metric__label">硬件监控</span></div>
        <div class="metric__value"><b>—</b></div><div class="metric__sub">需要管理员权限或监控未就绪</div></div>`;
      return;
    }

    const cpu = pct(m.cpu && m.cpu.usage);
    const mem = pct(m.memory && m.memory.usage);
    const down = (m.network && m.network.downloadBytesPerSec) || 0;
    const up = (m.network && m.network.uploadBytesPerSec) || 0;
    const temp = m.cpu && (m.cpu.temperature != null ? m.cpu.temperature : null);

    pushHistory('cpu', cpu, 24);
    pushHistory('mem', mem, 24);
    pushHistory('net', down + up, 24);

    box.innerHTML = `
      <div class="card metric">
        <div class="metric__top"><span class="metric__icon">${ICONS.overview}</span><span class="metric__label">处理器</span></div>
        <div class="metric__value"><b class="num">${cpu.toFixed(1)}</b><span>%</span></div>
        <div class="metric__sub">${escapeHtml((state.system && state.system.cpuModel) || '') || 'CPU 使用率'}</div>
        <div class="metric__bar"><div class="bar__fill ${barClass(cpu)}" style="width:${cpu}%"></div></div>
        ${sparkline(state.history.cpu)}
      </div>
      <div class="card metric">
        <div class="metric__top"><span class="metric__icon is-mem">${ICONS.storage}</span><span class="metric__label">内存</span></div>
        <div class="metric__value"><b class="num">${mem.toFixed(1)}</b><span>%</span></div>
        <div class="metric__sub">已用 ${escapeHtml(fmtBytes(m.memory && m.memory.used))} / ${escapeHtml(fmtBytes(m.memory && m.memory.total))}</div>
        <div class="metric__bar"><div class="bar__fill ${barClass(mem)}" style="width:${mem}%"></div></div>
        ${sparkline(state.history.mem)}
      </div>
      <div class="card metric">
        <div class="metric__top"><span class="metric__icon is-net">${ICONS.network}</span><span class="metric__label">网络</span></div>
        <div class="metric__value"><b class="num">${escapeHtml(fmtSpeed(down))}</b></div>
        <div class="metric__sub">↑ ${escapeHtml(fmtSpeed(up))}　↓ ${escapeHtml(fmtSpeed(down))}</div>
        <div class="metric__bar"><div class="bar__fill" style="width:${pct((down / (1024 * 1024 * 50)) * 100)}%"></div></div>
        ${sparkline(state.history.net)}
      </div>
      <div class="card metric">
        <div class="metric__top"><span class="metric__icon is-temp">${ICONS.security}</span><span class="metric__label">温度</span></div>
        <div class="metric__value"><b class="num">${temp != null ? Number(temp).toFixed(0) : '—'}</b>${temp != null ? '<span>°C</span>' : ''}</div>
        <div class="metric__sub">${m.cpu && m.cpu.temperatureMax != null ? `峰值 ${Number(m.cpu.temperatureMax).toFixed(0)}°C` : '当前平台不支持温度读取'}</div>
      </div>`;
  }

  function paintDisks() {
    const body = $('#disk-body');
    if (!body) return;
    const disks = (state.metrics && state.metrics.disks && state.metrics.disks.usage) || [];
    const count = $('#disk-count');
    if (count) count.textContent = `${disks.length} 个挂载点`;

    if (!disks.length) {
      body.innerHTML = `<div class="empty">暂无磁盘数据</div>`;
      return;
    }
    body.innerHTML = `<div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>挂载点</th><th class="tbl__num">容量</th><th class="tbl__num">可用</th><th style="width:32%">使用率</th></tr></thead>
      <tbody>${disks.map(d => {
        const size = parseSize(d.sizeFormatted);
        const avail = parseSize(d.availableFormatted);
        const used = Math.max(0, size - avail);
        const p = size > 0 ? pct((used / size) * 100) : 0;
        return `<tr>
          <td><div><strong class="mono">${escapeHtml(d.mount || d.fs || '—')}</strong></div><div class="card__extra">${escapeHtml(d.type || '')}</div></td>
          <td class="tbl__num">${escapeHtml(d.sizeFormatted || '—')}</td>
          <td class="tbl__num">${escapeHtml(d.availableFormatted || '—')}</td>
          <td><div class="bar"><div class="bar__fill ${barClass(p)}" style="width:${p}%"></div></div><div class="card__extra num">${p.toFixed(1)}%</div></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function renderDiskCard(d) {
    const size = parseSize(d.sizeFormatted);
    const avail = parseSize(d.availableFormatted);
    const used = Math.max(0, size - avail);
    const p = size > 0 ? pct((used / size) * 100) : 0;
    return `<div class="card disk">
      <div class="disk__top"><span class="disk__mount">${escapeHtml(d.mount || d.fs || '—')}</span><span class="tag">${escapeHtml(d.type || '未知')}</span></div>
      <div class="disk__size">文件系统 ${escapeHtml(d.fs || '—')}</div>
      <div class="bar"><div class="bar__fill ${barClass(p)}" style="width:${p}%"></div></div>
      <div class="disk__nums"><span>已用 <b>${escapeHtml(fmtBytes(used))}</b></span><span>共 <b>${escapeHtml(d.sizeFormatted || '—')}</b></span></div>
    </div>`;
  }

  function paintDevice() {
    const s = state.system;
    const box = $('#device-kv');
    if (!box || !s) return;
    box.innerHTML = `
      <div><dt>设备名称</dt><dd>${escapeHtml(s.hostname || '—')}</dd></div>
      <div><dt>系统版本</dt><dd class="num">v${escapeHtml(s.version || '—')}</dd></div>
      <div><dt>处理器</dt><dd>${escapeHtml(s.cpuModel || '—')}</dd></div>
      <div><dt>物理内存</dt><dd class="num">${escapeHtml(fmtBytes(s.totalMemory))}</dd></div>
      <div><dt>运行时长</dt><dd class="num">${escapeHtml(fmtUptime(s.uptimeSec))}</dd></div>
      <div><dt>启动时间</dt><dd class="num">${escapeHtml(fmtTime(s.startedAt))}</dd></div>`;
  }

  function paintService() {
    const s = state.system;
    const box = $('#service-kv');
    if (!box || !s) return;
    box.innerHTML = `
      <div><dt>服务状态</dt><dd><span class="tag tag--ok">运行中</span></dd></div>
      <div><dt>HTTP 端口</dt><dd class="num">${escapeHtml(s.listen && s.listen.port)}</dd></div>
      <div><dt>HTTPS</dt><dd>${s.listen && s.listen.httpsEnabled ? `<span class="tag tag--ok">${escapeHtml(s.listen.httpsPort)}</span>` : '<span class="tag">未启用</span>'}</dd></div>
      <div><dt>Node 版本</dt><dd class="num">${escapeHtml(s.nodeVersion || '—')}</dd></div>`;
  }

  function paintNotice() {
    const card = $('#notice-card');
    const body = $('#notice-body');
    if (!card || !body) return;
    if (!state.message) { card.hidden = true; return; }
    card.hidden = false;
    body.textContent = state.message;
  }

  /** 网络服务页：把硬件监控的聚合速率渲染成定义列表 */
  async function paintNetRate() {
    const box = $('#net-kv');
    if (!box) return;
    if (!state.metrics) {
      try {
        const overview = await api.get('/api/console/overview');
        state.metrics = overview.data.metrics;
        state.system = overview.data.system;
      } catch (_) {}
    }
    const m = state.metrics;
    if (!m || !m.network) {
      box.innerHTML = '<div><dt>状态</dt><dd>暂无监控数据</dd></div>';
      return;
    }
    box.innerHTML = `
      <div><dt>下载速率</dt><dd class="num">${escapeHtml(fmtSpeed(m.network.downloadBytesPerSec || 0))}</dd></div>
      <div><dt>上传速率</dt><dd class="num">${escapeHtml(fmtSpeed(m.network.uploadBytesPerSec || 0))}</dd></div>
      <div><dt>服务端标识</dt><dd class="mono">${escapeHtml((state.system && state.system.serverId) || '—')}</dd></div>
      <div><dt>平台</dt><dd class="num">${escapeHtml((state.system && `${state.system.osType} ${state.system.osRelease}`) || '—')}</dd></div>`;
  }

  function logLineClass(line) {
    const t = String(line).toLowerCase();
    if (t.includes('error') || t.includes('错误') || t.includes('失败')) return 'logview__line--error';
    if (t.includes('warn') || t.includes('警告')) return 'logview__line--warn';
    if (t.includes('info')) return 'logview__line--info';
    return '';
  }

  /** "1.82 TiB" / "512 GB" → 字节数；解析不了返回 0 */
  function parseSize(text) {
    if (typeof text === 'number') return text;
    const m = String(text || '').trim().match(/^([\d.]+)\s*([KMGT]?I?B)$/i);
    if (!m) return 0;
    const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, PB: 1024 ** 5, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4, PIB: 1024 ** 5 };
    const key = m[2].toUpperCase();
    const factor = units[key] || units[key.replace('I', '')] || 1;
    return parseFloat(m[1]) * factor;
  }

  /* ============================================================
     认证流程
     ============================================================ */
  let twofaTempToken = null;

  function showLoginError(message) {
    const box = $('#login-error');
    box.textContent = message;
    box.hidden = !message;
  }

  async function checkInitState() {
    try {
      const data = await api.get('/api/auth/hasSuperAdmin');
      const has = !!(data.data && data.data.hasSuperAdmin);
      if (!has) {
        // 尚未初始化：直接进入创建管理员向导
        $('#login-form').hidden = true;
        $('#setup-form').hidden = false;
        $('#auth-subtitle').textContent = '首次部署 · 创建超级管理员';
        return;
      }
    } catch (_) {}
    $('#login-form').hidden = false;
  }

  async function submitLogin(username, password) {
    const btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = '登录中…';
    showLoginError('');
    try {
      const data = await api.post('/api/auth/login', {
        username,
        password: `b64:${b64Encode(password)}`,
        device_fingerprint: api.deviceFingerprint(),
      });
      const payload = (data && data.data) || {};

      if (payload.twoFactorRequired) {
        twofaTempToken = payload.tempToken;
        $('#login-form').hidden = true;
        $('#twofa-form').hidden = false;
        $('#twofa-code').focus();
        return;
      }
      if (!payload.accessToken) {
        showLoginError('登录失败：服务端未返回访问令牌');
        return;
      }
      api.saveSession(payload);
      state.user = payload.user || JSON.parse(localStorage.getItem(LS_USER) || 'null');
      await enterConsole();
    } catch (err) {
      showLoginError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  }

  async function submitTwofa(code) {
    const btn = $('#twofa-btn');
    btn.disabled = true;
    btn.textContent = '验证中…';
    $('#twofa-error').hidden = true;
    try {
      const data = await api.post('/api/auth/2fa/login/verify', { tempToken: twofaTempToken, code });
      const payload = (data && data.data) || {};
      if (!payload.accessToken) {
        throw new Error('验证失败：服务端未返回访问令牌');
      }
      api.saveSession(payload);
      state.user = payload.user;
      await enterConsole();
    } catch (err) {
      const box = $('#twofa-error');
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '验 证';
    }
  }

  async function submitSetup() {
    // 按 ID 取值，不依赖 form 的命名属性访问（部分环境不支持）
    const username = $('#setup-username').value.trim();
    const pwd = $('#setup-password').value;
    const pwd2 = $('#setup-password2').value;
    const box = $('#setup-error');

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      box.textContent = '用户名需为 3-20 位字母、数字或下划线';
      box.hidden = false;
      return;
    }
    if (pwd.length < 6) {
      box.textContent = '密码长度至少 6 位';
      box.hidden = false;
      return;
    }
    if (pwd !== pwd2) {
      box.textContent = '两次输入的密码不一致';
      box.hidden = false;
      return;
    }

    const btn = $('#setup-btn');
    btn.disabled = true;
    btn.textContent = '创建中…';
    box.hidden = true;
    try {
      const data = await api.post('/api/auth/createSuperAdmin', {
        username,
        password: `b64:${b64Encode(pwd)}`,
        question: 'init',
        answer: 'init',
        language: 'zh-CN',
      });
      const payload = (data && data.data) || {};
      if (!payload.accessToken) {
        throw new Error('创建成功但未返回访问令牌，请返回登录');
      }
      $('#setup-form').hidden = true;
      $('#setup-done').hidden = false;
      api.saveSession(payload);
      state.user = payload.user;
      setTimeout(() => enterConsole(), 900);
    } catch (err) {
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '创建并进入控制台';
    }
  }

  async function enterConsole() {
    try {
      const profile = await api.get('/api/auth/profile');
      // 响应结构是 { user: {...} }
      const u = profile && profile.data && (profile.data.user || profile.data);
      if (u && u.username) state.user = u;
    } catch (err) {
      // profile 拉取失败不阻断进入控制台，登录响应里已带有用户信息
      if (err && err.status === 401) { onSessionExpired(); return; }
    }
    try {
      const boot = await api.get('/api/console/bootstrap');
      if (boot && boot.data) applyBranding(boot.data.title, boot.data.version);
    } catch (_) {}
    showApp();
    toast('登录成功', 'ok');
  }

  async function logout() {
    try { await api.post('/api/auth/logout', {}); } catch (_) {}
    api.clearSession();
    state.user = null;
    state.system = null;
    state.metrics = null;
    showAuth();
    await checkInitState();
    toast('已退出登录');
  }

  /* ---------------- 侧边栏（移动端） ---------------- */
  function openSidebar() {
    $('#sidebar').classList.add('is-open');
    $('#scrim').hidden = false;
  }
  function closeSidebar() {
    $('#sidebar').classList.remove('is-open');
    $('#scrim').hidden = true;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $('#toggle-pwd').addEventListener('click', () => {
      const input = $('#login-password');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    $('#login-form').addEventListener('submit', e => {
      e.preventDefault();
      submitLogin($('#login-username').value.trim(), $('#login-password').value);
    });

    $('#twofa-form').addEventListener('submit', e => {
      e.preventDefault();
      submitTwofa($('#twofa-code').value.trim());
    });

    $('#twofa-back').addEventListener('click', () => {
      $('#twofa-form').hidden = true;
      $('#login-form').hidden = false;
      showLoginError('');
    });

    $('#setup-form').addEventListener('submit', e => {
      e.preventDefault();
      submitSetup();
    });

    $('#burger').addEventListener('click', openSidebar);
    $('#scrim').addEventListener('click', closeSidebar);

    // 用户菜单
    const menu = $('#userbox-menu');
    $('#userbox-btn').addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', e => {
      if (!$('#userbox').contains(e.target)) menu.hidden = true;
    });
    $$('#userbox-menu button').forEach(btn => btn.addEventListener('click', () => {
      menu.hidden = true;
      const act = btn.dataset.act;
      if (act === 'logout') logout();
      else if (act === 'refresh') route(state.page);
      else if (act === 'about') route('about');
    }));

    // 通知
    $('#btn-notice').addEventListener('click', () => {
      const existing = $('.notice');
      if (existing) { existing.remove(); return; }
      const panel = document.createElement('div');
      panel.className = 'card notice';
      panel.innerHTML = `
        <div class="notice__head"><span>系统通知</span><button class="btn btn--ghost btn--sm" data-close>关闭</button></div>
        <div class="notice__body">${
          state.message
            ? `<div class="notice__item">${escapeHtml(state.message)}<time>${escapeHtml(fmtTime(Date.now()))}</time></div>`
            : '<div class="empty">暂无通知</div>'
        }</div>`;
      document.body.appendChild(panel);
      $('[data-close]', panel).addEventListener('click', () => panel.remove());
      setTimeout(() => {
        document.addEventListener('click', function onDoc(e) {
          if (!panel.contains(e.target)) { panel.remove(); document.removeEventListener('click', onDoc); }
        });
      }, 0);
    });

    // 全局搜索：过滤菜单并跳转
    $('#global-search').addEventListener('input', e => {
      const kw = e.target.value.trim().toLowerCase();
      let firstVisible = null;
      $$('.navitem').forEach(btn => {
        const hit = !kw || btn.dataset.label.toLowerCase().includes(kw);
        btn.hidden = !hit;
        if (hit && !firstVisible) firstVisible = btn;
      });
      $$('.sidebar__group').forEach(g => {
        let next = g.nextElementSibling;
        let any = false;
        while (next && next.classList.contains('navitem')) {
          if (!next.hidden) any = true;
          next = next.nextElementSibling;
        }
        g.hidden = !any;
      });
      if (kw && firstVisible) firstVisible.click();
    });

    // 快捷键
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        $('#global-search').focus();
      }
      if (e.key === 'Escape') {
        closeSidebar();
        const notice = $('.notice');
        if (notice) notice.remove();
        $('#userbox-menu').hidden = true;
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    bindEvents();

    try {
      const health = await api.get('/healthz');
      if (health && health.serverId) {
        // 仅用于确认服务可达
      }
    } catch (_) {}

    if (api.token) {
      let expired = false;
      try {
        const profile = await api.get('/api/auth/profile');
        // 响应结构是 { user: {...} }
        const u = profile && profile.data && (profile.data.user || profile.data);
        if (u && u.username) state.user = u;
      } catch (err) {
        // 只有 401 才说明令牌失效；profile 自身出错不该把用户踢下线
        if (err && err.status === 401) expired = true;
      }
      if (!expired) {
        state.user = state.user || JSON.parse(localStorage.getItem(LS_USER) || 'null');
        showApp();
        return;
      }
      api.clearSession();
    }

    showAuth();
    try {
      const boot = await api.get('/api/console/bootstrap');
      const info = boot && boot.data;
      if (info) applyBranding(info.title, info.version);
    } catch (_) {}
    await checkInitState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
