const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  pickVideo: () => ipcRenderer.invoke('pick-video'),
  processVideo: (filePath, options) => ipcRenderer.invoke('process-video', filePath, options),
  cancelProcess: () => ipcRenderer.invoke('cancel-process'),
  estimateSize: (filePath, options, requestId) => ipcRenderer.invoke('estimate-size', filePath, options, requestId),
  cancelEstimate: () => ipcRenderer.invoke('cancel-estimate'),
  onEstimateProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('estimate-progress', handler);
    return () => ipcRenderer.removeListener('estimate-progress', handler);
  },
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
