const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const API_BASE = String(process.env.SOCIALBIRD_ADMIN_API_URL || 'https://api.socialbird.ru').replace(/\/$/, '');
let loginToken = '';
let desktopToken = '';
let desktopTokenExpiresAt = 0;
const pickedCinemaFiles = new Map();

const request = async (route, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 12000));
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

const requestBinary = async (route, body, token) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${API_BASE}${route}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${token}`,
      },
      body,
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

const mimeFromName = (name) => {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.m4v') return 'video/x-m4v';
  if (ext === '.avi') return 'video/x-msvideo';
  return 'video/mp4';
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1060,
    minHeight: 700,
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
  pickedCinemaFiles.clear();
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
  method: 'PATCH', token: requireDesktopSession(), body: { status: String(payload?.status || '') },
}));
ipcMain.handle('admin:delete-post', (_event, payload) => request(`/admin/posts/${Number(payload?.id)}`, {
  method: 'DELETE', token: requireDesktopSession(),
}));
ipcMain.handle('admin:block-user', (_event, payload) => request(`/admin/v2/users/${Number(payload?.id)}/block`, {
  method: payload?.blocked ? 'POST' : 'DELETE', token: requireDesktopSession(),
  body: payload?.blocked ? { reason: String(payload?.reason || '').slice(0, 500) } : undefined,
}));
ipcMain.handle('admin:delete-user', (_event, payload) => request(`/admin/v2/users/${Number(payload?.id)}`, {
  method: 'DELETE', token: requireDesktopSession(),
  body: { reason: String(payload?.reason || 'Удалено администратором').slice(0, 500) },
}));
ipcMain.handle('admin:set-role', (_event, payload) => request(`/admin/desktop/users/${Number(payload?.id)}/role`, {
  method: 'PATCH', token: requireDesktopSession(), body: { role: String(payload?.role || '') },
}));

ipcMain.handle('admin:cinema-titles', (_event, filters = {}) => {
  const query = new URLSearchParams();
  if (filters.q) query.set('q', String(filters.q));
  if (filters.type) query.set('type', String(filters.type));
  return request(`/admin/desktop/cinema/titles?${query.toString()}`, { token: requireDesktopSession() });
});
ipcMain.handle('admin:cinema-title', (_event, id) => request(`/admin/desktop/cinema/titles/${Number(id)}`, { token: requireDesktopSession() }));
ipcMain.handle('admin:cinema-create-title', (_event, payload) => request('/admin/desktop/cinema/titles', {
  method: 'POST', token: requireDesktopSession(), body: payload || {},
}));
ipcMain.handle('admin:cinema-update-title', (_event, payload) => request(`/admin/desktop/cinema/titles/${Number(payload?.id)}`, {
  method: 'PATCH', token: requireDesktopSession(), body: payload?.data || {},
}));
ipcMain.handle('admin:cinema-delete-title', (_event, id) => request(`/admin/desktop/cinema/titles/${Number(id)}`, {
  method: 'DELETE', token: requireDesktopSession(),
}));
ipcMain.handle('admin:cinema-add-episode', (_event, payload) => request(`/admin/desktop/cinema/titles/${Number(payload?.titleId)}/episodes`, {
  method: 'POST', token: requireDesktopSession(), body: payload?.data || {},
}));
ipcMain.handle('admin:cinema-update-episode', (_event, payload) => request(`/admin/desktop/cinema/episodes/${Number(payload?.id)}`, {
  method: 'PATCH', token: requireDesktopSession(), body: payload?.data || {},
}));
ipcMain.handle('admin:cinema-delete-episode', (_event, id) => request(`/admin/desktop/cinema/episodes/${Number(id)}`, {
  method: 'DELETE', token: requireDesktopSession(),
}));

ipcMain.handle('admin:cinema-pick-video', async () => {
  requireDesktopSession();
  const result = await dialog.showOpenDialog({
    title: 'Выберите видео для C-Party',
    properties: ['openFile'],
    filters: [
      { name: 'Видео', extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error('Выбранный объект не является файлом.');
  const fileId = crypto.randomUUID();
  const record = {
    path: filePath,
    name: path.basename(filePath),
    size: Number(stat.size),
    mimeType: mimeFromName(filePath),
  };
  pickedCinemaFiles.set(fileId, record);
  return { fileId, name: record.name, size: record.size, mimeType: record.mimeType };
});

ipcMain.handle('admin:cinema-upload-video', async (event, fileId) => {
  const token = requireDesktopSession();
  const record = pickedCinemaFiles.get(String(fileId));
  if (!record) throw new Error('Файл не выбран или выбор устарел. Выберите видео заново.');
  const started = await request('/admin/desktop/cinema/uploads', {
    method: 'POST', token, timeoutMs: 30000,
    body: { fileName: record.name, fileSize: record.size, mimeType: record.mimeType },
  });
  const chunkSize = Number(started.chunkSize || 8 * 1024 * 1024);
  const totalChunks = Number(started.totalChunks || Math.ceil(record.size / chunkSize));
  const file = await fs.promises.open(record.path, 'r');
  let loaded = 0;
  try {
    for (let index = 0; index < totalChunks; index += 1) {
      requireDesktopSession();
      const remaining = record.size - loaded;
      const length = Math.min(chunkSize, remaining);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(buffer, 0, length, loaded);
      if (bytesRead !== length) throw new Error('Не удалось прочитать очередную часть видео.');
      await requestBinary(`/admin/desktop/cinema/uploads/${encodeURIComponent(started.uploadId)}/chunks/${index}`, buffer, token);
      loaded += bytesRead;
      event.sender.send('admin:cinema-upload-progress', {
        fileId: String(fileId),
        name: record.name,
        loaded,
        total: record.size,
        percent: Math.min(100, Math.round((loaded / record.size) * 100)),
      });
    }
  } finally {
    await file.close();
  }
  const completed = await request(`/admin/desktop/cinema/uploads/${encodeURIComponent(started.uploadId)}/complete`, {
    method: 'POST', token, timeoutMs: 120000, body: {},
  });
  pickedCinemaFiles.delete(String(fileId));
  event.sender.send('admin:cinema-upload-progress', {
    fileId: String(fileId), name: record.name, loaded: record.size, total: record.size, percent: 100, complete: true,
  });
  return completed;
});

ipcMain.handle('admin:logout', () => {
  loginToken = '';
  desktopToken = '';
  desktopTokenExpiresAt = 0;
  pickedCinemaFiles.clear();
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
