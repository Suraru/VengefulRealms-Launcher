VENGEFUL REALMS - PROFESSIONAL GAME LAUNCHER UI

Files included:
- index.html
- style.css
- script.js
- assets/icons/*.svg

Style:
- Skyrim-inspired dark translucent layout
- Gold/bronze borders
- Deep red active accents
- Custom SVG fantasy icons
- No external libraries
- No emoji-based icons
- Fully frontend-ready HTML, CSS, and vanilla JavaScript

Demo login:
Email: demo@vengeful.com
Password: demo123

Main backend hook:
script.js contains:

function triggerLauncherAction(action, payload = {}) {
    console.log("[Vengeful Realms Launcher]", action, payload);

    // TODO: connect this to your launcher executable / backend bridge.
}

Recommended actions to connect later:
- launch_game
- check_updates
- verify_files
- open_folder
- save_settings
- select_realm
- login
- logout

Public frontend API:
window.VengefulLauncher.setDownloadProgress(percent, label)
window.VengefulLauncher.setActiveSection(section)
window.VengefulLauncher.selectServer(serverId)
window.VengefulLauncher.setUser(email)
window.VengefulLauncher.triggerLauncherAction(action, payload)

Notes:
- This is a polished launcher UI prototype built from the uploaded launcher files.
- It does not launch Skyrim by itself until connected to an executable backend, Electron/Tauri bridge, or native launcher logic.
- All icons are transparent SVGs and can be replaced inside assets/icons.
