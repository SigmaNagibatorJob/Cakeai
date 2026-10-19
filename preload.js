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
  aiStop:         ()     => ipcRenderer.invoke('ai-stop'),
  aiRunCheck:     (data) => ipcRenderer.invoke('ai-run-check', data),

  // MCP
  mcpLoadConfig: ()       => ipcRenderer.invoke('mcp-config-load'),
  mcpSaveConfig: (config) => ipcRenderer.invoke('mcp-config-save', config),
  mcpTest:       (data)   => ipcRenderer.invoke('mcp-test', data),
  mcpDisconnect: ()       => ipcRenderer.invoke('mcp-disconnect'),

  onStreamChunk:     (cb) => ipcRenderer.on('stream-chunk',     (_, t) => cb(t)),
  onStreamReasoning: (cb) => ipcRenderer.on('stream-reasoning', (_, t) => cb(t)),
  onStreamDone:      (cb) => ipcRenderer.on('stream-done',      (_, e) => cb(e)),
  onSearchSources:   (cb) => ipcRenderer.on('search-sources',   (_, s) => cb(s)),
  onMcpTool:         (cb) => ipcRenderer.on('mcp-tool-status',  (_, s) => cb(s)),
  offStream: () => {
    ['stream-chunk', 'stream-reasoning', 'stream-done', 'search-sources', 'mcp-tool-status']
      .forEach(ch => ipcRenderer.removeAllListeners(ch))
  },
  getAssetPath: (file) => require('path').join(__dirname, 'assets', file),

  // terminal
  terminalRun: (data) => ipcRenderer.invoke('terminal-run', data),

  // crypto + history
  encrypt:      (data) => ipcRenderer.invoke('crypto-encrypt', data),
  decrypt:      (data) => ipcRenderer.invoke('crypto-decrypt', data),
  historySave:  (enc)  => ipcRenderer.invoke('history-save', enc),
  historyLoad:  ()     => ipcRenderer.invoke('history-load'),

  // external links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
})
