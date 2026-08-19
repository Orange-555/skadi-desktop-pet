const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petBridge", {
  moveWindow: (dx, dy) => ipcRenderer.send("pet:move", { dx, dy }),
  dragStart: (sx, sy) => ipcRenderer.send("pet:drag-start", { sx, sy }),
  dragTo: (sx, sy) => ipcRenderer.send("pet:drag-move", { sx, sy }),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  setAlwaysTop: (v) => ipcRenderer.send("pet:set-always-top", v),
  quit: () => ipcRenderer.send("pet:quit"),
  setTrayState: (s) => ipcRenderer.send("pet:set-tray", s),
  onTrayAction: (cb) => ipcRenderer.on("tray:action", (_e, msg) => cb(msg)),
  getState: () => ipcRenderer.invoke("pet:get-state"),
  getVisible: () => ipcRenderer.invoke("pet:get-visible"),
  getBalance: () => ipcRenderer.invoke("pet:get-balance"),
  onBalance: (cb) => ipcRenderer.on("pet:balance", (_e, d) => cb(d)),
  setWindowBounds: (b) => ipcRenderer.send("pet:set-bounds", b),
  openDialog: () => ipcRenderer.send("pet:open-dialog"),
  onPlayRandom: (cb) => ipcRenderer.on("pet:play-random", () => cb()),
  onWalk: (cb) => ipcRenderer.on("pet:walk", (_e, m) => cb(m)),
  dialogAction: (type) => ipcRenderer.send("pet:dialog-action", type),
  onReady: () => ipcRenderer.send("pet:ready"),
});
