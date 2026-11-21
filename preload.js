const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arshfa", {
  chooseFolder: () => ipcRenderer.invoke("dialog:choose-folder"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  startWatching: (folder) => ipcRenderer.invoke("watch:start", folder),
  stopWatching: () => ipcRenderer.invoke("watch:stop"),
  enqueueFile: (payload) => ipcRenderer.invoke("scanner:enqueue", payload),
  approveDocument: (payload) => ipcRenderer.invoke("document:approve", payload),
  saveImportedFile: (payload) => ipcRenderer.invoke("document:save-imported", payload),
  onFileDetected: (callback) => ipcRenderer.on("scanner:file-detected", (_event, data) => callback(data)),
  onWatchStatus: (callback) => ipcRenderer.on("scanner:watch-status", (_event, data) => callback(data)),
  onProcessingUpdate: (callback) => ipcRenderer.on("scanner:processing-update", (_event, data) => callback(data)),
  onQueueError: (callback) => ipcRenderer.on("scanner:error", (_event, data) => callback(data))
});
