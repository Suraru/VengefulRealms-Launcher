# VengefulRealms Launcher

Electron-based launcher for the **Vengeful Realms** SkyMP server. Handles SkyMP payload installation, Skyrim detection, player profile setup, and game launch — all from a single installer.

## What It Does

- Auto-detects your Skyrim SE installation (registry + common Steam paths)
- Installs the SkyMP client payload (DLLs, scripts, SKSE plugins) into your Skyrim folder
- Writes `skymp5-client-settings.txt` with the correct server IP and profile ID
- Launches Skyrim via `skse64_loader.exe`
- Tracks every installed file in a manifest so uninstall cleanly removes only what the launcher placed
- Stores "Keep me signed in" credentials using OS-level encryption (DPAPI on Windows)

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **npm** (included with Node.js)
- **Windows 10/11** (the Squirrel installer target is Windows-only; the Electron app itself is cross-platform)

> Electron Forge is installed locally via `npm install` — no global install needed.

## Setup

```bash
git clone https://github.com/<your-org>/VengefulRealms-Launcher.git
cd VengefulRealms-Launcher
npm install
```

### skymp-payload (required for build)

The `skymp-payload/` directory contains the binary game files (MpClientPlugin.dll, SkyrimPlatform.dll, skymp5-client.js, SKSE plugins, UI assets, etc.) that the launcher copies into the player's Skyrim folder. It is **not tracked in this repo** due to size and binary content.

To obtain it:
1. Build from source: [eruvos-skymp-livekit](https://github.com/Eruvos/eruvos-skymp-livekit) — build output lands in `build/dist/client/`
2. **Or** download the latest release payload from the VGR file server (ask a team member for the URL)

Place the contents so the tree looks like:

```
VengefulRealms-Launcher/
  skymp-payload/
    Data/
      SKSE/Plugins/MpClientPlugin.dll
      SKSE/Plugins/SkyrimPlatform.dll
      Platform/Plugins/skymp5-client.js
      ...
    livekit.dll
    livekit_ffi.dll
```

## Running in Development

```bash
npm start
```

Opens the launcher window with DevTools accessible (Ctrl+Shift+I). Changes to `index.html`, `style.css`, and `script.js` take effect on reload. Changes to `main.js` or `preload.js` require restarting.

## Building the Installer

```bash
npm run make
```

Produces a Windows Squirrel installer in `out/make/squirrel.windows/x64/`:

```
VengefulRealms-Launcher-Setup.exe   ← single-file installer for players
```

The installer uses [Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows), which gives players a silent install with auto-update support and a proper Add/Remove Programs entry. The `skymp-payload/` directory is unpacked outside the ASAR so it remains accessible to the file-copy logic at runtime.

## Project Structure

```
VengefulRealms-Launcher/
  main.js          — Electron main process: IPC handlers, install/uninstall, game launch
  preload.js       — Context bridge: exposes IPC channels to the renderer
  index.html       — Launcher UI shell
  style.css        — Skyrim-themed styling (dark/gold/red palette)
  script.js        — Renderer-side logic: sections, login flow, progress, settings
  fileoperations.js — Shared file utility helpers
  forge.config.js  — Electron Forge packager + Squirrel maker config
  assets/
    icon.ico       — App icon (used by installer and taskbar)
    icons/         — SVG icons used in the UI
    video/         — Ambient background video
  skymp-payload/   — (not in git) Binary game files copied into Skyrim on install
```

## Key IPC Channels

| Channel | Direction | Description |
|---|---|---|
| `find-skyrim` | renderer → main | Auto-detect Skyrim install path |
| `browse-folder` | renderer → main | Open folder picker dialog |
| `check-prerequisites` | renderer → main | Verify Skyrim, SKSE, SkyMP are present |
| `install-skymp` | renderer → main | Copy payload into Skyrim folder |
| `uninstall-skymp` | renderer → main | Remove only launcher-installed files |
| `update-client-cfg` | renderer → main | Write `skymp5-client-settings.txt` |
| `launch-game` | renderer → main | Sync payload + launch `skse64_loader.exe` |
| `save-credentials` / `load-credentials` | renderer → main | OS-encrypted credential storage |

## Authors

- **Metadraconis** — Head Development
- **Rain (Eruvos)** — Launcher integration, install/uninstall system
