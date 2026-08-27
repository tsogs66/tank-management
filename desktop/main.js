/**
 * Tank Chief — desktop wrapper.
 *
 * The whole application already runs as a small Express server with a browser
 * front end, and it stays that way here: this process starts that same server
 * on the loopback interface and points a window at it. Nothing is rewritten
 * for the desktop, so there is one codebase to fix a sounding table in, and
 * the installed build behaves exactly like the hosted one.
 *
 * Nothing leaves the machine. The server binds to 127.0.0.1 on a port the
 * operating system picks, so it is not reachable from the network and does not
 * collide with anything already running. Going online is a deliberate act by
 * the user — the sync URL in Settings — and never a condition of the program
 * working.
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');

/* Vessel files belong to the user, not to the installation. An installed build
   lives under Program Files, which the user who runs it cannot write to, so the
   data directory is set before the server module is loaded and reads it. */
const DATA_DIR = path.join(app.getPath('userData'), 'data');

/* The application was called something else once, and this folder is named
   after the application. Renaming it would leave an existing installation's
   vessels behind in the old folder, looking to the user as though the records
   had been lost. If the new folder is empty and the old one is not, carry them
   across — once, and only in that direction, so this can never overwrite a
   database somebody is already using. */
function carryOverOldData() {
  const previous = path.join(path.dirname(app.getPath('userData')),
    'vessel-fuel-tank-management', 'data');
  try {
    if (!fs.existsSync(previous)) return;
    if (fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length) return;
    fs.cpSync(previous, DATA_DIR, { recursive: true });
    console.log(`Carried previous vessel records over from ${previous}`);
  } catch (err) {
    // Not fatal: the application still starts, and the old folder is untouched
    // and can be copied across by hand.
    console.warn(`Could not carry over the previous data folder: ${err.message}`);
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
carryOverOldData();
process.env.TMS_DATA_DIR = DATA_DIR;

/* Python and Tesseract ship inside the installer for the PDF and spreadsheet
   importers. Point the resolver at them before anything tries to spawn one, so
   a machine with no Python of its own still imports a calibration book. */
if (app.isPackaged) {
  const bundled = path.join(process.resourcesPath, 'runtime');
  if (fs.existsSync(bundled)) {
    process.env.TMS_PYTHON_HOME = bundled;
    process.env.PATH = [
      path.join(bundled, 'python'),
      path.join(bundled, 'python', 'Scripts'),
      path.join(bundled, 'tesseract'),
      process.env.PATH || '',
    ].join(path.delimiter);
  }
}

let win = null;
let httpServer = null;

async function boot() {
  const { start } = require('../server/index.js');
  const started = await start({ port: 0, host: '127.0.0.1' });
  httpServer = started.server;
  return `http://127.0.0.1:${started.port}/`;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b1220',
    show: false,
    title: 'Tank Chief',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      // The page is our own, served from loopback, and needs no privileged
      // bridge — it talks to the server over HTTP exactly as in a browser.
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(url);

  // Anything aiming off the application opens in the real browser rather than
  // in a chromeless window with no address bar.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function buildMenu(url) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open data folder',
          click: () => shell.openPath(DATA_DIR),
        },
        {
          label: 'Open in browser',
          click: () => shell.openExternal(url),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
        { type: 'separator' }, { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'Tank Chief',
            message: `Tank Chief ${app.getVersion()}`,
            detail: 'ts0gs \u2014 Marvin C. Endozo\n\n'
              + 'Runs entirely on this computer. Nothing is sent anywhere unless a sync '
              + `server is set in Settings.\n\nData folder:\n${DATA_DIR}\n\nServing on ${url}`,
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window. A second launch raises the one already open rather than starting
// a second server over the same vessel files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    try {
      const url = await boot();
      buildMenu(url);
      createWindow(url);
    } catch (err) {
      dialog.showErrorBox('Could not start',
        `The application could not start its local server.\n\n${err && err.message}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (httpServer) httpServer.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
