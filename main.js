// Electron entry: starts the local API on a random localhost port and opens the app window.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { start } = require('./server/app');

const preload = path.join(__dirname, 'preload.js');
let mainWindow = null;
let baseUrl = null;

function log(...args) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'brightloop.log'), `[${new Date().toISOString()}] ${args.join(' ')}\n`); } catch (e) { /* ignore */ }
}
// Notifications are logged to the console as well as the in-app inbox; keep a copy on disk for the packaged build.
const origLog = console.log;
console.log = (...a) => { origLog(...a); log(...a); };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600, backgroundColor: '#0b0b10', show: false,
    title: 'LensUS',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Invoice print views open in child windows that also get the PDF bridge; anything external goes to the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 1000, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { preload, contextIsolation: true, sandbox: true } } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(baseUrl);
}

ipcMain.handle('save-pdf', async (event, suggested) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), String(suggested || 'invoice.pdf').replace(/[\\/:*?"<>|]/g, '-')),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false };
  const pdf = await event.sender.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
  fs.writeFileSync(filePath, pdf);
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [
        { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' }, { role: 'quit' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    ]));
    try {
      const { port, file } = await start({ dataDir: app.getPath('userData') });
      baseUrl = `http://127.0.0.1:${port}/`;
      log('API listening on', baseUrl, 'database', file);
      createWindow();
    } catch (e) {
      log('Startup failed:', e.stack || e.message);
      dialog.showErrorBox('LensUS could not start', String(e.stack || e.message));
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
