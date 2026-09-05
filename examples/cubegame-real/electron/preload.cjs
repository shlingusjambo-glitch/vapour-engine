const { contextBridge, ipcRenderer } = require('electron');
const os = require('node:os');

function platformName() {
  if (process.platform === 'win32') return 'Windows';
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'linux') return 'Linux';
  return os.platform();
}

contextBridge.exposeInMainWorld('CubeGameNative', {
  platform: platformName(),
  host: 'native',
  rendererBackend: 'webgpu',
  listMods: () => ipcRenderer.invoke('cubegame:listMods'),
});
