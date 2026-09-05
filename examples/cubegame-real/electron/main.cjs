const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

function resolveDistIndex() {
  const candidates = [
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(process.resourcesPath || '', 'dist', 'index.html'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist', 'index.html'),
    path.join(process.resourcesPath || '', 'app', 'dist', 'index.html'),
  ];
  return candidates.find(candidate => candidate && fsSync.existsSync(candidate));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    title: 'CubeGame',
    backgroundColor: '#05070a',
    fullscreenable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true,
      webSecurity: false,          // allow file:// cross-origin asset loading
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });

  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Pointer Lock and fullscreen are core gameplay permissions for first-person 3D.
  // Grant them for our own packaged file:// app so the desktop build behaves like the browser version.
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = webContents === win.webContents && ['pointerLock', 'fullscreen', 'keyboardLock'].includes(permission);
    callback(allowed);
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const prefix = level >= 2 ? '[CubeGame renderer error]' : '[CubeGame renderer]';
    console.log(`${prefix} ${message} (${sourceId}:${line})`);
  });

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error(`[CubeGame] Failed to load ${url}: ${code} ${desc}`);
    // Retry once on common transient errors
    if (code === -6 || code === -102 || code === -105) {
      setTimeout(() => {
        const retryPath = resolveDistIndex();
        if (retryPath) win.loadFile(retryPath, { query: { native: '1', host: 'electron' } });
      }, 800);
    }
  });

  win.webContents.on('did-finish-load', () => {
    // If the renderer bundle fails before it can draw diagnostics, make the
    // splash itself report the last known boot stage instead of looking frozen.
    setTimeout(() => {
      if (win.isDestroyed()) return;
      win.webContents.executeJavaScript(`
        (function(){
          if (window.cubeGameAppReady === true) return;
          if (typeof window.cubeGameSetBootStatus === 'function') {
            window.cubeGameSetBootStatus('Still booting CubeGame desktop...\nStage: ' + (window.cubeGameBootStage || 'renderer did-finish-load') + '\nOpen the terminal that ran make mac for renderer errors.');
          }
        })();
      `).catch(() => {});
    }, 6500);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[CubeGame] Renderer process gone:', details.reason);
    if (details.reason !== 'clean-exit') {
      createWindow();
    }
  });

  win.webContents.on('before-input-event', (event, input) => {
    // Keep browser-like app shortcuts from stealing gameplay inputs.
    if ((input.control || input.meta) && ['W', 'R'].includes(String(input.key).toUpperCase())) {
      event.preventDefault();
    }
  });

  const indexPath = resolveDistIndex();
  if (!indexPath) {
    const html = '<!doctype html><html><body style="font-family:monospace;background:#111;color:#eee;padding:24px"><h1>CubeGame desktop build is missing dist/index.html</h1><p>Run <code>rm -rf dist build/mac && npm install && make mac</code> from the project folder.</p></body></html>';
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return;
  }
  console.log(`[CubeGame] Loading desktop UI from ${indexPath}`);
  win.loadFile(indexPath, { query: { native: '1', host: 'electron' } });
}

app.commandLine.appendSwitch('enable-features', 'WebGPU,Vulkan');
app.commandLine.appendSwitch('enable-pointer-lock-options');
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('cubegame:listMods', async () => {
  const modsDir = path.join(app.getPath('userData'), 'mods');
  await fs.mkdir(modsDir, { recursive: true });
  const entries = await fs.readdir(modsDir, { withFileTypes: true }).catch(() => []);
  return { version: 1, generatedAt: Date.now(), mods: entries.filter(e => e.isDirectory()).map(e => ({ name: e.name, files: [], hasAssets: false, source: 'electron-userData' })) };
});
