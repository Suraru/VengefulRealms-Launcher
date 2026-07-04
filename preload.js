const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vgf_functions', {
    loadSettings:    ()                          => ipcRenderer.invoke('load-settings'),
    saveSettings:     (gameDir, profileID, serverIP) => ipcRenderer.send('save-settings', { gameDir, profileID, serverIP }),
    saveFullSettings: (settings)                     => ipcRenderer.send('save-full-settings', settings),
    findSkyrim:      ()                          => ipcRenderer.invoke('find-skyrim'),
    browseFolder:    ()                          => ipcRenderer.invoke('browse-folder'),
    checkPrerequisites: (gameDir)                       => ipcRenderer.invoke('check-prerequisites', gameDir),
    installSkymp:    (gameDir, mo2)                     => ipcRenderer.invoke('install-skymp', { gameDir, mo2 }),
    uninstallSkymp:  (gameDir)                          => ipcRenderer.invoke('uninstall-skymp', gameDir),
    verifyFiles:     (gameDir, mo2)                     => ipcRenderer.invoke('verify-files', { gameDir, mo2 }),
    updateClientCfg: (gameDir, profileID, serverIP, email, mo2) => ipcRenderer.invoke('update-client-cfg', { gameDir, profileID, serverIP, email, mo2 }),
    launchGame:      (exePath)                   => ipcRenderer.invoke('launch-game', exePath),
    detectMO2:       ()                          => ipcRenderer.invoke('detect-mo2'),
    getMO2Info:      (mo2Exe)                    => ipcRenderer.invoke('mo2-info', mo2Exe),
    launchMO2:       (gameDir, mo2)              => ipcRenderer.invoke('launch-mo2', { gameDir, mo2 }),
    browseFile:      (filters)                   => ipcRenderer.invoke('browse-file', filters),
    saveCredentials:  (email, password)          => ipcRenderer.invoke('save-credentials', { email, password }),
    loadCredentials:  ()                         => ipcRenderer.invoke('load-credentials'),
    clearCredentials: ()                         => ipcRenderer.invoke('clear-credentials'),
});
