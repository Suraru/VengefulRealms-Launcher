// ========== VENGEFUL REALMS - PROFESSIONAL LAUNCHER UI ==========
// Frontend-only prototype. Connect triggerLauncherAction() to your executable/backend.

// Beta tester accounts. Frontend credential gate (no backend auth yet) —
// passwords are stored as hashPassword() values, not plaintext.
// Hand one email+password pair to each tester. Replace with MongoDB auth later.
const users = [
    { email: "ragnar@vengefulrealms.com",  password: "ZXNkdTJyTldEd0duOnZlbmdlZnVsLXJlYWxtcy1sYXVuY2hlcg==" },
    { email: "freydis@vengefulrealms.com", password: "UVhGV1VKV1FoYnBIOnZlbmdlZnVsLXJlYWxtcy1sYXVuY2hlcg==" },
    { email: "bjorn@vengefulrealms.com",   password: "Ujg2Q05EN0VFZ2ZOOnZlbmdlZnVsLXJlYWxtcy1sYXVuY2hlcg==" },
    { email: "sigrid@vengefulrealms.com",  password: "WVZ6Zk5YVlJHN0Z6OnZlbmdlZnVsLXJlYWxtcy1sYXVuY2hlcg==" },
    { email: "ulfric@vengefulrealms.com",  password: "UnFrcmpxS0hmdm5WOnZlbmdlZnVsLXJlYWxtcy1sYXVuY2hlcg==" },
    { email: "astrid@vengefulrealms.com",  password: "eHhjRmFtN1hXWUFDOnZlbmdlZnVsLXJlYWxtcy1sYXVuY2hlcg==" },
];

let currentUser = null;
let selectedServer = null;
let downloadProgress = 100;

const authModal = document.getElementById("authModal");
const settingsModal = document.getElementById("settingsModal");
const settingsBtn = document.getElementById("settingsBtn");
const loginHeaderBtn = document.getElementById("loginHeaderBtn");
const logoutHeaderBtn = document.getElementById("logoutHeaderBtn");

function triggerLauncherAction(action, payload = {}) {
    console.log("[Vengeful Realms Launcher]", action, payload);

    // TODO: connect this to your launcher executable / backend bridge.
    // Examples:
    // - launch_game: start Skyrim/SkyMP with arguments
    // - check_updates: contact patch server
    // - verify_files: compare local files against manifest
    // - open_folder: open install/mod folder
}

function hashPassword(password) {
    return btoa(`${password}:vengeful-realms-launcher`);
}

function isValidEmail(email) {
    return /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/.test(email);
}

function showToast(message, isError = false) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = isError ? "toast error" : "toast";
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 220);
    }, 2600);
}

function openAuthModal() {
    if (!authModal) return;
    showLoginFormModal();
    authModal.classList.add("show");
    authModal.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
    if (!authModal) return;
    authModal.classList.remove("show");
    authModal.setAttribute("aria-hidden", "true");
    clearAuthInputs();
}

function openSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.add("show");
    settingsModal.setAttribute("aria-hidden", "false");
    populateSettingsForm();
    triggerLauncherAction("open_settings");
}

// ── Mod Organizer 2 settings ──────────────────────────────────────────────────
let mo2Instances = [];

// Saved MO2 selection in the shape the main process handlers expect
function getMO2Opts() {
    if (!launcherSettings?.useMO2 || !launcherSettings?.mo2Exe) return null;
    return {
        enabled: true,
        exe: launcherSettings.mo2Exe,
        instance: launcherSettings.mo2Instance || '',
        profile: launcherSettings.mo2Profile || ''
    };
}

async function populateSettingsForm() {
    if (!launcherSettings) launcherSettings = await window.vgf_functions.loadSettings() || {};

    const gamePathInput = document.getElementById('gamePathInput');
    if (gamePathInput) gamePathInput.value = launcherSettings.gameDir || '';

    const useMO2Check = document.getElementById('useMO2Check');
    const mo2PathInput = document.getElementById('mo2PathInput');
    if (useMO2Check) useMO2Check.checked = !!launcherSettings.useMO2;
    if (mo2PathInput) mo2PathInput.value = launcherSettings.mo2Exe || '';
    toggleMO2Section();
    await refreshMO2Selects(launcherSettings.mo2Instance, launcherSettings.mo2Profile);
}

function toggleMO2Section() {
    const on = document.getElementById('useMO2Check')?.checked;
    const section = document.getElementById('mo2Settings');
    if (section) section.style.display = on ? '' : 'none';
}

// Rebuild the instance dropdown from the MO2 path, keeping saved picks if valid.
// The in-flight promise is tracked so Save can await it instead of reading
// selects that a pending refresh just cleared.
let mo2RefreshPromise = null;

function refreshMO2Selects(preferredInstance, preferredProfile) {
    mo2RefreshPromise = doRefreshMO2Selects(preferredInstance, preferredProfile);
    return mo2RefreshPromise;
}

async function doRefreshMO2Selects(preferredInstance, preferredProfile) {
    const instanceSelect = document.getElementById('mo2InstanceSelect');
    const profileSelect = document.getElementById('mo2ProfileSelect');
    if (!instanceSelect || !profileSelect) return;

    instanceSelect.innerHTML = '';
    profileSelect.innerHTML = '';
    mo2Instances = [];

    const exe = document.getElementById('mo2PathInput')?.value?.trim();
    if (!exe) return;

    try {
        const info = await window.vgf_functions.getMO2Info(exe);
        mo2Instances = info?.instances || [];
    } catch (_) {
        mo2Instances = [];
    }

    for (const inst of mo2Instances) {
        const opt = document.createElement('option');
        opt.value = inst.name;
        const label = inst.portable ? 'Portable (next to ModOrganizer.exe)' : inst.name;
        // Flag instances managing another game so nobody deploys into Fallout
        const isSkyrim = /skyrim/i.test(inst.gameName || '');
        opt.textContent = isSkyrim || !inst.gameName ? label : `${label} (${inst.gameName})`;
        instanceSelect.appendChild(opt);
    }

    const hasPreferred = preferredInstance !== undefined && preferredInstance !== null
        && mo2Instances.some(i => i.name === preferredInstance);
    if (hasPreferred) {
        instanceSelect.value = preferredInstance;
    } else if (preferredInstance) {
        // Keep the saved-but-missing instance selected instead of silently
        // swapping to whatever enumerates first
        const opt = document.createElement('option');
        opt.value = preferredInstance;
        opt.textContent = `${preferredInstance} (not found)`;
        instanceSelect.insertBefore(opt, instanceSelect.firstChild);
        instanceSelect.value = preferredInstance;
    } else {
        // No saved pick: default to the first Skyrim instance if there is one
        const skyrim = mo2Instances.find(i => /skyrim/i.test(i.gameName || ''));
        if (skyrim) instanceSelect.value = skyrim.name;
    }
    populateMO2Profiles(preferredProfile);
}

function populateMO2Profiles(preferredProfile) {
    const instanceSelect = document.getElementById('mo2InstanceSelect');
    const profileSelect = document.getElementById('mo2ProfileSelect');
    if (!instanceSelect || !profileSelect) return;

    profileSelect.innerHTML = '';
    const inst = mo2Instances.find(i => i.name === instanceSelect.value);
    if (!inst) return;

    for (const p of inst.profiles) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        profileSelect.appendChild(opt);
    }
    const preferred = preferredProfile || inst.selectedProfile;
    if (preferred && inst.profiles.includes(preferred)) {
        profileSelect.value = preferred;
    } else if (preferredProfile) {
        // Same rule as instances: surface a missing saved profile, don't swap it
        const opt = document.createElement('option');
        opt.value = preferredProfile;
        opt.textContent = `${preferredProfile} (not found)`;
        profileSelect.insertBefore(opt, profileSelect.firstChild);
        profileSelect.value = preferredProfile;
    }
}

function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.remove("show");
    settingsModal.setAttribute("aria-hidden", "true");
}

function clearAuthInputs() {
    [
        "loginEmailModal",
        "loginPasswordModal",
        "signupEmailModal",
        "signupPasswordModal",
        "signupConfirmModal"
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = "";
    });
}

function showLoginFormModal() {
    const loginForm = document.getElementById("loginFormModal");
    const signupForm = document.getElementById("signupFormModal");
    if (loginForm) loginForm.style.display = "flex";
    if (signupForm) signupForm.style.display = "none";
}

function showSignupFormModal() {
    const loginForm = document.getElementById("loginFormModal");
    const signupForm = document.getElementById("signupFormModal");
    if (loginForm) loginForm.style.display = "none";
    if (signupForm) signupForm.style.display = "flex";
}

function signup(email, password, confirm) {
    const normalisedEmail = email.trim().toLowerCase();

    if (!normalisedEmail || !password || !confirm) {
        showToast("All account fields are required", true);
        return false;
    }

    if (!isValidEmail(normalisedEmail)) {
        showToast("Enter a valid email address", true);
        return false;
    }

    if (password.length < 6) {
        showToast("Password must be at least 6 characters", true);
        return false;
    }

    if (password !== confirm) {
        showToast("Passwords do not match", true);
        return false;
    }

    if (users.some((user) => user.email === normalisedEmail)) {
        showToast("An account with this email already exists", true);
        return false;
    }

    users.push({ email: normalisedEmail, password: hashPassword(password) });
    showToast("Account created. Login to continue");
    triggerLauncherAction("account_created", { email: normalisedEmail });
    return true;
}

function login(email, password, remember = true) {
    const normalisedEmail = email.trim().toLowerCase();

    if (!normalisedEmail || !password) {
        showToast("Enter email and password", true);
        return false;
    }

    if (!isValidEmail(normalisedEmail)) {
        showToast("Enter a valid email address", true);
        return false;
    }

    const hashedInput = hashPassword(password);
    const matched = users.some((user) => user.email === normalisedEmail && user.password === hashedInput);

    if (!matched) {
        showToast("Invalid account details", true);
        return false;
    }

    currentUser = { email: normalisedEmail };
    updateHeaderUI();
    updateReadyState();
    closeAuthModal();
    showToast(`Welcome, ${normalisedEmail.split("@")[0]}`);
    triggerLauncherAction("login", { email: normalisedEmail });

    // Securely store credentials via OS-encrypted safeStorage so the next
    // launch can auto-login with REAL validation (not just trust an email).
    // Pass remember=null from auto-login to skip the persist side-effect.
    if (remember === true) {
        try { window.vgf_functions.saveCredentials(normalisedEmail, password); } catch (_) {}
    } else if (remember === false) {
        try { window.vgf_functions.clearCredentials(); } catch (_) {}
    }
    // remember === null/undefined → don't touch credential storage
    return true;
}

function logout() {
    currentUser = null;
    selectedServer = null;
    updateHeaderUI();
    clearServerSelection();
    updateReadyState();
    showToast("Signed out");
    triggerLauncherAction("logout");
    try { window.vgf_functions.clearCredentials(); } catch (_) {}
}

function updateHeaderUI() {
    const userNameDisplay = document.getElementById("userNameDisplay");
    const userAccessText = document.getElementById("userAccessText");

    if (currentUser) {
        const displayName = currentUser.email.split("@")[0];
        if (userNameDisplay) userNameDisplay.textContent = displayName;
        if (userAccessText) userAccessText.textContent = "Account connected";
        if (loginHeaderBtn) loginHeaderBtn.style.display = "none";
        if (logoutHeaderBtn) logoutHeaderBtn.style.display = "inline-flex";
    } else {
        if (userNameDisplay) userNameDisplay.textContent = "Not signed in";
        if (userAccessText) userAccessText.textContent = "Login required to launch";
        if (loginHeaderBtn) loginHeaderBtn.style.display = "inline-flex";
        if (logoutHeaderBtn) logoutHeaderBtn.style.display = "none";
    }
}

function setupNavigation() {
    const navButtons = document.querySelectorAll(".nav-item");
    const panels = document.querySelectorAll(".section-panel");

    navButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const section = button.dataset.section;
            navButtons.forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
            panels.forEach((panel) => panel.classList.remove("active"));

            const activePanel = document.getElementById(`section-${section}`);
            if (activePanel) activePanel.classList.add("active");
        });
    });
}

function setupServerCards() {
    const serverCards = document.querySelectorAll(".server-card");

    serverCards.forEach((card) => {
        card.addEventListener("click", () => {
            if (card.dataset.serverId === "testing" && !currentUser) {
                showToast("Login required for restricted realms", true);
                openAuthModal();
                return;
            }

            serverCards.forEach((serverCard) => serverCard.classList.remove("selected"));
            card.classList.add("selected");

            selectedServer = {
                id: card.dataset.serverId,
                name: card.dataset.serverName
            };

            const selectedRealmTitle = document.getElementById("selectedRealmTitle");
            const selectedServerInfo = document.getElementById("selectedServerInfo");

            if (selectedRealmTitle) selectedRealmTitle.textContent = selectedServer.name;
            if (selectedServerInfo) selectedServerInfo.textContent = selectedServer.name;

            updateReadyState();
            showToast(`Realm selected: ${selectedServer.name}`);
            triggerLauncherAction("select_realm", selectedServer);
        });
    });
}

function clearServerSelection() {
    document.querySelectorAll(".server-card").forEach((card) => card.classList.remove("selected"));

    const selectedRealmTitle = document.getElementById("selectedRealmTitle");
    const selectedServerInfo = document.getElementById("selectedServerInfo");

    if (selectedRealmTitle) selectedRealmTitle.textContent = "No realm selected";
    if (selectedServerInfo) selectedServerInfo.textContent = "No server selected";
}

function updateReadyState() {
    const joinBtn = document.getElementById("joinGameBtn");
    const readyTitle = document.getElementById("readyStateTitle");
    const readyDescription = document.getElementById("readyStateDescription");
    const ready = Boolean(currentUser && selectedServer && downloadProgress >= 100);

    if (joinBtn) {
        joinBtn.disabled = !ready;
        joinBtn.classList.toggle("enabled", ready);
    }

    if (!currentUser) {
        if (readyTitle) readyTitle.textContent = "Login required";
        if (readyDescription) readyDescription.textContent = "Sign into your Vengeful Realms account before launching.";
        return;
    }

    if (!selectedServer) {
        if (readyTitle) readyTitle.textContent = "Choose a realm";
        if (readyDescription) readyDescription.textContent = "Select a server from the realms screen before launching.";
        return;
    }

    if (downloadProgress < 100) {
        if (readyTitle) readyTitle.textContent = "Updating files";
        if (readyDescription) readyDescription.textContent = "Wait for the mod pack update to finish before launching.";
        return;
    }

    if (readyTitle) readyTitle.textContent = "Ready to launch";
    if (readyDescription) readyDescription.textContent = `Prepared for ${selectedServer.name}.`;
}

function onJoinGame() {
    if (!currentUser) {
        showToast("Login before launching", true);
        openAuthModal();
        return;
    }

    if (!selectedServer) {
        showToast("Select a realm before launching", true);
        setActiveSection("realms");
        return;
    }

    if (downloadProgress < 100) {
        showToast("Update in progress", true);
        setActiveSection("mods");
        return;
    }

    showLaunchDialog();
}

function setActiveSection(section) {
    const navButton = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (navButton) navButton.click();
}

// statusText overrides the mod pack tile, needed for done-but-unhealthy states
function setDownloadProgress(percent, label = "Updating mod pack", statusText = null) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    downloadProgress = value;

    const fill = document.getElementById("downloadProgressFill");
    const percentText = document.getElementById("downloadPercentText");
    const stateLabel = document.getElementById("downloadStateLabel");
    const modpackStatusText = document.getElementById("modpackStatusText");

    if (fill) fill.style.width = `${value}%`;
    if (percentText) percentText.textContent = `${Math.round(value)}%`;
    if (stateLabel) stateLabel.textContent = label;
    if (modpackStatusText) modpackStatusText.textContent = statusText || (value >= 100 ? "Mod Pack Current" : "Update Required");

    updateReadyState();
}

// MO2 mode is on but the exe path was never set, block instead of silently
// falling back to a bare game-folder install that would bypass the user's VFS
function mo2ConfigMissing() {
    if (!launcherSettings?.useMO2 || getMO2Opts()) return false;
    showToast('MO2 mode is on but not configured. Set the ModOrganizer.exe path in Settings.', true);
    openSettingsModal();
    return true;
}

// Real payload verification, offers a repair (reinstall) when files are off
async function runFileVerification() {
    if (!launcherSettings?.gameDir) {
        showToast('Set your Skyrim directory in Settings first.', true);
        openSettingsModal();
        return;
    }
    if (mo2ConfigMissing()) return;

    setActiveSection('mods');
    setDownloadProgress(10, 'Verifying files');
    triggerLauncherAction('verify_files');

    try {
        const mo2 = getMO2Opts();
        const result = await window.vgf_functions.verifyFiles(launcherSettings.gameDir, mo2);
        if (!result.success) {
            setDownloadProgress(100, 'Verification unavailable', 'Not Verified');
            showToast(result.error || 'Verification failed', true);
            return;
        }

        const problems = result.missing.length + result.mismatched.length;
        if (problems === 0) {
            setDownloadProgress(100, `All ${result.checked} files verified`);
            showToast('All files verified');
            return;
        }

        setDownloadProgress(50, `${problems} file(s) need repair`);
        const fix = confirm(
            `File check found problems:\n\n` +
            `Missing: ${result.missing.length}\n` +
            `Mismatched: ${result.mismatched.length}\n\n` +
            `Repair now? This reinstalls the VengefulRealms files.`
        );
        if (!fix) {
            setDownloadProgress(100, `${problems} file(s) still need repair`, 'Repair Needed');
            return;
        }

        setDownloadProgress(75, 'Repairing files');
        const install = await window.vgf_functions.installSkymp(launcherSettings.gameDir, mo2);
        if (!install.success) {
            setDownloadProgress(100, 'Repair failed', 'Repair Needed');
            showToast('Repair failed: ' + (install.error || 'unknown error'), true);
            return;
        }
        setDownloadProgress(100, 'Files repaired and verified');
        showToast(`Repaired ${(install.installed || 0) + (install.overwritten || 0)} file(s)`);
    } catch (err) {
        // Never leave the progress gate stuck below 100 on an unexpected error
        setDownloadProgress(100, 'Verification error', 'Not Verified');
        showToast('Verification error: ' + (err?.message || err), true);
    }
}

function setupButtons() {
    const loginBtnModal = document.getElementById("loginBtnModal");
    const signupBtnModal = document.getElementById("signupBtnModal");
    const showSignupBtnModal = document.getElementById("showSignupBtnModal");
    const showLoginBtnModal = document.getElementById("showLoginBtnModal");
    const closeAuthModalBtn = document.getElementById("closeAuthModalBtn");
    const closeSettingsModalBtn = document.getElementById("closeSettingsModalBtn");
    const joinBtn = document.getElementById("joinGameBtn");
    const checkUpdatesBtn = document.getElementById("checkUpdatesBtn");
    const repairBtn = document.getElementById("repairBtn");
    const openFolderBtn = document.getElementById("openFolderBtn");
    const saveSettingsBtn = document.getElementById("saveSettingsBtn");
    const resetSettingsBtn = document.getElementById("resetSettingsBtn");

    if (loginHeaderBtn) loginHeaderBtn.addEventListener("click", openAuthModal);
    if (logoutHeaderBtn) logoutHeaderBtn.addEventListener("click", logout);
    if (settingsBtn) settingsBtn.addEventListener("click", openSettingsModal);
    if (closeAuthModalBtn) closeAuthModalBtn.addEventListener("click", closeAuthModal);
    if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener("click", closeSettingsModal);
    if (showSignupBtnModal) showSignupBtnModal.addEventListener("click", showSignupFormModal);
    if (showLoginBtnModal) showLoginBtnModal.addEventListener("click", showLoginFormModal);
    if (joinBtn) joinBtn.addEventListener("click", onJoinGame);
    if (checkUpdatesBtn) checkUpdatesBtn.addEventListener("click", runFileVerification);
    if (repairBtn) repairBtn.addEventListener("click", runFileVerification);

    if (openFolderBtn) {
        openFolderBtn.addEventListener("click", () => {
            showToast("Folder action sent to backend");
            triggerLauncherAction("open_folder");
        });
    }

    const uninstallBtn = document.getElementById("uninstallBtn");
    if (uninstallBtn) {
        uninstallBtn.addEventListener("click", async () => {
            if (!launcherSettings?.gameDir) {
                showToast('Game directory not set.', true);
                return;
            }
            const confirmed = confirm(
                'This will remove every file the launcher installed into your Skyrim folder, ' +
                'restoring it to its pre-launcher state. Your vanilla game and any other mods ' +
                'are NOT touched.\n\nContinue?'
            );
            if (!confirmed) return;
            showToast('Removing VGR files…');
            const result = await window.vgf_functions.uninstallSkymp(launcherSettings.gameDir);
            if (result.success) {
                const msg = `Uninstalled — ${result.removed} item(s) removed` +
                    (result.missing ? `, ${result.missing} already absent` : '');
                showToast(msg);
            } else if (result.error && !(result.errors || []).length) {
                // Precondition failure (e.g. MO2 still running), nothing was removed
                showToast(result.error, true);
            } else {
                // Loud, blocking dialog instead of an easy-to-miss toast.
                // Lists exactly what couldn't be removed so the user can act.
                const failed = (result.errors || []);
                const shownFailures = failed.slice(0, 8).map(e => `• ${e}`).join('\n');
                const moreCount = Math.max(0, failed.length - 8);
                const summary =
                    `Uninstall partially failed.\n\n` +
                    `Removed: ${result.removed || 0} item(s)\n` +
                    `Could NOT remove: ${failed.length} item(s)\n\n` +
                    `Cause is usually a Windows file lock (the launcher itself, an open ` +
                    `Explorer window into your Skyrim folder, or antivirus scanning a file).\n\n` +
                    `What didn't get removed:\n${shownFailures}` +
                    (moreCount > 0 ? `\n... and ${moreCount} more` : '') +
                    `\n\nFix: close the launcher and any Explorer windows showing your ` +
                    `Skyrim folder, then click "Uninstall VGR Files" again. ` +
                    `Or delete the listed paths manually.`;
                alert(summary);
                // Also keep a toast so it doesn't get fully lost if they dismiss the alert too quickly
                showToast(`Uninstall partial — ${failed.length} item(s) could not be removed`, true);
            }
        });
    }

    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener("click", async () => {
            // A path edit right before the click clears the selects and refills
            // them async, wait for that refresh before reading their values
            if (mo2RefreshPromise) {
                try { await mo2RefreshPromise; } catch (_) {}
            }
            launcherSettings = launcherSettings || {};
            launcherSettings.gameDir = document.getElementById("gamePathInput")?.value?.trim() || "";
            launcherSettings.profileID = launcherSettings.profileID || 1;
            launcherSettings.serverIP = launcherSettings.serverIP || '141.195.99.135';
            launcherSettings.useMO2 = !!document.getElementById('useMO2Check')?.checked;
            launcherSettings.mo2Exe = document.getElementById('mo2PathInput')?.value?.trim() || '';
            if (launcherSettings.useMO2 && !launcherSettings.mo2Exe) {
                showToast('Set the ModOrganizer.exe path or turn MO2 mode off', true);
                return;
            }
            // Only overwrite the saved instance/profile when we actually found
            // instances, a failed enumeration must not turn a named instance
            // into an empty (portable) one
            if (mo2Instances.length > 0) {
                launcherSettings.mo2Instance = document.getElementById('mo2InstanceSelect')?.value || '';
                launcherSettings.mo2Profile = document.getElementById('mo2ProfileSelect')?.value || '';
            }
            // Full-object save keeps MO2 fields, wizardComplete, and credentials intact
            window.vgf_functions.saveFullSettings(launcherSettings);
            showToast("Settings saved");
            closeSettingsModal();
        });
    }

    // MO2 settings controls
    const useMO2Check = document.getElementById('useMO2Check');
    if (useMO2Check) useMO2Check.addEventListener('change', toggleMO2Section);

    const mo2DetectBtn = document.getElementById('mo2DetectBtn');
    if (mo2DetectBtn) {
        mo2DetectBtn.addEventListener('click', async () => {
            const found = await window.vgf_functions.detectMO2();
            if (found) {
                const mo2PathInput = document.getElementById('mo2PathInput');
                if (mo2PathInput) mo2PathInput.value = found;
                await refreshMO2Selects();
                showToast('Mod Organizer 2 found');
            } else {
                showToast('MO2 not found, set the path manually', true);
            }
        });
    }

    const mo2BrowseBtn = document.getElementById('mo2BrowseBtn');
    if (mo2BrowseBtn) {
        mo2BrowseBtn.addEventListener('click', async () => {
            const chosen = await window.vgf_functions.browseFile([{ name: 'ModOrganizer', extensions: ['exe'] }]);
            if (chosen) {
                const mo2PathInput = document.getElementById('mo2PathInput');
                if (mo2PathInput) mo2PathInput.value = chosen;
                await refreshMO2Selects();
            }
        });
    }

    const mo2PathInput = document.getElementById('mo2PathInput');
    if (mo2PathInput) {
        // Keep the saved picks selected when the path is edited
        mo2PathInput.addEventListener('change', () =>
            refreshMO2Selects(launcherSettings?.mo2Instance, launcherSettings?.mo2Profile));
    }

    const mo2InstanceSelect = document.getElementById('mo2InstanceSelect');
    if (mo2InstanceSelect) mo2InstanceSelect.addEventListener('change', () => populateMO2Profiles());

    const browseBtn = document.getElementById("browseFolderBtn");
    if (browseBtn) {
        browseBtn.addEventListener("click", async () => {
            const chosen = await window.vgf_functions.browseFolder();
            if (chosen) {
                const gamePathInput = document.getElementById("gamePathInput");
                if (gamePathInput) gamePathInput.value = chosen;
            }
        });
    }

    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener("click", () => {
            const launchArgsInput = document.getElementById("launchArgsInput");
            if (launchArgsInput) launchArgsInput.value = "-vrp -noborder";
            showToast("Settings reset");
        });
    }

    if (loginBtnModal) {
        loginBtnModal.addEventListener("click", () => {
            login(
                document.getElementById("loginEmailModal")?.value || "",
                document.getElementById("loginPasswordModal")?.value || "",
                document.getElementById("rememberMeModal")?.checked ?? true
            );
        });
    }

    if (signupBtnModal) {
        signupBtnModal.addEventListener("click", () => {
            const created = signup(
                document.getElementById("signupEmailModal")?.value || "",
                document.getElementById("signupPasswordModal")?.value || "",
                document.getElementById("signupConfirmModal")?.value || ""
            );

            if (created) {
                clearAuthInputs();
                showLoginFormModal();
            }
        });
    }

    [authModal, settingsModal].forEach((modal) => {
        if (!modal) return;
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                modal === authModal ? closeAuthModal() : closeSettingsModal();
            }
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeAuthModal();
            closeSettingsModal();
        }

        if (event.key === "Enter" && authModal?.classList.contains("show")) {
            const signupVisible = document.getElementById("signupFormModal")?.style.display !== "none";
            if (signupVisible) {
                signupBtnModal?.click();
            } else {
                loginBtnModal?.click();
            }
        }
    });
}

function initLauncher() {
    setupNavigation();
    setupServerCards();
    setupButtons();
    updateHeaderUI();
    setDownloadProgress(100, "Files verified and ready");
    updateReadyState();
    loadLauncherSettings();

    setTimeout(() => {
        if (!currentUser) showToast("Sign in with your Vengeful Realms beta credentials");
    }, 700);
}

// Hide launcher shell until wizard completes, then run wizard
document.getElementById('launcherShell').style.display = 'none';
runWizard().then(() => initLauncher());

window.VengefulLauncher = {
    setDownloadProgress,
    setActiveSection,
    selectServer(serverId) {
        const card = document.querySelector(`.server-card[data-server-id="${serverId}"]`);
        if (card) card.click();
    },
    setUser(email) {
        currentUser = email ? { email } : null;
        updateHeaderUI();
        updateReadyState();
    },
    triggerLauncherAction
};

let promptResolve = null;

function showPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        promptResolve = resolve;
        document.getElementById('promptTitle').innerText = message;
        document.getElementById('promptInput').value = defaultValue;
        document.getElementById('promptModal').style.display = 'block';
        document.getElementById('promptOverlay').style.display = 'block';
        document.getElementById('promptInput').focus();
    });
}

function resolvePrompt() {
    const value = document.getElementById('promptInput').value;
    document.getElementById('promptModal').style.display = 'none';
    document.getElementById('promptOverlay').style.display = 'none';
    if (promptResolve) promptResolve(value);
}

function rejectPrompt() {
    document.getElementById('promptModal').style.display = 'none';
    document.getElementById('promptOverlay').style.display = 'none';
    if (promptResolve) promptResolve(null);
}

// ── Setup Wizard ──────────────────────────────────────────────────────────────
function openExternal(url) {
    // Electron opens links via shell — wired through preload if needed, safe default
    window.open(url);
}

async function runWizard() {
    const backdrop    = document.getElementById('wizardBackdrop');
    const continueBtn = document.getElementById('wizContinueBtn');
    const noteEl      = document.getElementById('wizardNote');
    const pathBtn     = document.getElementById('wizBrowseBtn');
    const pathLabel   = document.getElementById('wizGamePath');

    // Load or detect game directory
    let settings = await window.vgf_functions.loadSettings();
    let gameDir = settings?.gameDir || '';
    if (!gameDir) {
        gameDir = await window.vgf_functions.findSkyrim() || '';
        // Save detected path immediately so it persists
        if (gameDir) {
            settings = settings || { profileID: 1, serverIP: '141.195.99.135' };
            settings.gameDir = gameDir;
            window.vgf_functions.saveFullSettings(settings);
        }
    }
    pathLabel.textContent = gameDir || 'Not found — click to browse';

    // Skip wizard if already verified and all prerequisites still valid
    if (settings?.wizardComplete && gameDir) {
        const checks = await window.vgf_functions.checkPrerequisites(gameDir);
        if (checks.skyrim.ok && checks.skse.ok && checks.skymp.ok) {
            backdrop.classList.add('hidden');
            document.getElementById('launcherShell').style.display = '';
            return;
        }
        // Something changed — fall through to show wizard again
    }

    async function runChecks() {
        if (!gameDir) {
            setRow('skyrim', false, 'Not found — click Browse below');
            setRow('skse',   false, 'Skyrim path required first');
            setRow('skymp',  false, 'Skyrim path required first');
            continueBtn.disabled = true;
            return;
        }

        const checks = await window.vgf_functions.checkPrerequisites(gameDir);

        // Skyrim
        setRow('skyrim', checks.skyrim.ok,
            checks.skyrim.ok ? `Detected — ${gameDir}` : 'SkyrimSE.exe not found in selected folder');

        // SKSE64
        const skseText = checks.skse.ok
            ? `Detected — version ${checks.skse.version} (build 2.2.6)`
            : 'Not found — download and place 3 files in your Skyrim folder';
        setRow('skse', checks.skse.ok, skseText);
        document.getElementById('wiz-skse-link').style.display = checks.skse.ok ? 'none' : 'inline-block';

        // SkyMP
        setRow('skymp', checks.skymp.ok,
            checks.skymp.ok ? 'VengefulRealms files detected' : 'Will be installed automatically on first launch');

        // Note if SKSE missing
        if (!checks.skse.ok) {
            noteEl.style.display = 'block';
            noteEl.textContent = 'SKSE64 is required. Download it from skse.silverlock.org, then extract skse64_loader.exe, skse64_1_6_1170.dll, and skse64_steam_loader.dll into your Skyrim Special Edition folder.';
        } else {
            noteEl.style.display = 'none';
        }

        const canContinue = checks.skyrim.ok && checks.skse.ok;
        continueBtn.disabled = !canContinue;
    }

    function setRow(key, ok, text) {
        const row  = document.getElementById(`wiz-${key}`);
        const icon = document.getElementById(`wiz-${key}-icon`);
        const span = document.getElementById(`wiz-${key}-text`);
        row.className  = `wizard-row ${ok ? 'ok' : 'error'}`;
        icon.textContent = ok ? '✅' : '❌';
        span.textContent = text;
    }

    // Browse button
    pathBtn.addEventListener('click', async () => {
        const chosen = await window.vgf_functions.browseFolder();
        if (chosen) {
            gameDir = chosen;
            pathLabel.textContent = gameDir;
            await runChecks();
        }
    });

    // Continue button
    continueBtn.addEventListener('click', () => {
        if (settings) {
            settings.gameDir = gameDir;
            settings.wizardComplete = true;
        } else {
            settings = { gameDir, profileID: 1, serverIP: '141.195.99.135', wizardComplete: true };
        }
        window.vgf_functions.saveSettings(settings.gameDir, settings.profileID, settings.serverIP);
        // Save wizardComplete flag separately since saveSettings only takes 3 args
        window.vgf_functions.saveFullSettings(settings);
        backdrop.classList.add('hidden');
        document.getElementById('launcherShell').style.display = '';
    });

    await runChecks();
}

// ── Launcher state ────────────────────────────────────────────────────────────
let launcherSettings = null;

async function loadLauncherSettings() {
    launcherSettings = await window.vgf_functions.loadSettings();

    if (!launcherSettings) {
        // First run: try to auto-detect Skyrim
        const found = await window.vgf_functions.findSkyrim();
        launcherSettings = {
            gameDir:   found || '',
            profileID: 1,
            serverIP:  '141.195.99.135'
        };
    }

    const gamePathInput = document.getElementById('gamePathInput');
    if (gamePathInput && launcherSettings.gameDir) {
        gamePathInput.value = launcherSettings.gameDir;
    }

    if (launcherSettings.gameDir) {
        const clientStatusText = document.getElementById('clientStatusText');
        if (clientStatusText) clientStatusText.textContent = 'Skyrim SE detected';
    } else {
        const clientStatusText = document.getElementById('clientStatusText');
        if (clientStatusText) clientStatusText.textContent = 'Skyrim not found — open Settings';
        showToast('Skyrim not found. Open Settings to set the path.', true);
    }

    // Auto-login: try the OS-encrypted credential blob first (real validation),
    // then fall back to the old email-only behavior for older settings files.
    if (!currentUser) {
        try {
            const creds = await window.vgf_functions.loadCredentials();
            if (creds && creds.ok && creds.email && creds.password) {
                // Re-run normal login() so the credential is actually validated
                // (matches an entry in the users array). `null` = don't touch storage.
                login(creds.email, creds.password, null);
            } else if (launcherSettings.rememberedEmail) {
                // Legacy fallback: pre-credential settings only had the email.
                currentUser = { email: launcherSettings.rememberedEmail };
                updateHeaderUI();
                updateReadyState();
                showToast(`Welcome back, ${launcherSettings.rememberedEmail.split("@")[0]}`);
            }
        } catch (_) { /* swallow — leave as not-signed-in */ }
    }
}

async function showLaunchDialog() {
    if (!launcherSettings) {
        launcherSettings = await window.vgf_functions.loadSettings();
    }

    if (!launcherSettings?.gameDir) {
        showToast('Set your Skyrim directory in Settings first.', true);
        openSettingsModal();
        return;
    }
    if (mo2ConfigMissing()) return;

    const profileID = await showPrompt('Enter your Profile ID (any unique number):', String(launcherSettings.profileID || ''));
    if (!profileID) return;

    const idNum = parseInt(profileID, 10);
    if (isNaN(idNum) || idNum <= 0) {
        showToast('Profile ID must be a positive whole number.', true);
        return;
    }

    // Save updated settings
    launcherSettings.profileID = idNum;
    window.vgf_functions.saveSettings(launcherSettings.gameDir, idNum, launcherSettings.serverIP);

    const mo2 = getMO2Opts();

    // Install SkyMP files (game folder, or MO2 mod folder when MO2 mode is on)
    showToast('Installing SkyMP files…');
    const skymp = await window.vgf_functions.installSkymp(launcherSettings.gameDir, mo2);
    if (!skymp.success) {
        showToast('SkyMP install failed: ' + (skymp.error || 'unknown error'), true);
        return;
    }

    // Write skymp5-client-settings.txt and clean conflicting files
    showToast('Preparing game files…');
    const result = await window.vgf_functions.updateClientCfg(launcherSettings.gameDir, idNum, launcherSettings.serverIP, currentUser?.email || null, mo2);

    if (!result.success) {
        showToast(result.error || 'Setup failed.', true);
        return;
    }

    // MO2 mode hands SKSE off to ModOrganizer so the VFS modlist is active
    if (mo2) {
        showToast(`Launching through MO2, profile ${idNum}`);
        const launch = await window.vgf_functions.launchMO2(launcherSettings.gameDir, mo2);
        if (!launch.success) {
            showToast('Launch failed: ' + (launch.error || 'unknown error'), true);
        }
        return;
    }

    const exePath = launcherSettings.gameDir.replace(/\\/g, '/') + '/skse64_loader.exe';
    showToast(`Launching — profile ${idNum}`);

    const launch = await window.vgf_functions.launchGame(exePath.replace(/\//g, '\\'));
    if (!launch.success) {
        showToast('Launch failed: ' + (launch.error || 'unknown error'), true);
    }
}