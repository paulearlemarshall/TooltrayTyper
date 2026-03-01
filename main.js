const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, clipboard, Notification } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const { autoUpdater } = require('electron-updater');

let store;
let tray;
let mainWindow;
let logWindow;

const DEFAULT_PROMPTS = [
  'tidy this text',
  'fix spelling and grammar',
  'summarize this',
  'translate to english'
];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640,
    height: 980,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.show();
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 980,
    height: 760,
    title: 'Clipboard Log & Telemetry',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  logWindow.loadFile('clipboard-log.html');
  logWindow.on('closed', () => {
    logWindow = null;
  });
}

function createTray() {
  const fs = require('fs');
  const { nativeImage } = require('electron');
  const iconPath = path.join(__dirname, 'icon.png');
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    trayIcon = nativeImage.createEmpty();
    trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => mainWindow.show() },
    { label: 'Clipboard Log & Stats', click: () => createLogWindow() },
    { type: 'separator' },
    {
      label: 'Quit', click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Tooltray LLM Typer');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

function getSettingsSnapshot() {
  return store.store;
}

function getActionLogs() {
  return store.get('actionLogs', []);
}

function getUsageStats() {
  return store.get('usageStats', {
    totalActions: 0,
    successCount: 0,
    errorCount: 0,
    noSelectionCount: 0,
    totalDurationMs: 0,
    totalInputChars: 0,
    totalOutputChars: 0,
    providerBreakdown: {},
    modelBreakdown: {},
    lastRunAt: null
  });
}

function addActionLog(entry) {
  const logs = getActionLogs();
  logs.unshift(entry);
  store.set('actionLogs', logs.slice(0, 300));
}

function incrementBreakdown(container, key, payload) {
  if (!container[key]) {
    container[key] = {
      count: 0,
      successCount: 0,
      errorCount: 0,
      noSelectionCount: 0,
      totalDurationMs: 0,
      totalInputChars: 0,
      totalOutputChars: 0
    };
  }

  const row = container[key];
  row.count += 1;
  row.totalDurationMs += payload.durationMs || 0;
  row.totalInputChars += payload.inputChars || 0;
  row.totalOutputChars += payload.outputChars || 0;

  if (payload.status === 'success') row.successCount += 1;
  if (payload.status === 'error') row.errorCount += 1;
  if (payload.status === 'no_selection') row.noSelectionCount += 1;
}

function recordUsage(payload) {
  const stats = getUsageStats();

  stats.totalActions += 1;
  stats.totalDurationMs += payload.durationMs || 0;
  stats.totalInputChars += payload.inputChars || 0;
  stats.totalOutputChars += payload.outputChars || 0;
  stats.lastRunAt = new Date().toISOString();

  if (payload.status === 'success') stats.successCount += 1;
  if (payload.status === 'error') stats.errorCount += 1;
  if (payload.status === 'no_selection') stats.noSelectionCount += 1;

  const provider = payload.provider || 'unknown';
  const model = payload.model || 'unknown';
  incrementBreakdown(stats.providerBreakdown, provider, payload);
  incrementBreakdown(stats.modelBreakdown, `${provider}:${model}`, payload);

  store.set('usageStats', stats);
}

function notifyUser(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (err) {
    console.log('Notification error:', err.message);
  }
}

function getProviderAndModel() {
  const provider = store.get('provider', 'openai');
  const selectedModels = store.get('selectedModels', {});
  const legacyModel = store.get('model', '');
  const model = selectedModels[provider] || legacyModel || '';
  return { provider, model };
}

async function processTextWithLLM(text) {
  const provider = store.get('provider', 'openai');
  const apiKeys = store.get('apiKeys', {});
  const legacyApiKey = store.get('apiKey', '');
  const apiKey = apiKeys[provider] || legacyApiKey || '';

  const prompts = store.get('prompts', DEFAULT_PROMPTS);
  const activePromptIndex = store.get('activePromptIndex', 0);
  const prompt = prompts[activePromptIndex] || DEFAULT_PROMPTS[0];

  const selectedModels = store.get('selectedModels', {});
  const legacyModel = store.get('model', '');
  const model = selectedModels[provider] || legacyModel || '';

  if (!apiKey) {
    return { ok: false, error: 'API Key not set. Please configure in Settings.', provider, model, prompt };
  }

  const hiddenInstruction = 'You are an expert in tidying text. The text provided is copied from a user\'s source, and your response will be pasted over the user\'s source. Do not explain that you have fixed the text, or otherwise provide a narrative. The text you fix must be a drop-in replacement for the existing text. The user may provide other tidying instructions.';
  const systemPrompt = `${hiddenInstruction}\n\nUSER SPECIFIC INSTRUCTIONS:\n${prompt}`;

  try {
    if (provider === 'openai') {
      const selectedModel = model || 'gpt-4o-mini';
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ]
        })
      });
      const data = await response.json();
      if (data.error) return { ok: false, error: data.error.message, provider, model: selectedModel, prompt };
      return { ok: true, text: data.choices?.[0]?.message?.content || '', provider, model: selectedModel, prompt };
    }

    if (provider === 'anthropic') {
      const selectedModel = model || 'claude-3-haiku-20240307';
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: text }]
        })
      });
      const data = await response.json();
      if (data.error) return { ok: false, error: data.error.message, provider, model: selectedModel, prompt };
      return { ok: true, text: data.content?.[0]?.text || '', provider, model: selectedModel, prompt };
    }

    if (provider === 'gemini') {
      const selectedModel = model || 'gemini-1.5-flash';
      const cleanModel = selectedModel.replace('models/', '');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text }] }]
        })
      });
      const data = await response.json();
      if (data.error) return { ok: false, error: data.error.message, provider, model: cleanModel, prompt };
      const output = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!output) return { ok: false, error: 'Unexpected Gemini response.', provider, model: cleanModel, prompt };
      return { ok: true, text: output, provider, model: cleanModel, prompt };
    }

    return { ok: false, error: `Provider ${provider} not recognized.`, provider, model, prompt };
  } catch (error) {
    return { ok: false, error: error.message, provider, model, prompt };
  }
}

function runSendKeys(action) {
  return new Promise((resolve, reject) => {
    const helperExe = path.join(__dirname, 'SendKeysHelper.exe');
    exec(`"${helperExe}" ${action}`, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSelectedTextViaClipboard() {
  const previousClipboard = clipboard.readText();
  clipboard.clear();
  await runSendKeys('copy');
  await sleep(170);
  const selectedText = clipboard.readText();
  return { previousClipboard, selectedText };
}

async function pasteText(text) {
  clipboard.writeText(text || '');
  await runSendKeys('paste');
  await sleep(170);
}

async function handleHotkeyAction() {
  const actionId = `act_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  const clipboardSafeMode = store.get('clipboardSafeMode', true);

  let previousClipboard = '';
  let selectedText = '';
  let outputText = '';
  let provider = 'unknown';
  let model = 'unknown';
  let prompt = '';

  let copyMs = 0;
  let llmMs = 0;
  let pasteMs = 0;

  try {
    const copyStart = Date.now();
    const copied = await getSelectedTextViaClipboard();
    copyMs = Date.now() - copyStart;

    previousClipboard = copied.previousClipboard;
    selectedText = copied.selectedText;

    if (!selectedText || !selectedText.trim()) {
      if (clipboardSafeMode) clipboard.writeText(previousClipboard);

      const totalMs = Date.now() - startedAt;
      const { provider: p, model: m } = getProviderAndModel();
      provider = p;
      model = m || 'unknown';

      const record = {
        id: actionId,
        timestamp: startedIso,
        status: 'no_selection',
        provider,
        model,
        prompt,
        inputText: '',
        outputText: '',
        error: 'No text selected.',
        clipboardSafeMode,
        durations: { copyMs, llmMs: 0, pasteMs: 0, totalMs }
      };

      addActionLog(record);
      recordUsage({
        status: 'no_selection',
        provider,
        model,
        inputChars: 0,
        outputChars: 0,
        durationMs: totalMs
      });

      notifyUser('TooltrayTyper', 'No text selected to process.');
      return;
    }

    const llmStart = Date.now();
    const llmResult = await processTextWithLLM(selectedText);
    llmMs = Date.now() - llmStart;

    provider = llmResult.provider || provider;
    model = llmResult.model || model;
    prompt = llmResult.prompt || '';

    if (!llmResult.ok) {
      if (clipboardSafeMode) clipboard.writeText(previousClipboard);

      const totalMs = Date.now() - startedAt;
      const record = {
        id: actionId,
        timestamp: startedIso,
        status: 'error',
        provider,
        model,
        prompt,
        inputText: selectedText,
        outputText: '',
        error: llmResult.error || 'Unknown error',
        clipboardSafeMode,
        durations: { copyMs, llmMs, pasteMs: 0, totalMs }
      };

      addActionLog(record);
      recordUsage({
        status: 'error',
        provider,
        model,
        inputChars: selectedText.length,
        outputChars: 0,
        durationMs: totalMs
      });

      notifyUser('TooltrayTyper error', llmResult.error || 'Failed to process text.');
      return;
    }

    outputText = llmResult.text || '';

    const pasteStart = Date.now();
    await pasteText(outputText);
    pasteMs = Date.now() - pasteStart;

    if (clipboardSafeMode) clipboard.writeText(previousClipboard);

    const totalMs = Date.now() - startedAt;
    const record = {
      id: actionId,
      timestamp: startedIso,
      status: 'success',
      provider,
      model,
      prompt,
      inputText: selectedText,
      outputText,
      error: null,
      clipboardSafeMode,
      durations: { copyMs, llmMs, pasteMs, totalMs }
    };

    addActionLog(record);
    recordUsage({
      status: 'success',
      provider,
      model,
      inputChars: selectedText.length,
      outputChars: outputText.length,
      durationMs: totalMs
    });

    console.log(`[${actionId}] success provider=${provider} model=${model} total=${totalMs}ms in=${selectedText.length} out=${outputText.length}`);
    notifyUser('TooltrayTyper', `Updated text via ${provider} (${model}) in ${totalMs}ms.`);
  } catch (error) {
    if (clipboardSafeMode && previousClipboard) clipboard.writeText(previousClipboard);

    const totalMs = Date.now() - startedAt;
    const { provider: p, model: m } = getProviderAndModel();
    provider = provider || p;
    model = model || m || 'unknown';

    const record = {
      id: actionId,
      timestamp: startedIso,
      status: 'error',
      provider,
      model,
      prompt,
      inputText: selectedText || '',
      outputText: outputText || '',
      error: error.message,
      clipboardSafeMode,
      durations: { copyMs, llmMs, pasteMs, totalMs }
    };

    addActionLog(record);
    recordUsage({
      status: 'error',
      provider,
      model,
      inputChars: (selectedText || '').length,
      outputChars: (outputText || '').length,
      durationMs: totalMs
    });

    console.error(`[${actionId}] fatal error`, error);
    notifyUser('TooltrayTyper fatal error', error.message);
  }
}

function registerGlobalHotkey() {
  globalShortcut.unregisterAll();
  const hotkey = store.get('hotkey', 'CommandOrControl+Alt+L');
  const ok = globalShortcut.register(hotkey, async () => {
    console.log(`${hotkey} pressed, processing selection...`);
    await handleHotkeyAction();
  });

  if (!ok) {
    console.error(`Failed to register hotkey: ${hotkey}`);
    notifyUser('TooltrayTyper', `Failed to register hotkey: ${hotkey}`);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('AutoUpdater: checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('AutoUpdater: update available', info?.version);
    notifyUser('TooltrayTyper update', `Update ${info?.version || ''} is downloading.`.trim());
  });

  autoUpdater.on('update-not-available', () => {
    console.log('AutoUpdater: no update available');
  });

  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err?.message);
  });

  autoUpdater.on('update-downloaded', () => {
    notifyUser('Update ready', 'TooltrayTyper update downloaded. It will install when app restarts.');
  });

  setTimeout(() => autoUpdater.checkForUpdates().catch(() => { }), 15_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => { }), 6 * 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  const StoreModule = (await import('electron-store')).default;
  store = new StoreModule();

  if (typeof store.get('clipboardSafeMode') !== 'boolean') {
    store.set('clipboardSafeMode', true);
  }

  createWindow();
  createTray();
  registerGlobalHotkey();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('get-settings', () => getSettingsSnapshot());

ipcMain.handle('save-settings', (event, settings) => {
  store.set(settings);
  registerGlobalHotkey();
  return { success: true };
});

ipcMain.handle('fetch-models', async (event, provider, apiKey) => {
  if (!apiKey) return { error: 'API Key missing' };

  try {
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await response.json();
      if (data.error) return { error: data.error.message };
      const chatModels = data.data.filter(m => m.id.includes('gpt')).map(m => m.id).sort();
      return { models: chatModels };
    }

    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      });

      const data = await response.json();
      if (data.error) {
        return {
          models: [
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
            'claude-3-5-sonnet-20240620',
            'claude-3-5-sonnet-20241022'
          ]
        };
      }
      return { models: data.data.map(m => m.id) };
    }

    if (provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data = await response.json();
      if (data.error) return { error: data.error.message };

      const validModels = data.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent') && !m.name.includes('vision'))
        .map(m => m.name.replace('models/', ''));

      return { models: validModels };
    }
  } catch (error) {
    return { error: error.message };
  }

  return { error: 'Unknown provider' };
});

ipcMain.handle('open-clipboard-log', () => {
  createLogWindow();
  return { success: true };
});

ipcMain.handle('get-action-logs', () => getActionLogs());

ipcMain.handle('delete-action-log', (event, id) => {
  const logs = getActionLogs().filter(l => l.id !== id);
  store.set('actionLogs', logs);
  return { success: true };
});

ipcMain.handle('clear-action-logs', () => {
  store.set('actionLogs', []);
  return { success: true };
});

ipcMain.handle('recopy-action-output', (event, id) => {
  const logs = getActionLogs();
  const row = logs.find(l => l.id === id);
  if (!row || !row.outputText) return { success: false, error: 'No output text found for this record.' };
  clipboard.writeText(row.outputText);
  return { success: true };
});

ipcMain.handle('get-usage-stats', () => getUsageStats());

ipcMain.handle('clear-usage-stats', () => {
  store.set('usageStats', {
    totalActions: 0,
    successCount: 0,
    errorCount: 0,
    noSelectionCount: 0,
    totalDurationMs: 0,
    totalInputChars: 0,
    totalOutputChars: 0,
    providerBreakdown: {},
    modelBreakdown: {},
    lastRunAt: null
  });
  return { success: true };
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { success: false, message: 'Auto-update works in packaged builds only.' };
  }

  try {
    await autoUpdater.checkForUpdates();
    return { success: true, message: 'Checking for updates...' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});
