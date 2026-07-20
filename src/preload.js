const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  pickVideo: () => ipcRenderer.invoke('pick-video'),
  processVideo: (filePath) => ipcRenderer.invoke('process-video', filePath),
  cancelProcess: () => ipcRenderer.invoke('cancel-process'),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file?.path || null;
    }
  },
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('process-progress', handler);
    return () => ipcRenderer.removeListener('process-progress', handler);
  },
});
