# VengefulRealms Launcher — Architecture & Context Guide

> Written for contributors and AI-assisted research. Explains what the launcher is, how it's built, and how each piece fits together.

---

## What It Is

The VengefulRealms Launcher is a Windows desktop application that:
1. Detects the player's Skyrim SE installation
2. Copies a custom SkyMP client payload (DLLs, scripts, SKSE plugins) into the Skyrim folder
3. Writes a server configuration file so the SkyMP client connects to the VGR server
4. Launches the game via `skse64_loader.exe`
5. Handles login, credentials, and profile management

It is NOT a game mod. It is the delivery and launch mechanism that installs the multiplayer client on top of an existing vanilla Skyrim SE installation.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app framework | [Electron](https://www.electronjs.org/) v42 |
| Installer / auto-update | [Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows) via Electron Forge |
| Packager | [Electron Forge](https://www.electronforge.io/) |
| UI | Vanilla HTML/CSS/JS (no framework) |
| IPC | Electron `ipcMain` / `ipcRenderer` via context bridge |
| Credential storage | Electron `safeStorage` (Windows DPAPI encryption) |
| Runtime | Node.js (bundled with Electron) |

No React, no Vue, no bundler for the renderer. The UI is a single `index.html` with `style.css` and `script.js`.

---

## File Structure

```
VengefulRealms-Launcher/
  main.js           — Electron main process (Node.js environment)
  preload.js        — Context bridge between main and renderer
  index.html        — Launcher UI (single page)
  style.css         — All styling (dark/gold/red Skyrim theme)
  script.js         — All renderer-side logic
  fileoperations.js — File utility helpers (used by both processes)
  forge.config.js   — Electron Forge build/package config
  package.json      — Dependencies and npm scripts
  assets/
    icon.ico        — App icon (taskbar + installer)
    icons/          — SVG icons used in the UI
    logo.png        — VGR logo
    video/          — ambient.mp4 background video (not in git, too large)
  skymp-payload/    — (NOT in git) Binary game files — see Payload section
```

---

## Electron Process Architecture

Electron splits code into three contexts:

### Main Process (`main.js`)
Runs in Node.js. Has full filesystem and OS access. Handles:
- Window creation (`BrowserWindow`)
- All IPC handlers (`ipcMain.handle`, `ipcMain.on`)
- File I/O: installing, uninstalling, reading/writing settings
- Launching Skyrim via `child_process.spawn`
- Squirrel lifecycle hooks (install/uninstall events)
- Credential encryption via `safeStorage`

### Preload (`preload.js`)
Runs in an isolated context with access to both Node.js APIs and the renderer DOM. Acts as a secure bridge — it exposes only specific IPC channels to the renderer via `contextBridge.exposeInMainWorld`. The renderer cannot call Node.js directly; it must go through the preload bridge.

### Renderer (`index.html` + `script.js`)
Runs in Chromium. No direct Node.js access. Communicates with main via the channels exposed by preload. Handles all UI: section switching, progress bars, login form, settings panel, status messages.

---

## IPC Channels

All communication between renderer and main goes through these channels:

| Channel | Direction | What It Does |
|---|---|---|
| `find-skyrim` | renderer → main | Auto-detect Skyrim path via Windows registry + common Steam paths |
| `browse-folder` | renderer → main | Open native folder picker dialog |
| `check-prerequisites` | renderer → main | Verify Skyrim, SKSE64, and SkyMP prerequisites exist |
| `install-skymp` | renderer → main | Copy payload files into Skyrim folder, write manifest |
| `uninstall-skymp` | renderer → main | Remove only launcher-installed files using the manifest |
| `update-client-cfg` | renderer → main | Write `skymp5-client-settings.txt` with server IP and profile ID |
| `launch-game` | renderer → main | Sync payload (if needed) then spawn `skse64_loader.exe` |
| `save-settings` / `load-settings` | renderer ↔ main | Persist game path, profile ID, server IP to AppData |
| `save-credentials` / `load-credentials` / `clear-credentials` | renderer ↔ main | OS-encrypted "remember me" credential storage |

---

## Install Flow (Step by Step)

When a player clicks Install:

1. **Payload copy** — `main.js` walks `skymp-payload/` and copies every file into the detected Skyrim folder, mirroring the directory structure.
2. **Manifest write** — Every file path and directory created is recorded in `%AppData%\VGF-LauncherFiles\install-manifest.json`. This is what makes uninstall clean and precise.
3. **Config write** — `skymp5-client-settings.txt` is written to `Data/Platform/Plugins/` with:
   - `server-ip`: VGR server address (`141.195.99.135`)
   - `server-port`: `7777`
   - `profileId`: the player's assigned ID
4. **DLL placement** — `livekit.dll` and `livekit_ffi.dll` are placed in the Skyrim root (not in `Data/`). These sit next to `SkyrimSE.exe` so Windows finds them at runtime.

When a player clicks Uninstall:
- The manifest is read, every tracked file is deleted (with retry logic for Windows file locks), tracked directories are cleaned up, and the manifest itself is removed.
- Squirrel's `--squirrel-uninstall` hook also triggers this cleanup so uninstalling the launcher via Add/Remove Programs also cleans Skyrim.

---

## The SkyMP Payload

`skymp-payload/` is the binary game client. It is NOT included in this repo because it contains large DLLs. It must be built from source or obtained from the team.

### What's In It

```
skymp-payload/
  livekit.dll              — LiveKit real-time audio client (C++ wrapper)
  livekit_ffi.dll          — LiveKit Rust FFI layer
  Data/
    SKSE/Plugins/
      MpClientPlugin.dll   — Core SkyMP multiplayer client (C++)
      SkyrimPlatform.dll   — TypeScript/JS runtime for Skyrim mods
    Platform/
      Plugins/
        skymp5-client.js   — SkyMP client logic (TypeScript compiled to JS)
      Distribution/
        RuntimeDependencies/
          libcef.dll        — Chromium Embedded Framework (UI runtime)
          libnode.dll       — Node.js runtime (used by SkyrimPlatform)
          SkyrimPlatformImpl.dll
          libGLESv2.dll, libEGL.dll, chrome_elf.dll, d3dcompiler_47.dll
    NirnLabUIPlatform/
      (CEF support files: icudtl.dat, resources.pak, dxcompiler.dll, etc.)
```

### How SkyrimPlatform Works

SkyrimPlatform (`SkyrimPlatform.dll`) is an SKSE plugin that embeds Node.js and Chromium into Skyrim. It:
- Executes `skymp5-client.js` as a Node.js module inside the running game
- Exposes Skyrim's Papyrus API to JavaScript (`sp.Game.getPlayer()`, `sp.Actor`, etc.)
- Fires JS events for game events (`on("update", ...)`, `on("menuOpen", ...)`, etc.)
- Provides a CEF-based browser overlay for in-game UI (the social panel, trading UI, etc.)

`MpClientPlugin.dll` is the network layer — it manages the connection to the SkyMP server, sends player position/animation/state updates, and receives world state from the server.

`skymp5-client.js` is where all the multiplayer game logic lives. It's TypeScript compiled to a single bundled JS file. It runs inside Skyrim via SkyrimPlatform and:
- Manages other players as NPCs (spawning, appearance sync, movement)
- Sends the local player's inputs to the server
- Handles server-side gamemode scripts
- Manages UI via the CEF overlay

---

## Voice Chat (LiveKit)

Voice chat uses [LiveKit](https://livekit.io/) — an open-source WebRTC-based real-time audio platform.

### Components

- **`livekit.dll`** — C++ wrapper around the LiveKit client SDK. Handles room connection, participant management, and audio stream routing.
- **`livekit_ffi.dll`** — Rust FFI (Foreign Function Interface) layer that LiveKit's Rust SDK exposes for C++ interop.
- **`MpClientPlugin.dll`** — Calls into `livekit.dll` to init voice, start/stop talking, set participant positions.
- **`skymp5-client.js`** — Calls `sp.MpClientPlugin.initVoiceChat(url, token, ...)` when the server sends a voice configuration packet. Also calls `tickVoiceChat()` every frame to process audio, and `setVoiceParticipantPosition()` to feed 3D positions for spatial audio.

### Voice Flow

```
Server sends voiceConfig packet
  → skymp5-client.js receives it
  → calls MpClientPlugin.initVoiceChat(livekitUrl, token, sampleRate, channels)
  → MpClientPlugin connects to LiveKit room via livekit.dll / livekit_ffi.dll
  → Each game frame: MpClientPlugin.tickVoiceChat() processes audio
  → Each frame: setVoiceParticipantPosition(identity, x, y, z) for 3D audio
  → Player holds PTT key → MpClientPlugin.startTalking() / stopTalking()
```

Voice is proximity-based — participant positions are updated from in-game actor positions so audio volume and direction reflect where players are in the world.

### Why livekit.dll Is in Skyrim Root

Windows resolves DLLs by searching the executable's directory first. Since `SkyrimSE.exe` is in the Skyrim root, `livekit.dll` and `livekit_ffi.dll` must be there too so `MpClientPlugin.dll` (loaded by SKSE from `Data/SKSE/Plugins/`) can find them.

---

## Login & Authentication

Authentication is handled server-side. The launcher:
1. Collects a profile ID (assigned by server admins)
2. Writes it into `skymp5-client-settings.txt` as `profileId`
3. The SkyMP client reads this on connect and sends it to the server as the player identity

The "Remember Me" feature uses Electron's `safeStorage` API which encrypts credentials using Windows DPAPI (Data Protection API) — tied to the Windows user account. The encrypted blob is stored in `%AppData%\VGF-LauncherFiles\launcher-settings.json`. It cannot be decrypted by any other Windows user or on another machine.

---

## Build & Packaging

```bash
npm install        # install Electron and Forge
npm start          # run in dev mode (DevTools available via Ctrl+Shift+I)
npm run make       # produce installer
```

`npm run make` produces:
```
out/make/squirrel.windows/x64/
  VengefulRealms-Launcher-Setup.exe    ← single-file Windows installer
  VengefulRealms_Launcher-1.0.0-full.nupkg
```

### ASAR Unpacking

`forge.config.js` sets `asar.unpack: '**/skymp-payload/**'`. Electron normally bundles all app files into a single `app.asar` archive. The unpack rule keeps `skymp-payload/` as real files on disk so `main.js` can copy them into Skyrim using Node's `fs` module (you can't read out of an ASAR with `fs.copyFileSync`).

### Security Fuses (Electron Hardening)

The build enables several Electron security fuses:
- `RunAsNode: false` — prevents `--inspect` / Node.js mode abuse
- `EnableCookieEncryption: true` — encrypts session cookies
- `OnlyLoadAppFromAsar: true` — blocks loading code from outside the ASAR
- `EnableEmbeddedAsarIntegrityValidation: true` — validates ASAR integrity at startup

---

## Settings Storage

All runtime settings live in `%AppData%\Roaming\vengefulrealms-launcher\VGF-LauncherFiles\`:

| File | Contents |
|---|---|
| `launcher-settings.json` | Game path, profile ID, server IP, encrypted credentials |
| `install-manifest.json` | List of every file/directory the launcher placed in Skyrim |

Nothing is written to the registry. Nothing is stored in the app install directory (which is write-protected after Squirrel installs it).

---

## Key Design Decisions

**Why Electron?** Cross-platform tooling, native OS dialog/file access, and the ability to use Node.js for file operations without needing a separate backend process.

**Why Squirrel?** Silent installs, no UAC prompts (installs per-user, not system-wide), automatic delta updates, and clean Add/Remove Programs integration — all with a single `.exe` artifact.

**Why vanilla HTML/JS for the UI?** No build step for the renderer means changes to `index.html`, `style.css`, and `script.js` are visible immediately on reload in dev mode. Keeps the project approachable for contributors who aren't familiar with JS frameworks.

**Why is skymp-payload excluded from git?** The DLLs (`libcef.dll` alone is 247MB) are large binaries that change infrequently. Git is not suited for large binary assets. The payload is built from the [eruvos-skymp-livekit](https://github.com/eruvos-com/skymp) repo and distributed separately.
