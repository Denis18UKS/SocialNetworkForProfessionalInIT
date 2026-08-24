const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('socialBirdAdmin', Object.freeze({
  login: (credentials) => ipcRenderer.invoke('admin:login', credentials),
  requestCode: () => ipcRenderer.invoke('admin:request-code'),
  confirmCode: (payload) => ipcRenderer.invoke('admin:confirm-code', payload),
  getStats: () => ipcRenderer.invoke('admin:stats'),
  getUsers: (query) => ipcRenderer.invoke('admin:users', query),
  getAudit: () => ipcRenderer.invoke('admin:audit'),
  setBlocked: (payload) => ipcRenderer.invoke('admin:block-user', payload),
  setRole: (payload) => ipcRenderer.invoke('admin:set-role', payload),
  logout: () => ipcRenderer.invoke('admin:logout'),
  openSite: () => ipcRenderer.invoke('admin:open-site'),
}));
