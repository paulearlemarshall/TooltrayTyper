# TooltrayTyper

TooltrayTyper is an Electron tray app that lets you quickly rewrite selected text using an LLM, then paste the improved result back in place.

## What it does

- Runs in the system tray
- Uses a global hotkey to:
  1. Copy selected text
  2. Send it to your configured LLM provider
  3. Paste the rewritten text back
- Supports multiple providers:
  - OpenAI
  - Anthropic
  - Google Gemini
- Lets you store per-provider API keys and model choices
- Lets you define 4 quick prompts and choose the active one

## Current status

This project currently targets **Windows** workflows (it uses `SendKeysHelper.exe` for copy/paste automation).

## Requirements

- Node.js 18+
- npm
- Windows (recommended/currently supported)

## Setup

```bash
npm install
npm start
```

## Build distributable

```bash
npm run dist
```

## Configure in app

1. Open **Settings** from the tray icon.
2. Choose your provider.
3. Enter your API key.
4. Refresh and select a model.
5. Set your hotkey (default: `Ctrl+Alt+L`).
6. Save settings.

## Security notes

- API keys are stored locally via `electron-store`.
- Treat your machine account as trusted.
- Do not commit secrets into source control.

## Project structure

- `main.js` – Electron main process, tray + global hotkey + provider API calls
- `renderer.js` – Settings UI behavior
- `preload.js` – Secure IPC bridge
- `SendKeysHelper.cs` / `SendKeysHelper.exe` – Windows key automation helper
- `index.html`, `styles.css` – UI

## Roadmap ideas

- Better hotkey rebinding without restart
- Improved provider/model validation UX
- Cross-platform clipboard/send-key support
- Tests and CI

## Contributing

PRs and issues are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

ISC — see [LICENSE](LICENSE).
