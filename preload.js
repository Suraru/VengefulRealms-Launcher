const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vgf_functions', {
    loadSettings:    ()                          => ipcRenderer.invoke('load-settings'),
    saveSettings:     (gameDir, profileID, serverIP) => ipcRenderer.send('save-settings', { gameDir, profileID, serverIP }),
    saveFullSettings: (settings)                     => ipcRenderer.send('save-full-settings', settings),
    findSkyrim:      ()                          => ipcRenderer.invoke('find-skyrim'),
    browseFolder:    ()                          => ipcRenderer.invoke('browse-folder'),
    checkPrerequisites: (gameDir)                       => ipcRenderer.invoke('check-prerequisites', gameDir),
    installSkymp:    (gameDir)                          => ipcRenderer.invoke('install-skymp', gameDir),
    uninstallSkymp:  (gameDir)                          => ipcRenderer.invoke('uninstall-skymp', gameDir),
    updateClientCfg: (gameDir, profileID, serverIP) => ipcRenderer.invoke('update-client-cfg', { gameDir, profileID, serverIP }),
    launchGame:      (exePath)                   => ipcRenderer.invoke('launch-game', exePath),
    saveCredentials:  (email, password)          => ipcRenderer.invoke('save-credentials', { email, password }),
    loadCredentials:  ()                         => ipcRenderer.invoke('load-credentials'),
    clearCredentials: ()                         => ipcRenderer.invoke('clear-credentials'),
});
