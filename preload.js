const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    fetchModels: (provider, apiKey) => ipcRenderer.invoke('fetch-models', provider, apiKey),

    openClipboardLog: () => ipcRenderer.invoke('open-clipboard-log'),
    getActionLogs: () => ipcRenderer.invoke('get-action-logs'),
    deleteActionLog: (id) => ipcRenderer.invoke('delete-action-log', id),
    clearActionLogs: () => ipcRenderer.invoke('clear-action-logs'),
    recopyActionOutput: (id) => ipcRenderer.invoke('recopy-action-output', id),

    getUsageStats: () => ipcRenderer.invoke('get-usage-stats'),
    clearUsageStats: () => ipcRenderer.invoke('clear-usage-stats'),

    checkForUpdates: () => ipcRenderer.invoke('check-for-updates')
});
