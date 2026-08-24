const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const API_BASE = String(process.env.SOCIALBIRD_ADMIN_API_URL || 'https://api.socialbird.ru').replace(/\/$/, '');
let loginToken = '';
let desktopToken = '';
let desktopTokenExpiresAt = 0;

const request = async (route, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API_BASE}${route}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const requireDesktopSession = () => {
  if (!desktopToken || desktopTokenExpiresAt <= Date.now()) {
    desktopToken = '';
    desktopTokenExpiresAt = 0;
    throw new Error('Desktop-сессия истекла. Войдите заново.');
  }
  return desktopToken;
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: 'SocialBIRD Admin',
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
};

ipcMain.handle('admin:login', async (_event, credentials) => {
  loginToken = '';
  desktopToken = '';
  desktopTokenExpiresAt = 0;
  const emailOrUsername = String(credentials?.emailOrUsername || '').trim();
  const password = String(credentials?.password || '');
  if (!emailOrUsername || !password) throw new Error('Введите логин и пароль.');
  const data = await request('/login', { method: 'POST', body: { emailOrUsername, password } });
  if (data?.user?.role !== 'admin' || !data?.token) throw new Error('Этот аккаунт не имеет роли администратора.');
  loginToken = String(data.token);
  return { user: data.user };
});

ipcMain.handle('admin:request-code', async () => {
  if (!loginToken) throw new Error('Сначала войдите в admin-аккаунт.');
  return request('/admin/desktop/request-code', { method: 'POST', token: loginToken, body: {} });
});

ipcMain.handle('admin:confirm-code', async (_event, payload) => {
  if (!loginToken) throw new Error('Сначала войдите в admin-аккаунт.');
  const data = await request('/admin/desktop/confirm-code', {
    method: 'POST',
    token: loginToken,
    body: {
      challengeId: String(payload?.challengeId || ''),
      code: String(payload?.code || ''),
    },
  });
  if (!data?.token) throw new Error('Сервер не вернул desktop-сессию.');
  desktopToken = String(data.token);
  desktopTokenExpiresAt = Date.now() + Number(data.expiresInSeconds || 1800) * 1000;
  loginToken = '';
  return { admin: data.admin, expiresInSeconds: data.expiresInSeconds };
});

ipcMain.handle('admin:stats', () => request('/admin/desktop/stats', { token: requireDesktopSession() }));
ipcMain.handle('admin:users', async (_event, query) => {
  const users = await request(`/admin/v2/users?search=${encodeURIComponent(String(query || ''))}`, { token: requireDesktopSession() });
  return { users: Array.isArray(users) ? users : [] };
});
ipcMain.handle('admin:audit', () => request('/admin/desktop/audit?limit=120', { token: requireDesktopSession() }));
ipcMain.handle('admin:posts', () => request('/admin/posts', { token: requireDesktopSession() }));
ipcMain.handle('admin:set-post-status', (_event, payload) => request(`/admin/posts/${Number(payload?.id)}/status`, {
  method: 'PATCH',
  token: requireDesktopSession(),
  body: { status: String(payload?.status || '') },
}));
ipcMain.handle('admin:delete-post', (_event, payload) => request(`/admin/posts/${Number(payload?.id)}`, {
  method: 'DELETE',
  token: requireDesktopSession(),
}));
ipcMain.handle('admin:block-user', (_event, payload) => request(`/admin/v2/users/${Number(payload?.id)}/block`, {
  method: payload?.blocked ? 'POST' : 'DELETE',
  token: requireDesktopSession(),
  body: payload?.blocked ? { reason: String(payload?.reason || '').slice(0, 500) } : undefined,
}));
ipcMain.handle('admin:delete-user', (_event, payload) => request(`/admin/v2/users/${Number(payload?.id)}`, {
  method: 'DELETE',
  token: requireDesktopSession(),
  body: { reason: String(payload?.reason || 'Удалено администратором').slice(0, 500) },
}));
ipcMain.handle('admin:set-role', (_event, payload) => request(`/admin/desktop/users/${Number(payload?.id)}/role`, {
  method: 'PATCH',
  token: requireDesktopSession(),
  body: { role: String(payload?.role || '') },
}));
ipcMain.handle('admin:logout', () => {
  loginToken = '';
  desktopToken = '';
  desktopTokenExpiresAt = 0;
  return { ok: true };
});
ipcMain.handle('admin:open-site', () => shell.openExternal('https://socialbird.ru'));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
