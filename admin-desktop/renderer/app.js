const api = window.socialBirdAdmin;
const root = document.getElementById('app');

const state = {
  stage: 'login',
  challengeId: '',
  emailHint: '',
  admin: null,
  view: 'overview',
  stats: null,
  users: [],
  audit: [],
  query: '',
  busy: false,
  error: '',
  notice: '',
};

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const setError = (error) => {
  state.error = error?.message || String(error || 'Неизвестная ошибка');
  state.notice = '';
  render();
};

const setNotice = (message) => {
  state.notice = String(message || '');
  state.error = '';
  render();
};

const setBusy = (busy) => {
  state.busy = busy;
  render();
};

const messageBlock = () => `${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}${state.notice ? `<div class="success">${esc(state.notice)}</div>` : ''}`;
const spinner = () => state.busy ? '<span class="spinner"></span>' : '';

function renderLogin() {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>SocialBIRD Admin</h1>
        <p class="muted">Отдельная защищённая desktop-панель администратора. Пароль и токены не сохраняются в renderer/localStorage.</p>
        <div class="stack">
          ${messageBlock()}
          <form id="login-form" class="stack">
            <div class="field"><label>Почта / логин / @username</label><input id="login-name" autocomplete="username" required /></div>
            <div class="field"><label>Пароль</label><input id="login-password" type="password" autocomplete="current-password" required /></div>
            <button class="primary" ${state.busy ? 'disabled' : ''}>${spinner()}Войти</button>
          </form>
          <button id="open-site" class="ghost">Открыть socialbird.ru</button>
        </div>
      </div>
    </div>`;
  document.getElementById('login-form').addEventListener('submit', onLogin);
  document.getElementById('open-site').addEventListener('click', () => api.openSite());
}

async function onLogin(event) {
  event.preventDefault();
  const emailOrUsername = document.getElementById('login-name').value;
  const password = document.getElementById('login-password').value;
  state.busy = true;
  state.error = '';
  render();
  try {
    await api.login({ emailOrUsername, password });
    const data = await api.requestCode();
    state.challengeId = data.challengeId;
    state.emailHint = data.emailHint || '';
    state.stage = '2fa';
    state.notice = 'Код двухфакторного входа отправлен на почту администратора.';
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function renderTwoFactor() {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Подтверждение администратора</h1>
        <p class="muted">Введите 6-значный код${state.emailHint ? `, отправленный на ${esc(state.emailHint)}` : ''}. Код действует 5 минут.</p>
        <div class="stack">
          ${messageBlock()}
          <form id="code-form" class="stack">
            <div class="field"><label>Код из письма</label><input id="admin-code" class="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" required autofocus /></div>
            <button class="primary" ${state.busy ? 'disabled' : ''}>${spinner()}Подтвердить</button>
          </form>
          <button id="back-login" class="ghost">Вернуться ко входу</button>
        </div>
      </div>
    </div>`;
  document.getElementById('admin-code').addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
  });
  document.getElementById('code-form').addEventListener('submit', onConfirmCode);
  document.getElementById('back-login').addEventListener('click', async () => {
    await api.logout();
    Object.assign(state, { stage: 'login', challengeId: '', emailHint: '', error: '', notice: '' });
    render();
  });
}

async function onConfirmCode(event) {
  event.preventDefault();
  const code = document.getElementById('admin-code').value;
  state.busy = true;
  state.error = '';
  render();
  try {
    const data = await api.confirmCode({ challengeId: state.challengeId, code });
    state.admin = data.admin;
    state.stage = 'dashboard';
    state.view = 'overview';
    state.notice = '';
    await loadAll();
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function loadAll() {
  const [stats, users, audit] = await Promise.all([api.getStats(), api.getUsers(state.query), api.getAudit()]);
  state.stats = stats;
  state.users = users.users || [];
  state.audit = audit.audit || [];
}

async function refreshCurrent() {
  state.busy = true;
  state.error = '';
  render();
  try {
    if (state.view === 'overview') state.stats = await api.getStats();
    if (state.view === 'users') state.users = (await api.getUsers(state.query)).users || [];
    if (state.view === 'audit') state.audit = (await api.getAudit()).audit || [];
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function renderOverview() {
  const stats = state.stats || {};
  const cards = [
    ['Пользователи', stats.users ?? '—'],
    ['Онлайн сейчас', stats.onlineUsers ?? '—'],
    ['Заблокированы', stats.blocked ?? '—'],
    ['Ожидают подтверждения', stats.pendingRegistrations ?? '—'],
    ['Администраторы', stats.admins ?? '—'],
    ['FCM-токены', stats.nativePushTokens ?? '—'],
  ];
  return `
    <div class="grid stats">${cards.map(([label, value]) => `<div class="stat"><span class="muted">${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
    <div class="panel">
      <h3>Состояние инфраструктуры</h3>
      <div class="status-row">
        <span class="badge ${stats.smtpConfigured ? 'good' : 'warn'}">SMTP: ${stats.smtpConfigured ? 'готов' : 'не настроен'}</span>
        <span class="badge ${stats.fcmConfigured ? 'good' : 'warn'}">FCM: ${stats.fcmConfigured ? 'готов' : 'не настроен'}</span>
        <span class="badge good">API: подключён</span>
        <span class="badge">Время API: ${esc(stats.apiTime || '—')}</span>
      </div>
    </div>`;
}

function renderUsers() {
  const rows = state.users.map((user) => {
    const blocked = String(user.isBlocked || '') === 'заблокирован';
    return `<tr>
      <td>${esc(user.id)}</td>
      <td><strong>${esc(user.username)}</strong><div class="subtle">${user.user_tag ? '@' + esc(user.user_tag) : ''}</div></td>
      <td>${esc(user.email)}</td>
      <td>${esc(user.github_username || '—')}</td>
      <td><select class="role-select" data-id="${esc(user.id)}"><option value="user" ${String(user.role || 'user') === 'user' ? 'selected' : ''}>user</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
      <td><span class="badge ${blocked ? 'warn' : 'good'}">${blocked ? 'Заблокирован' : 'Активен'}</span></td>
      <td><div class="actions"><button class="${blocked ? 'secondary' : 'danger'} small block-btn" data-id="${esc(user.id)}" data-blocked="${blocked ? '0' : '1'}">${blocked ? 'Разблокировать' : 'Заблокировать'}</button></div></td>
    </tr>`;
  }).join('');
  return `
    <div class="panel">
      <div class="toolbar"><input id="user-search" class="search" placeholder="Имя, email или @username" value="${esc(state.query)}" /><button id="search-users" class="secondary">Найти</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Пользователь</th><th>Email</th><th>GitHub</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">Пользователи не найдены</td></tr>'}</tbody></table></div>
    </div>`;
}

function renderAudit() {
  const items = state.audit.map((entry) => `<div class="audit-item"><div>${esc(new Date(entry.created_at).toLocaleString('ru-RU'))}</div><div>${esc(entry.admin_username || entry.admin_id)}</div><div><strong>${esc(entry.action_name)}</strong>${entry.target_id ? ` · ${esc(entry.target_type || '')} #${esc(entry.target_id)}` : ''}</div></div>`).join('');
  return `<div class="panel"><h3>Журнал действий администраторов</h3><div class="audit">${items || '<div class="empty">Журнал пока пуст</div>'}</div></div>`;
}

function renderDashboard() {
  const content = state.view === 'users' ? renderUsers() : state.view === 'audit' ? renderAudit() : renderOverview();
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div><div class="brand">SocialBIRD Admin</div><div class="subtle">${esc(state.admin?.username || 'Администратор')}</div></div>
        <div class="nav">
          <button data-view="overview" class="${state.view === 'overview' ? 'active' : ''}">Обзор</button>
          <button data-view="users" class="${state.view === 'users' ? 'active' : ''}">Пользователи</button>
          <button data-view="audit" class="${state.view === 'audit' ? 'active' : ''}">Журнал действий</button>
        </div>
        <div class="sidebar-footer"><button id="open-site" class="ghost">Открыть SocialBIRD</button><button id="logout" class="ghost">Выйти</button></div>
      </aside>
      <main class="main">
        <div class="topbar"><div><div class="title">${state.view === 'users' ? 'Пользователи' : state.view === 'audit' ? 'Аудит' : 'Состояние SocialBIRD'}</div><div class="subtle">Desktop-сессия защищена email 2FA и повторной проверкой роли на сервере.</div></div><button id="refresh" class="secondary" ${state.busy ? 'disabled' : ''}>${spinner()}Обновить</button></div>
        ${messageBlock()}
        ${content}
      </main>
    </div>`;

  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    state.view = button.dataset.view;
    state.error = '';
    state.notice = '';
    render();
  }));
  document.getElementById('refresh').addEventListener('click', refreshCurrent);
  document.getElementById('open-site').addEventListener('click', () => api.openSite());
  document.getElementById('logout').addEventListener('click', async () => {
    await api.logout();
    Object.assign(state, { stage: 'login', challengeId: '', emailHint: '', admin: null, stats: null, users: [], audit: [], error: '', notice: '' });
    render();
  });

  if (state.view === 'users') {
    document.getElementById('search-users').addEventListener('click', searchUsers);
    document.getElementById('user-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') searchUsers(); });
    document.querySelectorAll('.block-btn').forEach((button) => button.addEventListener('click', async () => {
      const id = Number(button.dataset.id);
      const blocked = button.dataset.blocked === '1';
      state.busy = true; render();
      try {
        await api.setBlocked({ id, blocked });
        state.users = (await api.getUsers(state.query)).users || [];
        state.notice = blocked ? 'Пользователь заблокирован.' : 'Пользователь разблокирован.';
        state.error = '';
      } catch (error) { state.error = error.message || String(error); }
      state.busy = false; render();
    }));
    document.querySelectorAll('.role-select').forEach((select) => select.addEventListener('change', async () => {
      const id = Number(select.dataset.id);
      const role = select.value;
      state.busy = true; render();
      try {
        await api.setRole({ id, role });
        state.users = (await api.getUsers(state.query)).users || [];
        state.notice = `Роль пользователя изменена на ${role}.`;
        state.error = '';
      } catch (error) { state.error = error.message || String(error); }
      state.busy = false; render();
    }));
  }
}

async function searchUsers() {
  state.query = document.getElementById('user-search').value.trim();
  state.busy = true;
  render();
  try {
    state.users = (await api.getUsers(state.query)).users || [];
    state.error = '';
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function render() {
  if (state.stage === '2fa') return renderTwoFactor();
  if (state.stage === 'dashboard') return renderDashboard();
  return renderLogin();
}

render();
