# Electron Windows Branch Setup

This branch (`feature/electron-windows`) adds a Windows-first Electron wrapper while keeping Expo workflows unchanged.

## What this branch adds

- Electron main process in `electron/main.js`
- Electron preload in `electron/preload.js`
- Desktop scripts in `package.json`
- Electron Builder config (Windows target)

## Development mode (Windows)

Runs backend + Expo web + Electron together:

```bash
npm install
npm run desktop:dev
```

## Build web bundle only

```bash
npm run desktop:web:build
```

Output folder: `dist-web/`

## Package Windows installer

```bash
npm run desktop:pack:win
```

Output folder: `electron-dist/`

## Notes

- This is **Windows-first** implementation as requested.
- Main branch can continue using Expo normally.
- Backend server is started by Electron process (fork of `server/server.js`).
- Configuration is still read from `OPEN_THIS/SETUP/setup_variable.json`.
- If production app fails to load UI bundle, run `npm run desktop:web:build` first.
