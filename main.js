const { app, BrowserWindow, BrowserView, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const http = require("http");
const ftp = require("basic-ftp");

// ---------------- config ----------------
const configPath = path.join(__dirname, "config.json");
function getConfig(){
  try { return JSON.parse(fs.readFileSync(configPath, "utf-8")); }
  catch { return { teamspeak:{statusUrl:"https://api.fireside-gaming.de/ts-status.php"}, twitch:{channel:"derr12_", parent:"localhost", port:17345} }; }
}
const config = getConfig();


const settingsPath = path.join(app.getPath("userData"), "settings.json");
function readJsonSafe(p, fallback){ try { return JSON.parse(fs.readFileSync(p,"utf-8")); } catch { return fallback; } }
function getSettings(){ return readJsonSafe(settingsPath, { armaPath:"" }); }
function saveSettings(s){ fs.mkdirSync(path.dirname(settingsPath),{recursive:true}); fs.writeFileSync(settingsPath, JSON.stringify(s,null,2),"utf-8"); }

function readRegValue(key, valueName) {
  try {
    const out = execFileSync("reg", ["query", key, "/v", valueName], { encoding:"utf8" });
    const lines = out.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const line = lines.find(l => l.toLowerCase().startsWith(valueName.toLowerCase() + " "));
    if (!line) return null;
    const parts = line.split(/\s{2,}/);
    return parts[2] ? parts[2].trim() : null;
  } catch { return null; }
}
function parseLibraryFolders(vdfText){
  const libs=[];
  const rePath=/"path"\s*"([^"]+)"/gi; let m;
  while((m=rePath.exec(vdfText))!==null) libs.push(m[1].replace(/\\\\/g,"\\"));
  const reNum=/"\d+"\s*"([^"]+)"/g;
  while((m=reNum.exec(vdfText))!==null){ const p=m[1]; if(p && p.includes(":")) libs.push(p.replace(/\\\\/g,"\\")); }
  return Array.from(new Set(libs));
}
function detectArmaPathWindows(){
  const installPath =
    readRegValue("HKCU\\Software\\Valve\\Steam","SteamPath") ||
    readRegValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam","InstallPath") ||
    readRegValue("HKLM\\SOFTWARE\\Valve\\Steam","InstallPath");

  const candidates=[];
  if(installPath){
    candidates.push(path.resolve(installPath));
    const vdf=path.join(installPath,"steamapps","libraryfolders.vdf");
    if(fs.existsSync(vdf)){
      const libs=parseLibraryFolders(fs.readFileSync(vdf,"utf8"));
      for(const lib of libs) candidates.push(path.resolve(lib));
    }
  }
  candidates.push("C:\\Program Files (x86)\\Steam");
  candidates.push("C:\\Program Files\\Steam");

  for(const steamRoot of Array.from(new Set(candidates))){
    const arma=path.join(steamRoot,"steamapps","common","Arma 3");
    if(fs.existsSync(path.join(arma,"arma3_x64.exe")) || fs.existsSync(path.join(arma,"arma3.exe"))) return arma;
  }
  return "";
}
function detectArmaPath(){ return process.platform==="win32" ? detectArmaPathWindows() : ""; }

// -------- Arma user data helpers (Windows) --------
function getLocalAppData(){
  return process.env.LOCALAPPDATA || (process.platform === "win32" ? path.join(app.getPath("home"), "AppData", "Local") : "");
}


let win;
let twitchView=null;

// ---------------- App Auto-Update (GitHub Releases via electron-updater) ----------------
function sendUpdateStatus(payload){
  try{ if (win && !win.isDestroyed()) win.webContents.send("update:status", payload); }catch{}
}

function setupAutoUpdater(){
  // With UI we usually want manual download/installation.
  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateStatus({ state: "available", info }));
  autoUpdater.on("update-not-available", (info) => sendUpdateStatus({ state: "none", info }));
  autoUpdater.on("download-progress", (p) => {
    const percent = typeof p?.percent === "number" ? Math.round(p.percent) : null;
    sendUpdateStatus({
      state: "downloading",
      progress: {
        percent,
        transferred: Number(p?.transferred || 0),
        total: Number(p?.total || 0),
        bytesPerSecond: Number(p?.bytesPerSecond || 0)
      }
    });
  });
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ state: "downloaded", info }));
  autoUpdater.on("error", (err) => sendUpdateStatus({ state: "error", error: String(err?.message || err) }));
}
function createWindow(){
  win = new BrowserWindow({
    width:1500,
    height:860,
    minWidth:1100,
    minHeight:650,
    backgroundColor:"#0b0c0e",
    title:"FSG Launcher",
    icon: path.join(__dirname,"assets","icon.ico"),
    webPreferences:{
      preload: path.join(__dirname,"preload.js"),
      nodeIntegration:false,
      contextIsolation:true
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname,"renderer","index.html"));
}

function ensureTwitchView(){
  if (!win) return null;
  if (twitchView) return twitchView;

  const channel = String(config?.twitch?.channel || "derr12_");
  const parent = String(config?.twitch?.parent || "localhost");
  const url = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&muted=true&autoplay=true`;

  twitchView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setBrowserView(twitchView);
  twitchView.setBounds({ x: 0, y: 0, width: 10, height: 10 });
  twitchView.webContents.loadURL(url);
  twitchView.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  return twitchView;
}

ipcMain.on("twitch:setBounds", (_evt, rect) => {
  const view = ensureTwitchView();
  if (!view) return;
  const { x, y, width, height } = rect || {};
  if (![x,y,width,height].every(n => Number.isFinite(n))) return;
  if (width < 80 || height < 80) return;
  view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
});

ipcMain.on("twitch:setVisible", (_evt, visible) => {
  if (!win) return;
  if (!visible) {
    if (twitchView) win.removeBrowserView(twitchView);
    return;
  }
  const view = ensureTwitchView();
  if (view && !win.getBrowserViews().includes(view)) win.setBrowserView(view);
});


ipcMain.handle("config:get", async ()=>({ ok:true, config }));

// ---------------- Auto-Update IPC ----------------
ipcMain.handle("update:getVersion", async () => ({ ok:true, version: app.getVersion() }));

ipcMain.handle("update:check", async () => {
  try{
    // Only makes sense for packaged builds.
    if (!app.isPackaged) return { ok:false, skipped:true, reason:"not_packaged" };
    await autoUpdater.checkForUpdates();
    return { ok:true };
  }catch(e){
    return { ok:false, error:String(e?.message || e) };
  }
});

ipcMain.handle("update:download", async () => {
  try{
    if (!app.isPackaged) return { ok:false, skipped:true, reason:"not_packaged" };
    await autoUpdater.downloadUpdate();
    return { ok:true };
  }catch(e){
    return { ok:false, error:String(e?.message || e) };
  }
});

ipcMain.handle("update:install", async () => {
  try{
    if (!app.isPackaged) return { ok:false, skipped:true, reason:"not_packaged" };
    // quitAndInstall() quits immediately.
    autoUpdater.quitAndInstall();
    return { ok:true };
  }catch(e){
    return { ok:false, error:String(e?.message || e) };
  }
});


// Teamspeak status: fetched in main (avoids CORS/mixed-content issues)
ipcMain.handle("teamspeak:getStatus", async ()=>{
  try{
    const url = String(config?.teamspeak?.statusUrl || "").trim();
    if (!url) return { ok:false, error:"teamspeak.statusUrl fehlt in config.json" };

    // Node/Electron usually has fetch. Fallback to http/https if not.
    if (typeof fetch === "function"){
      const ac = new AbortController();
      const t = setTimeout(()=>ac.abort(), 5000);
      const r = await fetch(url, { cache:"no-store", signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) return { ok:false, error:`TS API HTTP ${r.status}` };
      const data = await r.json();
      const online = Number(data.online ?? data.clientsOnline ?? data.clients ?? 0);
      const max = Number(data.max ?? data.clientsMax ?? data.slots ?? 0);
      return { ok:true, online, max };
    }

    return { ok:false, error:"fetch() nicht verfügbar – bitte Electron/Node aktualisieren." };
  }catch(e){
    return { ok:false, error:String(e?.message||e) };
  }
});

ipcMain.handle("settings:get", async ()=>{
  const s=getSettings();
  if(!s.armaPath){
    const d=detectArmaPath();
    if(d){ s.armaPath=d; saveSettings(s); }
  }
  return {ok:true, settings:s};
});
ipcMain.handle("settings:setArmaOptions", async (_e, opts)=>{
  const s=getSettings();
  const defaults = { noPause:true, noPauseAudio:true, enableHT:false, hugePages:false };
s.armaOptions = Object.assign(defaults, s.armaOptions || {}, opts || {});

  saveSettings(s);
  return {ok:true};
});

ipcMain.handle("settings:setArmaPath", async (_e, p)=>{
  const s=getSettings();
  s.armaPath=String(p||"");
  saveSettings(s);
  return {ok:true};
});
ipcMain.handle("settings:pickFolder", async ()=>{
  const res=await dialog.showOpenDialog(win,{ title:"Arma 3 Ordner auswählen", properties:["openDirectory"]});
  if(res.canceled||!res.filePaths?.length) return {ok:false};
  return {ok:true, path:res.filePaths[0]};
});



ipcMain.handle("sys:openPath", async (_e, p)=>{
  try{
    const target=String(p||"");
    if(!target) return {ok:false};
    await shell.openPath(target);
    return {ok:true};
  }catch(err){
    return {ok:false, error:String(err?.message||err)};
  }
});

ipcMain.handle("sys:openExternal", async (_e, url)=>{
  try{
    const u = String(url||"").trim();
    if(!u) return {ok:false, error:"URL fehlt"};
    // Allow only http(s) to avoid opening file:// etc.
    const parsed = new URL(u);
    if(!["http:", "https:"].includes(parsed.protocol)){
      return {ok:false, error:"Nur http(s) URLs sind erlaubt"};
    }
    await shell.openExternal(parsed.toString());
    return {ok:true};
  }catch(err){
    return {ok:false, error:String(err?.message||err)};
  }
});

// ---------------- MODS FTP download (folder recursive) ----------------
let modsCancelToken = { cancelled: false };
let activeFtpClients = new Set();

function cancelActiveDownloads(){
  for (const c of Array.from(activeFtpClients)){
    try{ c.close(); }catch{}
  }
}

function safeJoinPosix(a, b){
  const aa = String(a||"").replace(/\\/g,"/").replace(/\/+$/,"");
  const bb = String(b||"").replace(/\\/g,"/").replace(/^\/+/,"");
  return aa ? (aa + "/" + bb) : bb;
}

async function listRemoteFilesRecursive(client, remoteDir){
  // returns array of { remotePath, size, modifiedAt }
  const out = [];
  async function walk(dir){
    const list = await client.list(dir);
    for (const item of list){
      const name = item.name;
      if (!name || name === "." || name === "..") continue;
      const full = safeJoinPosix(dir, name);
      // basic-ftp: item.isDirectory is boolean
      if (item.isDirectory){
        await walk(full);
      } else {
        // Prefer timestamps from MLSD (item.modifiedAt). If missing, fall back to MDTM.
        let modifiedAt = item.modifiedAt instanceof Date ? item.modifiedAt : null;
        if (!modifiedAt){
          try{
            const d = await client.lastMod(full);
            if (d instanceof Date) modifiedAt = d;
          }catch{}
        }
        out.push({ remotePath: full, size: Number(item.size || 0), modifiedAt });
      }
    }
  }
  await walk(remoteDir);
  return out;
}


async function getLastUpdateFromFtpAddons(ftpCfg){
  const client = new ftp.Client(30000);
  client.ftp.verbose = false;
  try{
    await client.access({
      host: ftpCfg.host,
      port: Number(ftpCfg.port||21),
      user: ftpCfg.user,
      password: ftpCfg.password,
      secure: !!ftpCfg.secure
    });

    const folderName = String(ftpCfg.folder || "@FiresideGaming_Test");
    const remoteAddons = safeJoinPosix(safeJoinPosix(ftpCfg.baseDir || "/", folderName), "addons");

    let list = [];
    try{
      list = await client.list(remoteAddons);
    }catch(e){
      // If addons folder doesn't exist or listing is blocked, fall back to mod root
      list = await client.list(safeJoinPosix(ftpCfg.baseDir || "/", folderName));
    }

    let newest = null;

    for (const item of list){
      if (!item || !item.name) continue;
      if (item.isDirectory) continue;
      const full = safeJoinPosix(remoteAddons, item.name);

      // basic-ftp may provide modifiedAt via MLSD
      const d = item.modifiedAt instanceof Date ? item.modifiedAt : null;
      if (d && (!newest || d > newest)) newest = d;
    }

    // Fallback: try MDTM for files if modifiedAt was missing
    if (!newest){
      for (const item of list){
        if (!item || !item.name) continue;
        if (item.isDirectory) continue;
        const full = safeJoinPosix(remoteAddons, item.name);
        try{
          const d = await client.lastMod(full);
          if (d && (!newest || d > newest)) newest = d;
        }catch{}
      }
    }

    return newest ? newest.toISOString() : null;
  } finally {
    try{ client.close(); }catch{}
  }
}
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

async function downloadFileOne(remotePath, localPath, ftpCfg, remoteModifiedAt){
  const c = new ftp.Client(30000);
  c.ftp.verbose = false;
  activeFtpClients.add(c);
  try{
    await c.access({
      host: ftpCfg.host,
      port: Number(ftpCfg.port||21),
      user: ftpCfg.user,
      password: ftpCfg.password,
      secure: !!ftpCfg.secure
    });

    if (modsCancelToken.cancelled) throw new Error("CANCELLED");

    ensureDir(path.dirname(localPath));
    await c.downloadTo(localPath, remotePath);

    // IMPORTANT: Set local file mtime to the remote modification time.
    // Otherwise the local mtime is "download time" and a timestamp-based update check
    // would become unreliable.
    if (remoteModifiedAt instanceof Date){
      try{
        const atime = new Date();
        fs.utimesSync(localPath, atime, remoteModifiedAt);
      }catch{}
    }
  } finally {
    activeFtpClients.delete(c);
    try{ c.close(); }catch{}
  }
}

function fileNeedsDownload(localPath, remoteSize, remoteModifiedAt){
  try{
    const st = fs.statSync(localPath);
    if (!st.isFile()) return true;

    const rSize = Number(remoteSize) || 0;
    const sizeMatches = (rSize > 0 && st.size === rSize);

    // If we have a remote timestamp, compare it to local mtime.
    // Use a small tolerance because some FTP servers round to seconds.
    if (remoteModifiedAt instanceof Date){
      const tolMs = 3000; // 3s tolerance
      const localMs = st.mtime.getTime();
      const remoteMs = remoteModifiedAt.getTime();

      // Remote newer => needs download
      if (remoteMs > localMs + tolMs) return true;

      // Remote not newer and size matches => up to date
      if (sizeMatches) return false;

      // Remote not newer but size differs => download (safer)
      return true;
    }

    // Fallback: size-only logic
    if (sizeMatches) return false;
    return true;
  } catch {
    return true;
  }
}

function findAnyPbo(dir, maxFiles = 8000){
  // Quick local install detection for Arma mods.
  // Returns { found: boolean, pboCount: number, fileCount: number }
  let seenFiles = 0;
  let pboCount = 0;

  function walk(current, depth){
    if (seenFiles >= maxFiles) return;
    let entries;
    try{ entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { return; }

    for (const ent of entries){
      if (seenFiles >= maxFiles) return;
      const name = ent.name;
      if (!name || name === "." || name === "..") continue;
      const full = path.join(current, name);
      if (ent.isDirectory()){
        // Keep it cheap: dive a few levels. Mods usually keep PBOS in addons/.
        if (depth < 5) walk(full, depth + 1);
      } else if (ent.isFile()){
        seenFiles += 1;
        if (name.toLowerCase().endsWith(".pbo")) pboCount += 1;
      }
    }
  }

  // Prefer typical Arma structure: <mod>/addons/*.pbo
  const addons1 = path.join(dir, "addons");
  const addons2 = path.join(dir, "Addons");
  const preferred = fs.existsSync(addons1) ? addons1 : (fs.existsSync(addons2) ? addons2 : null);
  if (preferred){
    walk(preferred, 0);
  } else {
    walk(dir, 0);
  }

  return { found: pboCount > 0, pboCount, fileCount: seenFiles };
}

async function listAndPlanDownloads({ ftpCfg, remoteBase, localBase }){
  const lister = new ftp.Client(30000);
  lister.ftp.verbose = false;
  let files = [];
  try{
    await lister.access({
      host: ftpCfg.host,
      port: Number(ftpCfg.port||21),
      user: ftpCfg.user,
      password: ftpCfg.password,
      secure: !!ftpCfg.secure
    });
    files = await listRemoteFilesRecursive(lister, remoteBase);
  } finally { try{ lister.close(); }catch{} }

  const planned = [];
  let skippedFiles = 0;
  let skippedBytes = 0;

  // Build a set of expected local relative paths from the remote listing.
  // This allows us to detect files that were removed from the server but still
  // exist locally (stale files).
  const expectedRel = new Set();

  for (const f of files){
    const rel = f.remotePath.replace(remoteBase, "").replace(/^\/+/, "");
    expectedRel.add(rel);
    const localPath = path.join(localBase, rel.split("/").join(path.sep));
    const size = Number(f.size || 0);
    if (fileNeedsDownload(localPath, size, f.modifiedAt)){
      planned.push({ remotePath: f.remotePath, localPath, size, modifiedAt: f.modifiedAt });
    } else {
      skippedFiles += 1;
      skippedBytes += size;
    }
  }

  return {
    allFiles: files,
    expectedRel: Array.from(expectedRel),
    planned,
    totalFiles: files.length,
    totalBytes: files.reduce((a,f)=>a + Number(f.size||0), 0),
    plannedFiles: planned.length,
    plannedBytes: planned.reduce((a,f)=>a + Number(f.size||0), 0),
    skippedFiles,
    skippedBytes
  };
}

function listLocalFilesRecursive(baseDir){
  // Returns relative paths with POSIX separators.
  const out = [];
  function walk(current, relPrefix){
    let entries;
    try{ entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries){
      const name = ent.name;
      if (!name || name === "." || name === "..") continue;
      const full = path.join(current, name);
      const rel = relPrefix ? path.posix.join(relPrefix, name) : name;
      if (ent.isDirectory()){
        walk(full, rel);
      } else if (ent.isFile()){
        out.push(rel);
      }
    }
  }
  if (fs.existsSync(baseDir)) walk(baseDir, "");
  return out;
}

function removeEmptyDirs(rootDir){
  // Remove empty directories bottom-up.
  function walk(dir){
    let entries;
    try{ entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries){
      if (ent.isDirectory()) walk(path.join(dir, ent.name));
    }
    // after children
    try{
      const left = fs.readdirSync(dir);
      if (left.length === 0) fs.rmdirSync(dir);
    }catch{}
  }
  walk(rootDir);
}

function findStaleLocalFiles(localBase, expectedRelSet){
  // localBase is the mod root folder. We only ever delete within that folder.
  const localFiles = listLocalFilesRecursive(localBase);
  const stale = [];
  let staleBytes = 0;
  for (const rel of localFiles){
    if (!expectedRelSet.has(rel)){
      const full = path.join(localBase, rel.split("/").join(path.sep));
      stale.push({ rel, full });
      try{ staleBytes += fs.statSync(full).size || 0; }catch{}
    }
  }
  return { stale, staleBytes };
}

function deleteStaleLocalFiles(staleItems, localBase){
  let deleted = 0;
  let deletedBytes = 0;
  for (const it of staleItems){
    try{
      // extra safety: ensure we never delete outside localBase
      const resolvedBase = path.resolve(localBase);
      const resolvedFile = path.resolve(it.full);
      if (!resolvedFile.startsWith(resolvedBase + path.sep)) continue;
      const st = fs.statSync(resolvedFile);
      if (st.isFile()){
        deletedBytes += st.size || 0;
        fs.unlinkSync(resolvedFile);
        deleted += 1;
      }
    }catch{}
  }
  try{ removeEmptyDirs(localBase); }catch{}
  return { deleted, deletedBytes };
}

console.log("[FSG] registering mods handlers");

ipcMain.handle("mods:ping", async ()=>({ ok:true }));

// Local-only install detection (used to show correct status on launcher start)
ipcMain.handle("mods:localStatus", async ()=>{
  try{
    const s = getSettings();
    if (!s.armaPath) return { ok:false, error:"Arma Pfad fehlt. Bitte in SETTINGS setzen." };

    const ftpCfg = (config && config.ftp) ? config.ftp : null;
    const folderName = String(ftpCfg?.folder || "@FiresideGaming_Test");
    const localBase = path.join(s.armaPath, folderName);

    if (!fs.existsSync(localBase)){
      return { ok:true, installed:false, localBase, reason:"folder_missing" };
    }
    const st = fs.statSync(localBase);
    if (!st.isDirectory()){
      return { ok:true, installed:false, localBase, reason:"not_a_directory" };
    }

    const scan = findAnyPbo(localBase);
    return {
      ok:true,
      installed: !!scan.found,
      localBase,
      pboCount: scan.pboCount,
      fileCount: scan.fileCount
    };
  }catch(e){
    return { ok:false, error:String(e?.message || e) };
  }
});

ipcMain.handle("mods:getLastUpdate", async ()=>{
  try{
    const ftpCfg = (config && config.ftp) ? config.ftp : null;
    if (!ftpCfg?.host) return { ok:false, error:"FTP Config fehlt." };
    const iso = await getLastUpdateFromFtpAddons(ftpCfg);
    return { ok:true, lastUpdate: iso };
  } catch(e){
    return { ok:false, error:String(e?.message || e) };
  }
});

ipcMain.handle("mods:cancelDownload", async ()=>{
  modsCancelToken.cancelled = true;
  cancelActiveDownloads();
  return { ok:true };
});

ipcMain.handle("mods:checkUpdates", async ()=>{
  const s = getSettings();
  if (!s.armaPath) return { ok:false, error:"Arma Pfad fehlt. Bitte in SETTINGS setzen." };

  const ftpCfg = (config && config.ftp) ? config.ftp : null;
  if (!ftpCfg?.host) return { ok:false, error:"FTP Config fehlt (config.json -> ftp.host)." };

  const folderName = String(ftpCfg.folder || "@FiresideGaming_Test");
  const remoteBase = safeJoinPosix(ftpCfg.baseDir || "/", folderName);
  const localBase = path.join(s.armaPath, folderName);

  const plan = await listAndPlanDownloads({ ftpCfg, remoteBase, localBase });

  // Detect local files that are no longer present on the server (stale/removed).
  // We DO NOT delete them in "check" – we only report them. Deletion happens on download.
  const expectedSet = new Set(plan.expectedRel || []);
  const staleInfo = findStaleLocalFiles(localBase, expectedSet);

  win?.webContents.send("mods:progress", {
    stage: "checked",
    totalFiles: plan.totalFiles,
    totalBytes: plan.totalBytes,
    plannedFiles: plan.plannedFiles,
    plannedBytes: plan.plannedBytes,
    skippedFiles: plan.skippedFiles,
    skippedBytes: plan.skippedBytes,
    staleFiles: staleInfo.stale.length,
    staleBytes: staleInfo.staleBytes
  });

  return { ok:true, localBase, staleFiles: staleInfo.stale.length, staleBytes: staleInfo.staleBytes, ...plan };
});

ipcMain.handle("mods:startDownload", async ()=>{
  modsCancelToken = { cancelled:false };

  const s = getSettings();
  if (!s.armaPath) return { ok:false, error:"Arma Pfad fehlt. Bitte in SETTINGS setzen." };

  const ftpCfg = (config && config.ftp) ? config.ftp : null;
  if (!ftpCfg?.host) return { ok:false, error:"FTP Config fehlt (config.json -> ftp.host)." };

  const folderName = String(ftpCfg.folder || "@FiresideGaming_Test");
  const remoteBase = safeJoinPosix(ftpCfg.baseDir || "/", folderName);
  const localBase = path.join(s.armaPath, folderName);

  // 1) list + plan (skip files that are already up-to-date)
  const plan = await listAndPlanDownloads({ ftpCfg, remoteBase, localBase });

  // 1b) Delete stale files (files removed from server but still present locally)
  const expectedSet = new Set(plan.expectedRel || []);
  const staleInfo = findStaleLocalFiles(localBase, expectedSet);
  if (staleInfo.stale.length){
    win?.webContents.send("mods:progress", {
      stage: "cleaning",
      staleFiles: staleInfo.stale.length,
      staleBytes: staleInfo.staleBytes
    });
    deleteStaleLocalFiles(staleInfo.stale, localBase);
  }

  const totalFiles = plan.plannedFiles;
  const totalBytes = plan.plannedBytes;

  win?.webContents.send("mods:progress", {
    stage:"listed",
    totalFiles,
    totalBytes,
    skippedFiles: plan.skippedFiles,
    skippedBytes: plan.skippedBytes
  });

  if (totalFiles === 0){
    win?.webContents.send("mods:progress", { stage:"done", totalFiles:0, totalBytes:0, upToDate:true });
    return { ok:true, localBase, upToDate:true };
  }

  // 2) download with up to maxConnections
  const maxConn = Math.max(1, Math.min(20, Number(ftpCfg.maxConnections||20)));
  let doneFiles = 0;
  let doneBytes = 0;

  // build queue of tasks (only needed files)
  const queue = plan.planned.slice();

  async function worker(){
    while(queue.length){
      if (modsCancelToken.cancelled) return;
      const job = queue.shift();
      if (!job) return;
      try{
        await downloadFileOne(job.remotePath, job.localPath, ftpCfg, job.modifiedAt);
        doneFiles += 1;
        doneBytes += job.size || 0;
        win?.webContents.send("mods:progress", {
          stage:"downloading",
          doneFiles, totalFiles,
          doneBytes, totalBytes
        });
      } catch (e){
        if (modsCancelToken.cancelled) return;
        win?.webContents.send("mods:progress", {
          stage:"error",
          error: String(e?.message || e),
          remotePath: job.remotePath
        });
        // continue
      }
    }
  }

  const workers = Array.from({length: maxConn}, () => worker());
  await Promise.all(workers);

  if (modsCancelToken.cancelled){
    win?.webContents.send("mods:progress", { stage:"cancelled" });
    return { ok:false, cancelled:true };
  }

  win?.webContents.send("mods:progress", { stage:"done", totalFiles, totalBytes });
  return { ok:true, localBase };
});
app.whenReady().then(async () => {
  setupAutoUpdater();
  createWindow();

  // Auto-check for updates on startup (only in installed/packaged builds)
  if (app.isPackaged){
    try{
      // Give the window a moment to load UI before we start spamming events
      setTimeout(() => {
        try{ autoUpdater.checkForUpdates(); }catch{}
      }, 1200);
    }catch{}
  }
});
app.on("window-all-closed", ()=>{ if(process.platform!=="darwin") app.quit(); });


function resolveArmaExe(armaPath){
  if (!armaPath) return null;
  try{
    if (fs.existsSync(armaPath) && fs.statSync(armaPath).isFile()) return armaPath;
    const cand1 = path.join(armaPath, "arma3_x64.exe");
    const cand2 = path.join(armaPath, "arma3.exe");
    if (fs.existsSync(cand1)) return cand1;
    if (fs.existsSync(cand2)) return cand2;
  }catch{}
  return null;
}

function splitArgs(str){
  if (!str) return [];
  const out=[];
  let cur="", q=null;
  for (let i=0;i<str.length;i++){
    const ch=str[i];
    if (q){
      if (ch===q) q=null; else cur+=ch;
    } else {
      if (ch === "\"" || ch === "\'") q = ch;
      else if (/\s/.test(ch)){ if (cur){ out.push(cur); cur=""; } }
      else cur+=ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}


ipcMain.handle("arma:start", async (_e, payload)=>{
  try{
    const s=getSettings();
    if (!s.armaPath){
      const d=detectArmaPath();
      if (d){ s.armaPath=d; saveSettings(s); }
    }
    const exe = resolveArmaExe(s.armaPath);
    if (!exe) return {ok:false, error:"Arma 3 Pfad ist nicht gesetzt oder arma3_x64.exe wurde nicht gefunden."};

    const options = payload?.options || s.armaOptions || {};
    const mod = payload?.mod || "@FiresideGaming_Test";
    const args=[];

    if (options.noSplash) args.push("-nosplash");
    if (options.skipIntro) args.push("-skipIntro");
    if (options.window) args.push("-window");
    if (options.enableHT) args.push("-enableHT");
        if (options.hugePages) args.push("-hugePages");
        if (options.noPause) args.push("-noPause");
        if (options.noPauseAudio) args.push("-noPauseAudio");
    if (options.showScriptErrors) args.push("-showScriptErrors");
    if (mod) args.push(`-mod=${mod}`);

    args.push(...splitArgs(options.extraParams || ""));

    spawn(exe, args, {detached:true, stdio:"ignore"}).unref();
    return {ok:true};
  }catch(err){
    return {ok:false, error: (err && err.message) ? err.message : String(err)};
  }
});
