const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, clipboard } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { exec } = require('child_process');

let store;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 900,
    show: false, // Don't show initially, run in background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (event) => {
    // Hide window instead of closing it when the user clicks 'x' to keep it running in tray
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
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
    // In case we don't have an icon, create a small blank one to prevent crashes
    trayIcon = nativeImage.createEmpty();
    trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => { mainWindow.show(); } },
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

  tray.on('click', () => {
    mainWindow.show();
  });
}

async function processTextWithLLM(text) {
  const provider = store.get('provider', 'openai');
  const apiKeys = store.get('apiKeys', {});
  const legacyApiKey = store.get('apiKey', '');

  // Backward compatibility migration on-the-fly
  const apiKey = apiKeys[provider] || legacyApiKey || '';

  // Default structure for multiple prompts
  const defaultPrompts = [
    "tidy this text",
    "fix spelling and grammar",
    "summarize this",
    "translate to english"
  ];
  const prompts = store.get('prompts', defaultPrompts);
  const activePromptIndex = store.get('activePromptIndex', 0);
  const prompt = prompts[activePromptIndex] || "tidy this text";

  const selectedModels = store.get('selectedModels', {});
  const legacyModel = store.get('model', '');
  const model = selectedModels[provider] || legacyModel || '';

  if (!apiKey) {
    return 'Error: API Key not set. Please configure in Settings.';
  }

  // Basic fetch to the LLM
  try {
    const hiddenInstruction = "You are an expert in tidying text. The text provided is copied from a user's source, and your response will be pasted over the user's source. Do not explain that you have fixed the text, or otherwise provide a narrative. The text you fix must be a drop-in replacement for the existing text. The user may provide other tidying instructions.";
    const SystemPrompt = `${hiddenInstruction}\n\nUSER SPECIFIC INSTRUCTIONS:\n${prompt}`;
    const UserPrompt = text;

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
            { role: 'system', content: SystemPrompt },
            { role: 'user', content: UserPrompt }
          ]
        })
      });
      const data = await response.json();
      if (data.error) return `Error: ${data.error.message}`;
      return data.choices[0].message.content;
    } else if (provider === 'anthropic') {
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
          system: SystemPrompt,
          messages: [
            { role: 'user', content: UserPrompt }
          ]
        })
      });
      const data = await response.json();
      if (data.error) return `Error: ${data.error.message}`;
      return data.content[0].text;
    } else if (provider === 'gemini') {
      const selectedModel = model || 'gemini-1.5-flash';
      // Gemini expects the model in the URL path, remove prefixes if passed from dropdown
      const cleanModel = selectedModel.replace('models/', '');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SystemPrompt }]
          },
          contents: [
            { parts: [{ text: UserPrompt }] }
          ]
        })
      });
      const data = await response.json();
      if (data.error) return `Error: ${data.error.message}`;
      if (data.candidates && data.candidates.length > 0) {
        return data.candidates[0].content.parts[0].text;
      }
      return `Error: Unexpected Gemini Response`;
    } else {
      return `Error: Provider ${provider} not recognized.`;
    }
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

function sendCtrlCAndGetText() {
  return new Promise((resolve) => {
    // Save current clipboard
    const previousClipboard = clipboard.readText();
    clipboard.clear();

    const helperExe = path.join(__dirname, 'SendKeysHelper.exe');
    exec(`"${helperExe}" copy`, (err) => {
      setTimeout(() => {
        const selectedText = clipboard.readText();
        resolve({ text: selectedText, previousClipboard });
      }, 150); // give clipboard a moment
    });
  });
}

function sendCtrlVPaste(text) {
  return new Promise((resolve) => {
    clipboard.writeText(text);

    const helperExe = path.join(__dirname, 'SendKeysHelper.exe');
    exec(`"${helperExe}" paste`, (err) => {
      setTimeout(() => {
        resolve();
      }, 150); // give paste a moment before returning
    });
  });
}

app.whenReady().then(async () => {
  const StoreModule = (await import('electron-store')).default;
  store = new StoreModule();

  createWindow();
  createTray();

  // Register Global Hotkey
  const hotkey = store.get('hotkey', 'CommandOrControl+Alt+L');
  globalShortcut.register(hotkey, async () => {
    console.log(`${hotkey} pressed, initiating LLM magic...`);

    // 1. Copy text
    const { text, previousClipboard } = await sendCtrlCAndGetText();

    if (!text || text.trim() === '') {
      console.log('No text selected.');
      clipboard.writeText(previousClipboard);
      return;
    }

    // 2. Process with LLM
    const newText = await processTextWithLLM(text);

    // 3. Paste Text
    await sendCtrlVPaste(newText);

    // 4. Restore original clipboard (optional, sometimes annoying if done too fast)
    // setTimeout(() => clipboard.writeText(previousClipboard), 500); 
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts.
  globalShortcut.unregisterAll();
});

// IPC Communication
ipcMain.handle('get-settings', () => {
  return store.store;
});

ipcMain.handle('save-settings', (event, settings) => {
  store.set(settings);
  // Optional: dynamically reregister hotkey if it changed
  globalShortcut.unregisterAll();
  try {
    globalShortcut.register(settings.hotkey || 'CommandOrControl+Alt+L', async () => {
      // Reduplicating logic here is messy so we rely on app restart, but we can do a quick re-bind
      // For actual production scale, the hotkey func would be abstracted.
    });
  } catch (e) { }

  // Actually we need to restart the app to properly bind the new hotkey. We will enforce that via reload or UI notification.
  // For now just saving.
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
      // Filter for standard chat models to keep it clean, or just return all IDs
      const chatModels = data.data.filter(m => m.id.includes('gpt')).map(m => m.id).sort();
      return { models: chatModels };

    } else if (provider === 'anthropic') {
      // Anthropic API v1/models endpoint is in beta as of late 2024, let's hit it or fallback to constants
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        }
      });

      const data = await response.json();
      if (data.error) {
        // Fallback hardcoded list if the models endpoint isn't fully enabled for their tier
        return { models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307', 'claude-3-5-sonnet-20240620', 'claude-3-5-sonnet-20241022'] };
      }
      return { models: data.data.map(m => m.id) };

    } else if (provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data = await response.json();
      if (data.error) return { error: data.error.message };

      // Filter for models that support generateContent
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
