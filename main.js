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
        // MO2 mode: drop the modlist.txt entries and remove the mod folders
        if (m.mo2) {
            const modlistFiles = m.mo2.modlistFiles || (m.mo2.modlistFile ? [m.mo2.modlistFile] : []);
            for (const mf of modlistFiles) {
                try {
                    if (!fs.existsSync(mf)) continue;
                    const lines = fs.readFileSync(mf, 'utf8').split(/\r?\n/)
                        .filter(l => !((l.startsWith('+') || l.startsWith('-')) && l.slice(1).trim() === 'VengefulRealms SkyMP'));
                    fs.writeFileSync(mf, lines.join('\r\n'), 'utf8');
                } catch (_) {}
            }
            const modDirs = m.mo2.modDirs || (m.mo2.modDir ? [m.mo2.modDir] : []);
            for (const md of modDirs) {
                const r = tryRemove(md, true);
                if (r.ok && !r.missing) removed.dirs++;
                else if (!r.ok) removed.errors.push(`${md}: ${r.error}`);
            }
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

    // SkyMP — check for client JS, either in game Data or in the MO2 mod folder
    let skympOk = fs.existsSync(path.join(gameDir, 'Data', 'Platform', 'Plugins', 'skymp5-client.js'));
    if (!skympOk) {
        const s = loadSettings();
        if (s && s.useMO2) {
            const inst = resolveMO2({ enabled: true, exe: s.mo2Exe, instance: s.mo2Instance });
            if (inst) skympOk = fs.existsSync(path.join(getMO2ModDir(inst), 'Platform', 'Plugins', 'skymp5-client.js'));
        }
    }
    results.skymp.ok = skympOk;

    return results;
});

// ── IPC: install SkyMP payload ────────────────────────────────────────────────
ipcMain.handle('install-skymp', (event, { gameDir, mo2 }) => {
    return installSkymp(gameDir, mo2);
});

// ── IPC: uninstall SkyMP payload ──────────────────────────────────────────────
ipcMain.handle('uninstall-skymp', (event, gameDir) => {
    return uninstallSkymp(gameDir);
});

// ── IPC: verify installed files ───────────────────────────────────────────────
// Compares every payload file against its install target by byte size, the
// same cheap check the pre-launch sync uses. Reports instead of fixing.
ipcMain.handle('verify-files', (event, { gameDir, mo2 }) => {
    if (!gameDir || !fs.existsSync(gameDir)) {
        return { success: false, error: 'Game directory not found' };
    }
    const payloadDir = path.join(__dirname, 'skymp-payload');
    if (!fs.existsSync(payloadDir)) {
        return { success: false, error: 'SkyMP payload missing from launcher install' };
    }
    let inst = null;
    if (mo2 && mo2.enabled) {
        inst = resolveMO2(mo2);
        if (!inst) return { success: false, error: 'MO2 instance not found, check MO2 settings' };
    }
    const targetFor = makeTargetMapper(gameDir, inst ? getMO2ModDir(inst) : null);

    const missing = [];
    const mismatched = [];
    let checked = 0;
    try {
        (function walk(relDir) {
            for (const entry of fs.readdirSync(path.join(payloadDir, relDir), { withFileTypes: true })) {
                if (entry.name.toLowerCase() === 'desktop.ini') continue;
                const rel = relDir ? path.join(relDir, entry.name) : entry.name;
                if (entry.isDirectory()) {
                    walk(rel);
                    continue;
                }
                checked++;
                const target = targetFor(rel);
                if (!fs.existsSync(target)) missing.push(rel);
                else if (fs.statSync(target).size !== fs.statSync(path.join(payloadDir, rel)).size) mismatched.push(rel);
            }
        })('');
    } catch (err) {
        return { success: false, error: err.message };
    }
    return { success: true, checked, missing, mismatched, ok: missing.length === 0 && mismatched.length === 0 };
});

// ── IPC: client config ────────────────────────────────────────────────────────
ipcMain.handle('update-client-cfg', (event, { gameDir, profileID, serverIP, email, mo2 }) => {
    // In MO2 mode the settings file lives in the mod folder so the VFS serves it
    const inst = resolveMO2(mo2);
    if (mo2 && mo2.enabled && !inst) {
        return { success: false, error: 'MO2 instance not found, check MO2 settings' };
    }
    const platformBase = inst ? getMO2ModDir(inst) : null;
    return writeClientSettings(gameDir, parseInt(profileID), serverIP || SERVER_IP, { platformBase, email });
});

// ── Sync payload → Skyrim: Data/Platform subtree ─────────────────────────────
// Runs silently before every game launch. Walks the payload's Data/Platform
// directory and overwrites any installed file whose byte size differs from the
// payload copy. Covers skymp5-client.js, all UI files, and anything added later.
// destParent is the folder holding Platform: gameDir/Data or the MO2 mod folder.
// Never throws — a sync failure must never block launch.
function syncPayloadPlatform(destParent) {
    try {
        const src  = path.join(__dirname, 'skymp-payload', 'Data', 'Platform');
        const dest = path.join(destParent, 'Platform');
        if (!fs.existsSync(src) || !fs.existsSync(destParent)) return;
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
// Spawn detached, report success after a short grace period, quit only when the
// spawn did not error so a failure toast stays readable and the user can retry.
// Quitting after launch avoids Chromium input conflicts with SkyMP CEF.
function spawnDetachedThenQuit(exe, args, cwd) {
    return new Promise((resolve) => {
        let failed = false;
        const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd });
        child.unref();
        const timer = setTimeout(() => {
            if (failed) return;
            resolve({ success: true });
            setTimeout(() => app.quit(), 1000);
        }, 500);
        child.on('error', (err) => {
            failed = true;
            clearTimeout(timer);
            resolve({ success: false, error: err.message });
        });
    });
}

ipcMain.handle('launch-game', async (event, exePath) => {
    if (!fs.existsSync(exePath)) {
        return { success: false, error: `File not found: ${exePath}` };
    }

    // Silently sync Data/Platform files (skymp5-client.js, UI files, etc.)
    // before launch so stale installs are auto-corrected without user action.
    syncPayloadPlatform(path.join(path.dirname(exePath), 'Data'));

    return spawnDetachedThenQuit(exePath, [], path.dirname(exePath));
});

// ── Mod Organizer 2 integration ──────────────────────────────────────────────
// When MO2 mode is on, the payload's Data files deploy into an MO2 mod folder
// instead of the game's Data directory and the game launches through MO2's VFS.
const MO2_MOD_NAME = 'VengefulRealms SkyMP';

// Minimal INI parser, enough for ModOrganizer.ini (sections, key=value, @ByteArray)
function parseIni(text) {
    const result = {};
    let section = '';
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const sec = line.match(/^\[(.+)\]$/);
        if (sec) { section = sec[1]; result[section] = result[section] || {}; continue; }
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        const ba = value.match(/^@ByteArray\((.*)\)$/s);
        if (ba) value = ba[1];
        // Qt quotes values containing commas or special chars, strip the quotes
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        (result[section] = result[section] || {})[key] = value;
    }
    return result;
}

// Read one MO2 instance's directories, profiles, and executable list from its ini
function readMO2Instance(name, instanceDir) {
    const iniPath = path.join(instanceDir, 'ModOrganizer.ini');
    if (!fs.existsSync(iniPath)) return null;
    let ini;
    try { ini = parseIni(fs.readFileSync(iniPath, 'utf8')); } catch (_) { return null; }
    const settings = ini.Settings || {};
    const general  = ini.General  || {};
    const baseDir = path.normalize(settings.base_directory || instanceDir);
    // Optional dirs default under baseDir and may reference %BASE_DIR%
    const resolveDir = (value, fallback) => value
        ? path.normalize(value.replace(/%BASE_DIR%/gi, baseDir))
        : path.join(baseDir, fallback);
    const modsDir     = resolveDir(settings.mod_directory,      'mods');
    const profilesDir = resolveDir(settings.profiles_directory, 'profiles');
    let profiles = [];
    try {
        profiles = fs.readdirSync(profilesDir, { withFileTypes: true })
            .filter(e => e.isDirectory()).map(e => e.name);
    } catch (_) {}
    // Executable titles let launch use a moshortcut when one points at SKSE
    const execs = [];
    const ce = ini.customExecutables || {};
    for (const key of Object.keys(ce)) {
        const m = key.match(/^(\d+)\\title$/);
        if (m) execs.push({ title: ce[key], binary: ce[`${m[1]}\\binary`] || '' });
    }
    return {
        name,
        gameName: general.gameName || '',
        selectedProfile: general.selected_profile || '',
        modsDir, profilesDir, profiles,
        executables: execs,
    };
}

// Portable instance sits next to the exe, global instances under LOCALAPPDATA
function listMO2Instances(mo2Exe) {
    const instances = [];
    if (mo2Exe && fs.existsSync(mo2Exe)) {
        const portable = readMO2Instance('', path.dirname(mo2Exe));
        if (portable) instances.push({ ...portable, portable: true });
    }
    const globalRoot = path.join(process.env.LOCALAPPDATA || '', 'ModOrganizer');
    if (process.env.LOCALAPPDATA && fs.existsSync(globalRoot)) {
        for (const entry of fs.readdirSync(globalRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const inst = readMO2Instance(entry.name, path.join(globalRoot, entry.name));
            if (inst) instances.push({ ...inst, portable: false });
        }
    }
    return instances;
}

function detectMO2Exe() {
    const { execSync } = require('child_process');
    // The nxm link handler registration is the most reliable pointer to MO2
    try {
        const out = execSync('reg query "HKCU\\Software\\Classes\\nxm\\shell\\open\\command" /ve', { encoding: 'utf8' });
        const m = out.match(/REG_SZ\s+"?(.+?(?:nxmhandler|ModOrganizer)\.exe)/i);
        if (m) {
            const candidate = path.join(path.dirname(m[1]), 'ModOrganizer.exe');
            if (fs.existsSync(candidate)) return candidate;
        }
    } catch (_) {}
    // Installer builds register an uninstall entry with the install location
    for (const hive of ['HKLM', 'HKCU']) {
        try {
            const out = execSync(`reg query "${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Mod Organizer 2_is1" /v InstallLocation`, { encoding: 'utf8' });
            const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/);
            if (m) {
                const candidate = path.join(m[1].trim(), 'ModOrganizer.exe');
                if (fs.existsSync(candidate)) return candidate;
            }
        } catch (_) {}
    }
    const candidates = [
        'C:\\Modding\\MO2\\ModOrganizer.exe',
        'C:\\MO2\\ModOrganizer.exe',
        'C:\\Program Files\\Mod Organizer 2\\ModOrganizer.exe',
        'D:\\Modding\\MO2\\ModOrganizer.exe',
        'D:\\MO2\\ModOrganizer.exe',
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// Resolve the saved MO2 selection back to a live instance, null if gone
function resolveMO2(mo2) {
    if (!mo2 || !mo2.enabled || !mo2.exe || !fs.existsSync(mo2.exe)) return null;
    const instances = listMO2Instances(mo2.exe);
    return instances.find(i => i.name === (mo2.instance || '')) || null;
}

const getMO2ModDir = (inst) => path.join(inst.modsDir, MO2_MOD_NAME);

// A running MO2 holds the modlist in memory and rewrites modlist.txt on exit,
// which would silently revert our edits, so block file operations while it runs
function isMO2Running() {
    if (process.platform !== 'win32') return false;
    try {
        const { execSync } = require('child_process');
        const out = execSync('tasklist /FI "IMAGENAME eq ModOrganizer.exe" /NH', { encoding: 'utf8' });
        return /ModOrganizer\.exe/i.test(out);
    } catch (_) {
        return false;
    }
}

// Payload files under Data map into the MO2 mod folder when MO2 mode is on,
// everything else (livekit dlls) still belongs in the game root.
function makeTargetMapper(gameDir, modDir) {
    return (rel) => {
        if (!modDir) return path.join(gameDir, rel);
        const parts = rel.split(path.sep);
        if (parts[0] === 'Data') return path.join(modDir, ...parts.slice(1));
        return path.join(gameDir, rel);
    };
}

// Flip or insert our +entry in the profile's modlist.txt so the mod is active.
// Top of modlist.txt is the highest priority, so a new entry goes first.
function enableModInProfile(inst, profile) {
    const profileName = profile || inst.selectedProfile;
    if (!profileName) return { success: false, error: 'No MO2 profile selected' };
    const modlistFile = path.join(inst.profilesDir, profileName, 'modlist.txt');
    if (!fs.existsSync(modlistFile)) {
        return { success: false, error: `MO2 profile modlist not found: ${modlistFile}` };
    }
    const lines = fs.readFileSync(modlistFile, 'utf8').split(/\r?\n/);
    const idx = lines.findIndex(l => (l.startsWith('+') || l.startsWith('-')) && l.slice(1).trim() === MO2_MOD_NAME);
    if (idx >= 0) {
        lines[idx] = '+' + MO2_MOD_NAME;
    } else {
        const insertAt = lines[0] && lines[0].startsWith('#') ? 1 : 0;
        lines.splice(insertAt, 0, '+' + MO2_MOD_NAME);
    }
    fs.writeFileSync(modlistFile, lines.join('\r\n'), 'utf8');
    return { success: true, modlistFile };
}

// ── IPC: Mod Organizer 2 ─────────────────────────────────────────────────────
ipcMain.handle('detect-mo2', () => detectMO2Exe());

ipcMain.handle('mo2-info', (event, mo2Exe) => ({ instances: listMO2Instances(mo2Exe) }));

ipcMain.handle('browse-file', async (event, filters) => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: filters || [] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

// Launch SKSE through MO2 so the game sees the VFS-mounted modlist
ipcMain.handle('launch-mo2', async (event, { gameDir, mo2 }) => {
    const inst = resolveMO2(mo2);
    if (!inst) return { success: false, error: 'MO2 instance not found, check MO2 settings' };
    const sksePath = path.join(gameDir, 'skse64_loader.exe');
    if (!fs.existsSync(sksePath)) return { success: false, error: `File not found: ${sksePath}` };
    if (isMO2Running()) {
        return { success: false, error: 'Mod Organizer 2 is already running. Close MO2, then launch again.' };
    }

    // Keep the mod folder current before MO2 mounts it
    syncPayloadPlatform(getMO2ModDir(inst));

    const args = [];
    // -i "" forces the portable instance, otherwise MO2 opens the last-used one
    if (inst.portable) args.push('-i', '');
    else if (inst.name) args.push('-i', inst.name);
    if (mo2.profile) args.push('-p', mo2.profile);
    // Prefer a registered SKSE executable entry, fall back to the run command
    const skse = inst.executables.find(e => /skse64_loader\.exe\s*$/i.test(e.binary || ''));
    if (skse) args.push(`moshortcut://${inst.portable ? '' : inst.name}:${skse.title}`);
    else args.push('run', sksePath);

    return spawnDetachedThenQuit(mo2.exe, args, path.dirname(mo2.exe));
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

function installSkymp(gameDir, mo2) {
    if (!gameDir || !fs.existsSync(gameDir)) {
        return { success: false, error: 'Game directory not found' };
    }

    const payloadDir = path.join(__dirname, 'skymp-payload');
    if (!fs.existsSync(payloadDir)) {
        return { success: false, error: 'SkyMP payload missing from launcher install' };
    }

    // In MO2 mode the instance must resolve before any file is touched
    let inst = null;
    if (mo2 && mo2.enabled) {
        inst = resolveMO2(mo2);
        if (!inst) return { success: false, error: 'MO2 instance not found, check MO2 settings' };
        if (isMO2Running()) {
            return { success: false, error: 'Mod Organizer 2 is running. Close MO2, then try again.' };
        }
    }
    const modDir = inst ? getMO2ModDir(inst) : null;
    const targetFor = makeTargetMapper(gameDir, modDir);

    // Load existing manifest so reinstalls accumulate rather than overwrite
    const manifest = loadManifest();
    if (!manifest.gameDir) manifest.gameDir = gameDir;
    const filesSet = new Set(manifest.files || []);
    const dirsSet  = new Set(manifest.dirs  || []);

    let installed = 0;
    let overwritten = 0;

    // Record every directory this install creates so uninstall can prune them
    const ensureDir = (dir) => {
        const missing = [];
        let d = dir;
        while (!fs.existsSync(d)) {
            missing.push(d);
            const parent = path.dirname(d);
            // Stop at the filesystem root, mkdirSync below reports a dead drive
            if (parent === d) break;
            d = parent;
        }
        if (missing.length) fs.mkdirSync(dir, { recursive: true });
        missing.forEach(m => dirsSet.add(m));
    };

    function copyPayload(relDir) {
        for (const entry of fs.readdirSync(path.join(payloadDir, relDir), { withFileTypes: true })) {
            // Skip Windows shell metadata files — they're auto-generated and
            // protected by the OS; trying to overwrite them throws EPERM.
            if (entry.name.toLowerCase() === 'desktop.ini') continue;
            const rel = relDir ? path.join(relDir, entry.name) : entry.name;
            if (entry.isDirectory()) {
                copyPayload(rel);
                continue;
            }
            const destPath = targetFor(rel);
            ensureDir(path.dirname(destPath));
            const existed = fs.existsSync(destPath);
            fs.copyFileSync(path.join(payloadDir, rel), destPath);
            filesSet.add(destPath);
            if (existed) overwritten++;
            else installed++;
        }
    }

    // Persist the manifest so uninstall (including via Add/Remove Programs)
    // knows exactly what to remove. Called on every exit path so files copied
    // before a failure are still tracked and can be cleaned up later.
    const persistManifest = () => {
        saveManifest({
            gameDir: manifest.gameDir,
            installedAt: manifest.installedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            files: Array.from(filesSet),
            dirs:  Array.from(dirsSet),
            mo2: manifest.mo2 || null,
        });
    };

    try {
        copyPayload('');
        if (inst) {
            // Give the mod a meta.ini so MO2 lists it cleanly. gameName must be
            // the MO2 short name or MO2 flags the mod as for a different game.
            ensureDir(modDir);
            const metaPath = path.join(modDir, 'meta.ini');
            if (!fs.existsSync(metaPath)) {
                fs.writeFileSync(metaPath,
                    `[General]\ngameName=SkyrimSE\nversion=1.0.0\ncomments=Installed by the VengefulRealms launcher\n`,
                    'utf8');
                filesSet.add(metaPath);
            }
            // Track every mod folder and modlist we ever touched, a profile or
            // instance switch must not orphan entries written on earlier installs
            const prev = manifest.mo2 || {};
            const modDirs = new Set(prev.modDirs || (prev.modDir ? [prev.modDir] : []));
            modDirs.add(modDir);
            const modlistFiles = new Set(prev.modlistFiles || (prev.modlistFile ? [prev.modlistFile] : []));
            const enabled = enableModInProfile(inst, mo2.profile);
            if (enabled.success) modlistFiles.add(enabled.modlistFile);
            manifest.mo2 = {
                modDir,
                modDirs: Array.from(modDirs),
                profile: mo2.profile || inst.selectedProfile,
                modlistFiles: Array.from(modlistFiles),
            };
            if (!enabled.success) {
                persistManifest();
                return { success: false, error: enabled.error };
            }
        }
        persistManifest();
        return { success: true, installed, overwritten };
    } catch (err) {
        // Keep whatever was recorded so uninstall can still clean up
        try { persistManifest(); } catch (_) {}
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

    // A running MO2 would revert our modlist.txt edit when it exits
    if (manifest.mo2 && isMO2Running()) {
        return { success: false, error: 'Mod Organizer 2 is running. Close MO2, then uninstall again.', removed: 0, missing: 0, errors: [] };
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

    // 2) MO2 mode: drop our modlist.txt entries and remove every mod folder we
    //    ever wrote to (older manifests only have the singular fields)
    if (manifest.mo2) {
        const modlistFiles = manifest.mo2.modlistFiles || (manifest.mo2.modlistFile ? [manifest.mo2.modlistFile] : []);
        for (const mf of modlistFiles) {
            if (!fs.existsSync(mf)) continue;
            try {
                const lines = fs.readFileSync(mf, 'utf8').split(/\r?\n/)
                    .filter(l => !((l.startsWith('+') || l.startsWith('-')) && l.slice(1).trim() === MO2_MOD_NAME));
                fs.writeFileSync(mf, lines.join('\r\n'), 'utf8');
            } catch (e) {
                errors.push(`${mf}: ${e.message}`);
            }
        }
        const modDirs = manifest.mo2.modDirs || (manifest.mo2.modDir ? [manifest.mo2.modDir] : []);
        for (const md of modDirs) {
            if (!fs.existsSync(md)) continue;
            const r = removeWithRetry(md, { recursiveDir: true });
            if (r.ok && !r.missing) removed++;
            else if (!r.ok) errors.push(`${md}: ${r.error}`);
        }
    }

    // 3) Always also try to clean these even if absent from the manifest:
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

    // 4) Clear the manifest itself so a subsequent install starts fresh
    try {
        const f = getManifestFile();
        if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (_) {}

    return { success: errors.length === 0, removed, missing, errors };
}

// ── Write skymp5-client-settings.txt ─────────────────────────────────────────
// opts.platformBase overrides where the Platform tree lives (MO2 mod folder)
function writeClientSettings(gameDir, profileID, serverIP, opts = {}) {
    if (!gameDir || !fs.existsSync(gameDir)) {
        return { success: false, error: 'Game directory not found' };
    }

    const platformBase = opts.platformBase || path.join(gameDir, 'Data');
    const pluginsDir = path.join(platformBase, 'Platform', 'Plugins');
    const settingsPath = path.join(pluginsDir, 'skymp5-client-settings.txt');

    // Create Plugins dir if missing
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
    }

    // Create PluginsDev dir to prevent DirectoryMonitor error on launch
    const pluginsDevDir = path.join(platformBase, 'Platform', 'PluginsDev');
    if (!fs.existsSync(pluginsDevDir)) {
        fs.mkdirSync(pluginsDevDir, { recursive: true });
    }

    // Supply the logged-in identity so the server can tie the session to a user
    const gameData = { profileId: profileID };
    if (opts.email) gameData.email = opts.email;

    const content = {
        gameData,
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
