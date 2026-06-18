const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('API', {
  // window
  close:    () => ipcRenderer.send('win-close'),
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),

  // fs
  openFolder:    ()           => ipcRenderer.invoke('open-folder'),
  readDir:       (p)          => ipcRenderer.invoke('read-dir', p),
  readFile:      (p)          => ipcRenderer.invoke('read-file', p),
  writeFile:     (p, c)       => ipcRenderer.invoke('write-file', p, c),
  createFile:    (dir, name)  => ipcRenderer.invoke('create-file', dir, name),
  createDir:     (dir, name)  => ipcRenderer.invoke('create-dir', dir, name),
  deleteEntry:   (p)          => ipcRenderer.invoke('delete-entry', p),
  renameEntry:   (p, name)    => ipcRenderer.invoke('rename-entry', p, name),
  showExplorer:  (p)          => ipcRenderer.invoke('show-in-explorer', p),

  // ai
  detectProvider: (key)  => ipcRenderer.invoke('detect-provider', key),
  listModels:     (data) => ipcRenderer.invoke('list-models', data),
  aiSend:         (data) => ipcRenderer.invoke('ai-send', data),
  aiStream:       (data) => ipcRenderer.invoke('ai-stream', data),
  aiRunCheck:     (data) => ipcRenderer.invoke('ai-run-check', data),
  onStreamChunk:  (cb)   => ipcRenderer.on('stream-chunk', (_, t) => cb(t)),
  onStreamDone:   (cb)   => ipcRenderer.on('stream-done',  (_, e) => cb(e)),
  offStream:      ()     => { ipcRenderer.removeAllListeners('stream-chunk'); ipcRenderer.removeAllListeners('stream-done') },
  getAssetPath:   (file) => require('path').join(__dirname, 'assets', file),

  // crypto + history
  encrypt:      (data) => ipcRenderer.invoke('crypto-encrypt', data),
  decrypt:      (data) => ipcRenderer.invoke('crypto-decrypt', data),
  historySave:  (enc)            => ipcRenderer.invoke('history-save', enc),
  historyLoad:  ()               => ipcRenderer.invoke('history-load'),

  // external links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
})