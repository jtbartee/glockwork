const { app, BrowserWindow, session, shell } = require("electron");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_START_URL);
const START_URL = process.env.ELECTRON_START_URL;

// Only these permissions are ever relevant to a browser-based synthesizer: MIDI access for
// external controllers. Everything else (camera, mic, geolocation, notifications, clipboard
// read, etc.) is denied outright.
// Electron's actual permission identifiers are camelCase ("midiSysex", not "midi-sysex") —
// Chromium asks for "midiSysex" for Web MIDI access in general, even when the page requests
// {sysex: false}, so both must be allowed or requestMIDIAccess() is rejected outright.
const ALLOWED_PERMISSIONS = new Set(["midi", "midiSysex"]);

function configureSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSIONS.has(permission));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1040,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#241812",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Never let the renderer navigate to arbitrary/remote content, and never let it spawn
  // new windows — external links (none currently in-app) open in the OS browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev ? new URL(START_URL).origin === new URL(url).origin : url.startsWith("file://") && url.includes(path.join(__dirname, "..", "dist"));
    if (!allowed) event.preventDefault();
  });

  if (isDev) {
    void win.loadURL(START_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  configureSession();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Defense in depth alongside the per-window setWindowOpenHandler above.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
