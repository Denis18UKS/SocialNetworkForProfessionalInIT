const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('socialBirdAdmin', Object.freeze({
  login: (credentials) => ipcRenderer.invoke('admin:login', credentials),
  requestCode: () => ipcRenderer.invoke('admin:request-code'),
  confirmCode: (payload) => ipcRenderer.invoke('admin:confirm-code', payload),
  getStats: () => ipcRenderer.invoke('admin:stats'),
  getUsers: (query) => ipcRenderer.invoke('admin:users', query),
  getAudit: () => ipcRenderer.invoke('admin:audit'),
  getPosts: () => ipcRenderer.invoke('admin:posts'),
  setPostStatus: (payload) => ipcRenderer.invoke('admin:set-post-status', payload),
  deletePost: (payload) => ipcRenderer.invoke('admin:delete-post', payload),
  setBlocked: (payload) => ipcRenderer.invoke('admin:block-user', payload),
  deleteUser: (payload) => ipcRenderer.invoke('admin:delete-user', payload),
  setRole: (payload) => ipcRenderer.invoke('admin:set-role', payload),

  getCinemaTitles: (filters) => ipcRenderer.invoke('admin:cinema-titles', filters),
  getCinemaTitle: (id) => ipcRenderer.invoke('admin:cinema-title', id),
  createCinemaTitle: (payload) => ipcRenderer.invoke('admin:cinema-create-title', payload),
  updateCinemaTitle: (payload) => ipcRenderer.invoke('admin:cinema-update-title', payload),
  deleteCinemaTitle: (id) => ipcRenderer.invoke('admin:cinema-delete-title', id),
  addCinemaEpisode: (payload) => ipcRenderer.invoke('admin:cinema-add-episode', payload),
  updateCinemaEpisode: (payload) => ipcRenderer.invoke('admin:cinema-update-episode', payload),
  deleteCinemaEpisode: (id) => ipcRenderer.invoke('admin:cinema-delete-episode', id),
  pickCinemaVideo: () => ipcRenderer.invoke('admin:cinema-pick-video'),
  uploadCinemaVideo: (fileId) => ipcRenderer.invoke('admin:cinema-upload-video', fileId),
  onCinemaUploadProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('admin:cinema-upload-progress', handler);
    return () => ipcRenderer.removeListener('admin:cinema-upload-progress', handler);
  },

  logout: () => ipcRenderer.invoke('admin:logout'),
  openSite: () => ipcRenderer.invoke('admin:open-site'),
}));
