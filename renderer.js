document.addEventListener('DOMContentLoaded', async () => {
    const settings = await window.electronAPI.getSettings();

    const providerSelect = document.getElementById('provider');
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('model');
    const refreshModelsBtn = document.getElementById('refreshModelsBtn');
    const apiKeyVerified = document.getElementById('apiKeyVerified');

    const hotkeyInput = document.getElementById('hotkey');
    const clipboardSafeModeInput = document.getElementById('clipboardSafeMode');

    const saveBtn = document.getElementById('saveBtn');
    const toggleVisibilityBtn = document.getElementById('toggleVisibility');
    const openClipboardLogBtn = document.getElementById('openClipboardLogBtn');
    const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
    const updateStatus = document.getElementById('updateStatus');

    const btnText = saveBtn.querySelector('span');
    const spinner = saveBtn.querySelector('.spinner');
    const checkIcon = saveBtn.querySelector('.check');
    const refreshIcon = refreshModelsBtn.querySelector('.refresh-icon');

    if (settings.provider) providerSelect.value = settings.provider;

    const apiKeys = settings.apiKeys || {};
    if (settings.apiKey && Object.keys(apiKeys).length === 0) {
        apiKeys[settings.provider || 'openai'] = settings.apiKey;
    }

    const selectedModels = settings.selectedModels || {};
    if (settings.model && Object.keys(selectedModels).length === 0) {
        selectedModels[settings.provider || 'openai'] = settings.model;
    }

    function setApiKeyValidated(valid) {
        apiKeyVerified.checked = !!valid;
    }

    function updateApiKeyInput() {
        apiKeyInput.value = apiKeys[providerSelect.value] || '';
        setApiKeyValidated(false);
    }

    updateApiKeyInput();

    if (settings.hotkey) hotkeyInput.value = settings.hotkey;
    clipboardSafeModeInput.checked = typeof settings.clipboardSafeMode === 'boolean' ? settings.clipboardSafeMode : true;

    const defaultPrompts = [
        'tidy this text',
        'fix spelling and grammar',
        'summarize this',
        'translate to english'
    ];

    const prompts = settings.prompts || defaultPrompts;
    for (let i = 0; i < 4; i++) {
        document.getElementById(`prompt${i}`).value = prompts[i] || '';
    }

    const activeIndex = settings.activePromptIndex || 0;
    const activeRadio = document.querySelector(`input[name="activePrompt"][value="${activeIndex}"]`);
    if (activeRadio) activeRadio.checked = true;

    const initialKey = apiKeys[providerSelect.value];
    if (initialKey) {
        await loadModels(providerSelect.value, initialKey, selectedModels[providerSelect.value]);
    }

    async function loadModels(provider, apiKey, selectedModel = null) {
        refreshIcon.classList.add('spinning');
        refreshModelsBtn.disabled = true;
        modelSelect.innerHTML = '<option value="">Loading models...</option>';
        setApiKeyValidated(false);

        try {
            const result = await window.electronAPI.fetchModels(provider, apiKey);
            modelSelect.innerHTML = '';

            if (result.error) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = `Error: ${result.error}`;
                modelSelect.appendChild(opt);
                setApiKeyValidated(false);
            } else if (result.models && result.models.length > 0) {
                result.models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    if (m === selectedModel) opt.selected = true;
                    modelSelect.appendChild(opt);
                });
                setApiKeyValidated(true);
            } else {
                modelSelect.innerHTML = '<option value="">No models found</option>';
                setApiKeyValidated(false);
            }
        } catch (err) {
            modelSelect.innerHTML = '<option value="">Failed to fetch models</option>';
            setApiKeyValidated(false);
        } finally {
            refreshIcon.classList.remove('spinning');
            refreshModelsBtn.disabled = false;
        }
    }

    refreshModelsBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            loadModels(providerSelect.value, apiKey, modelSelect.value);
        } else {
            setApiKeyValidated(false);
        }
    });

    modelSelect.addEventListener('change', () => {
        if (modelSelect.value) {
            selectedModels[providerSelect.value] = modelSelect.value;
        }
    });

    providerSelect.addEventListener('change', () => {
        updateApiKeyInput();
        const apiKey = apiKeyInput.value.trim();
        const savedModel = selectedModels[providerSelect.value];

        if (apiKey) {
            loadModels(providerSelect.value, apiKey, savedModel);
        } else {
            modelSelect.innerHTML = '<option value="">Enter API key and refresh models</option>';
        }
    });

    apiKeyInput.addEventListener('input', () => {
        apiKeys[providerSelect.value] = apiKeyInput.value.trim();
        setApiKeyValidated(false);
    });

    apiKeyInput.addEventListener('blur', () => {
        const apiKey = apiKeyInput.value.trim();
        const savedModel = selectedModels[providerSelect.value];
        if (apiKey && modelSelect.options.length <= 1) {
            loadModels(providerSelect.value, apiKey, savedModel);
        }
    });

    toggleVisibilityBtn.addEventListener('click', () => {
        const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
        apiKeyInput.setAttribute('type', type);
        if (type === 'password') {
            toggleVisibilityBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        } else {
            toggleVisibilityBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        }
    });

    openClipboardLogBtn.addEventListener('click', async () => {
        await window.electronAPI.openClipboardLog();
    });

    checkUpdatesBtn.addEventListener('click', async () => {
        updateStatus.textContent = 'Checking for updates...';
        const result = await window.electronAPI.checkForUpdates();
        updateStatus.textContent = result.message || (result.success ? 'Update check requested.' : 'Update check failed.');
    });

    saveBtn.addEventListener('click', async () => {
        const activeRadio = document.querySelector('input[name="activePrompt"]:checked');

        apiKeys[providerSelect.value] = apiKeyInput.value.trim();
        if (modelSelect.value) {
            selectedModels[providerSelect.value] = modelSelect.value;
        }

        const newSettings = {
            provider: providerSelect.value,
            apiKeys,
            selectedModels,
            prompts: [
                document.getElementById('prompt0').value,
                document.getElementById('prompt1').value,
                document.getElementById('prompt2').value,
                document.getElementById('prompt3').value
            ],
            activePromptIndex: activeRadio ? parseInt(activeRadio.value, 10) : 0,
            hotkey: hotkeyInput.value,
            clipboardSafeMode: clipboardSafeModeInput.checked
        };

        btnText.textContent = 'Saving...';
        spinner.classList.remove('hidden');
        saveBtn.disabled = true;

        await window.electronAPI.saveSettings(newSettings);

        spinner.classList.add('hidden');
        checkIcon.classList.remove('hidden');
        btnText.textContent = 'Saved!';
        saveBtn.style.background = 'var(--success)';

        setTimeout(() => {
            checkIcon.classList.add('hidden');
            btnText.textContent = 'Save Settings';
            saveBtn.style.background = 'var(--accent-gradient)';
            saveBtn.disabled = false;
        }, 1800);
    });
});
