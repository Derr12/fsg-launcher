const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  settingsGet: () => ipcRenderer.invoke("settings:get"),
  settingsSetArmaPath: (p) => ipcRenderer.invoke("settings:setArmaPath", p),
  settingsPickFolder: () => ipcRenderer.invoke("settings:pickFolder"),
  openPath: (p) => ipcRenderer.invoke("sys:openPath", p),
  openExternal: (url) => ipcRenderer.invoke("sys:openExternal", url),
  getConfig: () => ipcRenderer.invoke("config:get"),
  twitchSetBounds: (rect) => ipcRenderer.send("twitch:setBounds", rect),
  twitchSetVisible: (visible) => ipcRenderer.send("twitch:setVisible", !!visible),

  // Mods FTP download
  modsPing: () => ipcRenderer.invoke("mods:ping"),
  modsGetLastUpdate: () => ipcRenderer.invoke("mods:getLastUpdate"),
  modsStartDownload: () => ipcRenderer.invoke("mods:startDownload"),
  modsCancelDownload: () => ipcRenderer.invoke("mods:cancelDownload"),
  modsCheckUpdates: () => ipcRenderer.invoke("mods:checkUpdates"),
  modsLocalStatus: () => ipcRenderer.invoke("mods:localStatus"),
  onModsProgress: (cb) => ipcRenderer.on("mods:progress", (_e, data) => cb(data)),

  // Teamspeak status via main (avoids CORS)
  teamspeakGetStatus: () => ipcRenderer.invoke("teamspeak:getStatus"),
  settingsSetArmaOptions: (opts) => ipcRenderer.invoke("settings:setArmaOptions", opts),
  armaStart: (payload) => ipcRenderer.invoke("arma:start", payload),

  // App updates (GitHub Releases via electron-updater)
  updateGetVersion: () => ipcRenderer.invoke("update:getVersion"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateDownload: () => ipcRenderer.invoke("update:download"),
  updateInstall: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (cb) => ipcRenderer.on("update:status", (_e, data) => cb(data))
});
