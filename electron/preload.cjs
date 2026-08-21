const { contextBridge } = require("electron");

// Minimal bridge: the renderer only needs to know it's running inside the desktop app and
// which platform it's on (used for small UI touches like showing "Desktop" in the MIDI
// panel). No filesystem, network, or Node APIs are exposed — Web MIDI works natively in the
// renderer via Chromium, so no IPC round-trip is needed for anything audio- or MIDI-related.
// `process` here is the limited, preload-scoped global Electron provides — not something
// imported from the "electron" module itself.
contextBridge.exposeInMainWorld("glockworkDesktop", {
  isElectron: true,
  platform: process.platform,
});
