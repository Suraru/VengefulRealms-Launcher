const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('node:path');
const { spawn, exec } = require('child_process');

// ── Squirrel lifecycle: intercept uninstall to also clean Skyrim ─────────────
// When Windows uninstalls the app, Squirrel re-launches the exe with
// --squirrel-uninstall. We run a self-contained Skyrim cleanup using the
// install manifest BEFORE letting Squirrel finish removing the launcher —
// so Add/Remove Programs leaves a clean Skyrim, not a half-cleaned one.
const squirrelEvent = process.argv.find(a => a && a.startsWith('--squirrel-'));
if (squirrelEvent === '--squirrel-uninstall') {
    runSquirrelUninstallCleanup();
    app.quit();
    return;
}
if (require('electron-squirrel-startup')) app.quit();

function runSquirrelUninstallCleanup() {
    // Retry helper for the Squirrel uninstall path. Same pattern as
    // removeWithRetry in uninstallSkymp — handles transient Windows file locks
    // (Explorer windows, Defender scans, lingering handles) by retrying with
    // backoff. Total worst-case wait per file: ~3s.
    const sleepSync = (ms) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { /* spin */ }
    };
    const tryRemove = (p, isDir = false) => {
        if (!fs.existsSync(p)) return { ok: true, missing: true };
        const delays = [0, 250, 750, 2000];
        let lastErr;
        for (let i = 0; i < delays.length; i++) {
            if (delays[i] > 0) sleepSync(delays[i]);
            try {
                if (!fs.existsSync(p)) return { ok: true };
                const s = fs.statSync(p);
                if (s.isDirectory()) {
                    if (isDir) fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                    else if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
                    else return { ok: false, error: 'directory not empty' };
                } else {
                    fs.unlinkSync(p);
                }
                return { ok: true };
            } catch (e) { lastErr = e; }
        }
        return { ok: false, error: lastErr ? lastErr.message : 'unknown' };
    };

    try {
        // Resolve manifest path manually — we can't depend on helpers defined later
        const configDir = path.join(app.getPath('userData'), 'VGF-LauncherFiles');
        const manifestFile = path.join(configDir, 'install-manifest.json');
        if (!fs.existsSync(manifestFile)) return; // nothing to clean

        const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        const removed = { files: 0, dirs: 0, errors: [] };

        // Delete tracked files (with retry)
        for (const f of (m.files || [])) {
            const r = tryRemove(f);
            if (r.ok && !r.missing) removed.files++;
            else if (!r.ok) removed.errors.push(`${f}: ${r.error}`);
        }
        // Delete empty directories (deepest first, with retry)
        const dirs = (m.dirs || []).slice().sort((a, b) => b.length - a.length);
        for (const d of dirs) {
            const r = tryRemove(d, false);
            if (r.ok && !r.missing) removed.dirs++;
        }
        // Also nuke the generated client settings + livekit dlls if present
        if (m.gameDir) {
            for (const extra of [
                path.join(m.gameDir, 'Data', 'Platform', 'Plugins', 'skymp5-client-settings.txt'),
                path.join(m.gameDir, 'livekit.dll'),
                path.join(m.gameDir, 'livekit_ffi.dll'),
            ]) {
                const r = tryRemove(extra);
                if (r.ok && !r.missing) removed.files++;
                else if (!r.ok) removed.errors.push(`${extra}: ${r.error}`);
            }
        }
        // Log result so testers can verify it ran
        try {
            fs.appendFileSync(
                path.join(app.getPath('userData'), 'uninstall.log'),
                `[${new Date().toISOString()}] cleanup: ${JSON.stringify(removed)}\n`,
                'utf8'
            );
        } catch (_) {}
    } catch (_) { /* never block Squirrel uninstall on cleanup failure */ }
}

const SERVER_IP   = '141.195.99.135';
const SERVER_PORT = 7777;
const SERVER_MASTER = '';

// Settings written to AppData so they're always writable (packaged or dev)
const getConfigFolder = () => path.join(app.getPath('userData'), 'VGF-LauncherFiles');
const getConfigFile   = () => path.join(getConfigFolder(), 'launcher-settings.json');

let globalSettings = null;

// ── Window ────────────────────────────────────────────────────────────────────
const createWindow = () => {
    const win = new BrowserWindow({
        autoHideMenuBar: true,
        width: 1360,
        height: 860,
        minWidth: 1100,
        minHeight: 700,
        center: true,
        show: false,
        backgroundColor: '#000000',
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.loadFile('index.html');
    win.once('ready-to-show', () => win.show());
};

app.whenReady().then(() => {
    globalSettings = loadSettings();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ── IPC: settings ────────────────────────────────────────────────────────────
ipcMain.handle('load-settings', () => loadSettings());

ipcMain.on('save-settings', (event, { gameDir, profileID, serverIP }) => {
    saveSettings(gameDir, profileID, serverIP);
    event.reply('save-settings-complete', { success: true });
});

// ── IPC: secure credential storage (OS-encrypted via safeStorage) ────────────
// Uses Electron's safeStorage which encrypts with the OS user's key (DPAPI on
// Windows, Keychain on macOS). The encrypted blob lives in launcher-settings
// alongside other settings — it's unreadable without the same OS user account.
// Falls back to a plain marker if OS encryption isn't available, so the
// remember-me UX still works (just without encryption on that machine).
ipcMain.handle('save-credentials', (event, { email, password }) => {
    try {
        if (!email || !password) return { success: false, error: 'missing email or password' };
        if (!safeStorage.isEncryptionAvailable()) {
            // OS encryption unavailable (rare); store email only, password is dropped.
            const s = loadSettings() || {};
            s.rememberedEmail = email;
            delete s.rememberedCredential;
            saveFullSettingsObj(s);
            return { success: true, encrypted: false };
        }
        const blob = safeStorage.encryptString(JSON.stringify({ email, password }));
        const s = loadSettings() || {};
        s.rememberedEmail = email; // keep for backwards compat / quick read
        s.rememberedCredential = blob.toString('base64');
        saveFullSettingsObj(s);
        return { success: true, encrypted: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('load-credentials', () => {
    try {
        const s = loadSettings();
        if (!s || !s.rememberedCredential) return { ok: false };
        if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'encryption unavailable' };
        const decrypted = safeStorage.decryptString(Buffer.from(s.rememberedCredential, 'base64'));
        const obj = JSON.parse(decrypted);
        if (!obj.email || !obj.password) return { ok: false };
        return { ok: true, email: obj.email, password: obj.password };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('clear-credentials', () => {
    try {
        const s = loadSettings() || {};
        delete s.rememberedEmail;
        delete s.rememberedCredential;
        saveFullSettingsObj(s);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Helper used by the credential handlers
function saveFullSettingsObj(obj) {
    ensureConfigFolder();
    fs.writeFileSync(getConfigFile(), JSON.stringify(obj, null, 2), 'utf8');
}

ipcMain.on('save-full-settings', (event, settings) => {
    ensureConfigFolder();
    // Belt-and-suspenders: even though callers SHOULD pass the full object,
    // preserve credential fields from the existing file if the caller forgot
    // them. This keeps "Keep me signed in" robust against future code paths
    // that don't know about credentials.
    const existing = loadSettings() || {};
    const merged = { ...settings };
    if (!('rememberedEmail' in merged)      && 'rememberedEmail'      in existing) merged.rememberedEmail      = existing.rememberedEmail;
    if (!('rememberedCredential' in merged) && 'rememberedCredential' in existing) merged.rememberedCredential = existing.rememberedCredential;
    fs.writeFileSync(getConfigFile(), JSON.stringify(merged, null, 2), 'utf8');
});

// ── IPC: Skyrim detection ─────────────────────────────────────────────────────
ipcMain.handle('find-skyrim', () => findSkyrimPath());

ipcMain.handle('browse-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

// ── IPC: check prerequisites ──────────────────────────────────────────────────
ipcMain.handle('check-prerequisites', (event, gameDir) => {
    const results = {
        skyrim: { ok: false, path: gameDir },
        skse:   { ok: false, version: null },
        skymp:  { ok: false }
    };

    if (!gameDir || !fs.existsSync(gameDir)) return results;

    // Skyrim
    results.skyrim.ok = fs.existsSync(path.join(gameDir, 'SkyrimSE.exe'));

    // SKSE64 — check for loader and the version-specific dll
    const loaderExists = fs.existsSync(path.join(gameDir, 'skse64_loader.exe'));
    const dllFiles = fs.existsSync(gameDir)
        ? fs.readdirSync(gameDir).filter(f => f.match(/^skse64_\d+_\d+_\d+\.dll$/))
        : [];
    results.skse.ok      = loaderExists && dllFiles.length > 0;
    results.skse.version = dllFiles.length > 0 ? dllFiles[0].replace('skse64_', '').replace('.dll', '').replace(/_/g, '.') : null;

    // SkyMP — check for client JS
    results.skymp.ok = fs.existsSync(path.join(gameDir, 'Data', 'Platform', 'Plugins', 'skymp5-client.js'));

    return results;
});

// ── IPC: install SkyMP payload ────────────────────────────────────────────────
ipcMain.handle('install-skymp', (event, gameDir) => {
    return installSkymp(gameDir);
});

// ── IPC: uninstall SkyMP payload ──────────────────────────────────────────────
ipcMain.handle('uninstall-skymp', (event, gameDir) => {
    return uninstallSkymp(gameDir);
});

// ── IPC: client config ────────────────────────────────────────────────────────
ipcMain.handle('update-client-cfg', (event, { gameDir, profileID, serverIP }) => {
    return writeClientSettings(gameDir, parseInt(profileID), serverIP || SERVER_IP);
});

// ── Sync payload → Skyrim: Data/Platform subtree ─────────────────────────────
// Runs silently before every game launch. Walks the payload's Data/Platform
// directory and overwrites any installed file whose byte size differs from the
// payload copy. Covers skymp5-client.js, all UI files, and anything added later.
// Never throws — a sync failure must never block launch.
function syncPayloadPlatform(gameDir) {
    try {
        const src  = path.join(__dirname, 'skymp-payload', 'Data', 'Platform');
        const dest = path.join(gameDir,   'Data', 'Platform');
        if (!fs.existsSync(src) || !fs.existsSync(gameDir)) return;
        (function walk(s, d) {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
            for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
                if (entry.name.toLowerCase() === 'desktop.ini') continue;
                const sp = path.join(s, entry.name);
                const dp = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    walk(sp, dp);
                } else {
                    const srcSize  = fs.statSync(sp).size;
                    const destSize = fs.existsSync(dp) ? fs.statSync(dp).size : -1;
                    if (srcSize !== destSize) fs.copyFileSync(sp, dp);
                }
            }
        })(src, dest);
    } catch (_) { /* never block launch on sync failure */ }
}

// ── IPC: launch game ──────────────────────────────────────────────────────────
ipcMain.handle('launch-game', async (event, exePath) => {
    if (!fs.existsSync(exePath)) {
        return { success: false, error: `File not found: ${exePath}` };
    }

    // Silently sync Data/Platform files (skymp5-client.js, UI files, etc.)
    // before launch so stale installs are auto-corrected without user action.
    syncPayloadPlatform(path.dirname(exePath));

    return new Promise((resolve) => {
        const child = spawn(exePath, [], {
            detached: true,
            stdio: 'ignore',
            cwd: path.dirname(exePath)
        });
        child.unref();
        child.on('error', (err) => resolve({ success: false, error: err.message }));
        // Quit launcher after launch to avoid Chromium input conflicts with SkyMP CEF
        setTimeout(() => {
            resolve({ success: true });
            setTimeout(() => app.quit(), 1000);
        }, 500);
    });
});

// ── Skyrim detection ─────────────────────────────────────────────────────────
function findSkyrimPath() {
    const regPaths = [
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 489830',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 489830'
    ];

    for (const reg of regPaths) {
        try {
            const { execSync } = require('child_process');
            const out = execSync(`reg query "${reg}" /v InstallLocation`, { encoding: 'utf8' });
            const match = out.match(/InstallLocation\s+REG_SZ\s+(.+)/);
            if (match) {
                const loc = match[1].trim();
                if (fs.existsSync(loc)) return loc;
            }
        } catch (_) {}
    }

    const candidates = [
        `${process.env['ProgramFiles(x86)']}\\Steam\\steamapps\\common\\Skyrim Special Edition`,
        `${process.env.ProgramFiles}\\Steam\\steamapps\\common\\Skyrim Special Edition`,
        'C:\\Steam\\steamapps\\common\\Skyrim Special Edition',
        'D:\\Steam\\steamapps\\common\\Skyrim Special Edition',
        'D:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition',
        'E:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition'
    ];

    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }

    return null;
}

// ── Install bundled SkyMP payload into tester's Skyrim ───────────────────────
// Records every file/directory it creates to an install manifest, so uninstall
// can surgically remove ONLY what the launcher placed — never vanilla files or
// the user's other mods.
const getManifestFile = () => path.join(getConfigFolder(), 'install-manifest.json');

function installSkymp(gameDir) {
    if (!gameDir || !fs.existsSync(gameDir)) {
        return { success: false, error: 'Game directory not found' };
    }

    const payloadDir = path.join(__dirname, 'skymp-payload');
    if (!fs.existsSync(payloadDir)) {
        return { success: false, error: 'SkyMP payload missing from launcher install' };
    }

    // Load existing manifest so reinstalls accumulate rather than overwrite
    const manifest = loadManifest();
    if (!manifest.gameDir) manifest.gameDir = gameDir;
    const filesSet = new Set(manifest.files || []);
    const dirsSet  = new Set(manifest.dirs  || []);

    let installed = 0;
    let overwritten = 0;

    function copyDir(src, dest) {
        const dirCreated = !fs.existsSync(dest);
        if (dirCreated) {
            fs.mkdirSync(dest, { recursive: true });
            dirsSet.add(dest);
        }
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            // Skip Windows shell metadata files — they're auto-generated and
            // protected by the OS; trying to overwrite them throws EPERM.
            if (entry.name.toLowerCase() === 'desktop.ini') continue;
            const srcPath  = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                copyDir(srcPath, destPath);
            } else {
                const existed = fs.existsSync(destPath);
                fs.copyFileSync(srcPath, destPath);
                filesSet.add(destPath);
                if (existed) overwritten++;
                else installed++;
            }
        }
    }

    try {
        copyDir(payloadDir, gameDir);
        // Persist the manifest so uninstall (including via Add/Remove Programs)
        // knows exactly what to remove.
        saveManifest({
            gameDir: manifest.gameDir,
            installedAt: manifest.installedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            files: Array.from(filesSet),
            dirs:  Array.from(dirsSet),
        });
        return { success: true, installed, overwritten };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function loadManifest() {
    try {
        const f = getManifestFile();
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (_) {}
    return {};
}

function saveManifest(m) {
    ensureConfigFolder();
    fs.writeFileSync(getManifestFile(), JSON.stringify(m, null, 2), 'utf8');
}

// ── Uninstall SkyMP payload from Skyrim folder ───────────────────────────────
// Manifest-driven: removes EXACTLY the files installSkymp recorded — never
// touches vanilla game files or unrelated mods. Falls back to a hardcoded
// list for installs that predate the manifest system.
function uninstallSkymp(gameDir) {
    const manifest = loadManifest();
    const targetGameDir = gameDir || manifest.gameDir;

    if (!targetGameDir) {
        return { success: false, error: 'No game directory recorded — nothing to uninstall' };
    }

    let removed = 0;
    let missing = 0;
    let errors = [];

    // 1) Remove tracked files
    const trackedFiles = Array.isArray(manifest.files) ? manifest.files : [];

    // Retry-with-backoff helpers — Windows file locks usually clear in ~1s,
    // so we make a few attempts before giving up and reporting failure.
    const sleepSync = (ms) => {
        const end = Date.now() + ms;
        // Coarse busy-wait. Acceptable because uninstall is a brief, user-driven op.
        const buf = Buffer.alloc(ms);
        while (Date.now() < end) { /* spin */ buf.fill(0); }
    };
    const removeWithRetry = (p, { recursiveDir = false } = {}) => {
        if (!fs.existsSync(p)) return { ok: true, missing: true };
        // 4 attempts: 0, 250ms, 750ms, 2000ms — total ~3s worst case
        const delays = [0, 250, 750, 2000];
        let lastErr;
        for (let i = 0; i < delays.length; i++) {
            if (delays[i] > 0) sleepSync(delays[i]);
            try {
                if (!fs.existsSync(p)) return { ok: true, missing: i === 0 };
                const s = fs.statSync(p);
                if (s.isDirectory()) {
                    if (recursiveDir) {
                        fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                    } else if (fs.readdirSync(p).length === 0) {
                        fs.rmdirSync(p);
                    } else {
                        return { ok: false, error: 'directory not empty' };
                    }
                } else {
                    fs.unlinkSync(p);
                }
                return { ok: true };
            } catch (e) {
                lastErr = e;
                // EBUSY/EPERM/ENOTEMPTY usually indicate transient lock — retry
            }
        }
        return { ok: false, error: lastErr ? lastErr.message : 'unknown' };
    };

    if (trackedFiles.length === 0) {
        // Legacy fallback for pre-manifest installs.
        // Safe set: only payload-specific files/folders that DON'T mix with vanilla namespaces.
        // We intentionally do NOT nuke Data/Scripts, Data/meshes, Data/sound, Data/textures
        // because vanilla and other mods live there too.
        for (const p of [
            path.join(targetGameDir, 'Data', 'Platform'),
            path.join(targetGameDir, 'Data', 'NirnLabUIPlatform'),
            path.join(targetGameDir, 'livekit.dll'),
            path.join(targetGameDir, 'livekit_ffi.dll'),
        ]) {
            if (!fs.existsSync(p)) continue;
            const r = removeWithRetry(p, { recursiveDir: true });
            if (r.ok) removed++;
            else errors.push(`${p}: ${r.error}`);
        }
        // Legacy SKSE plugin sweep — only files we know we install
        const knownPlugins = [
            'MpClientPlugin.dll', 'SkyrimPlatform.dll', 'SkyrimPlatform.ini',
            'NirnLabUIPlugin.dll', 'ActorLimitFix.dll', 'ActorLimitFix.json',
            'AnimationQueueFix.dll', 'po3_Tweaks.dll',
            'AHZmoreHUDInventory.ini', 'po3_OxygenMeter2.ini',
        ];
        const pluginsDir = path.join(targetGameDir, 'Data', 'SKSE', 'Plugins');
        if (fs.existsSync(pluginsDir)) {
            for (const f of fs.readdirSync(pluginsDir)) {
                if (knownPlugins.includes(f) || f.startsWith('versionlib-')) {
                    const r = removeWithRetry(path.join(pluginsDir, f));
                    if (r.ok) removed++;
                    else errors.push(`${f}: ${r.error}`);
                }
            }
        }
    } else {
        // Manifest-driven precise removal
        for (const f of trackedFiles) {
            const r = removeWithRetry(f);
            if (r.ok) {
                if (r.missing) missing++; else removed++;
            } else {
                errors.push(`${f}: ${r.error}`);
            }
        }

        // Then clean up empty directories we created (deepest first)
        const trackedDirs = (Array.isArray(manifest.dirs) ? manifest.dirs : [])
            .slice().sort((a, b) => b.length - a.length);
        for (const d of trackedDirs) {
            removeWithRetry(d); // best-effort, ignore result
        }
    }

    // 2) Always also try to clean these even if absent from the manifest:
    //    the generated client settings + PluginsDev dir + LiveKit DLLs in root.
    const extraTargets = [
        path.join(targetGameDir, 'Data', 'Platform', 'Plugins', 'skymp5-client-settings.txt'),
        path.join(targetGameDir, 'Data', 'Platform', 'PluginsDev'),
        path.join(targetGameDir, 'livekit.dll'),
        path.join(targetGameDir, 'livekit_ffi.dll'),
    ];
    for (const p of extraTargets) {
        if (!fs.existsSync(p)) continue;
        const r = removeWithRetry(p);
        if (r.ok && !r.missing) removed++;
        else if (!r.ok) errors.push(`${p}: ${r.error}`);
    }

    // 3) Clear the manifest itself so a subsequent install starts fresh
    try {
        const f = getManifestFile();
        if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (_) {}

    return { success: errors.length === 0, removed, missing, errors };
}

// ── Write skymp5-client-settings.txt ─────────────────────────────────────────
function writeClientSettings(gameDir, profileID, serverIP) {
    if (!gameDir || !fs.existsSync(gameDir)) {
        return { success: false, error: 'Game directory not found' };
    }

    const pluginsDir = path.join(gameDir, 'Data', 'Platform', 'Plugins');
    const settingsPath = path.join(pluginsDir, 'skymp5-client-settings.txt');

    // Create Plugins dir if missing
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
    }

    // Create PluginsDev dir to prevent DirectoryMonitor error on launch
    const pluginsDevDir = path.join(gameDir, 'Data', 'Platform', 'PluginsDev');
    if (!fs.existsSync(pluginsDevDir)) {
        fs.mkdirSync(pluginsDevDir, { recursive: true });
    }

    const content = {
        gameData:               { profileId: profileID },
        master:                 SERVER_MASTER,
        'server-ip':            serverIP,
        'server-port':          SERVER_PORT,
        'server-master-key':    null,
        'server-info-ignore':   true,
        ignoreLoadOrderMismatch: true,
        'server-public-keys': {
            CPPvgr: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAdXeiuy6EBxgU1vSe9Emy1UCcPFOxlZ8/ljokSq4LHUs=\n-----END PUBLIC KEY-----'
        }
    };

    const utf8 = { encoding: 'utf8' };
    fs.writeFileSync(settingsPath, JSON.stringify(content, null, 2), utf8);

    // Remove password file if present
    const passwordPath = path.join(gameDir, 'Data', 'Platform', 'Distribution', 'password');
    if (fs.existsSync(passwordPath)) fs.unlinkSync(passwordPath);

    // Remove conflicting SkyrimSoulsRE files
    const conflicting = [
        path.join(gameDir, 'Data', 'SKSE', 'Plugins', 'SkyrimSoulsRE.dll'),
        path.join(gameDir, 'Data', 'SKSE', 'Plugins', 'SkyrimSoulsRE.ini'),
        path.join(gameDir, 'Data', 'SKSE', 'Plugins', 'SkyrimSoulsRE.pdb')
    ];
    for (const f of conflicting) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    return { success: true };
}

// ── Launcher settings helpers ─────────────────────────────────────────────────
function ensureConfigFolder() {
    const folder = getConfigFolder();
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
}

function saveSettings(gameDir, profileID, serverIP) {
    ensureConfigFolder();
    // MERGE into existing settings — don't overwrite the whole file.
    // Otherwise this clobbers rememberedEmail / rememberedCredential / wizardComplete
    // every time it's called (e.g. on every Launch Game click).
    const existing = loadSettings() || {};
    const settings = { ...existing, gameDir, profileID, serverIP };
    fs.writeFileSync(getConfigFile(), JSON.stringify(settings, null, 2), 'utf8');
}

function loadSettings() {
    ensureConfigFolder();
    const file = getConfigFile();
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}
