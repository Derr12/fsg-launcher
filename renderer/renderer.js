
function sendTwitchBounds(){
  const host = document.getElementById("twitchHost");
  if (!host || !window.launcher?.twitchSetBounds) return;
  const rect = host.getBoundingClientRect();
  // bounds in the BrowserWindow content (CSS px == DIP)
  const x = rect.left + window.scrollX;
  const y = rect.top + window.scrollY;
  window.launcher.twitchSetBounds({
    x, y,
    width: rect.width,
    height: rect.height
  });
}
window.addEventListener("resize", () => setTimeout(sendTwitchBounds, 80));

// Navigation
const navButtons = Array.from(document.querySelectorAll(".navItem"));
const pages = {
  home: document.getElementById("page-home"),
  mods: document.getElementById("page-mods"),
  settings: document.getElementById("page-settings"),
  faq: document.getElementById("page-faq"),
};

// will be assigned by wireMods()
let refreshModsLocalStatus = null;

function setPage(key){
  navButtons.forEach(b => b.classList.toggle("active", b.dataset.page === key));
  Object.values(pages).forEach(p => p && p.classList.remove("active"));
  if (pages[key]) pages[key].classList.add("active");
  if (key === "settings") loadSettings();
  if (key === "mods") {
    try{
      (async ()=>{
        const installed = await refreshModsLocalStatus?.();
        if (installed){
          try{ await window.launcher?.modsCheckUpdates?.(); }catch{}
        }
      })();
    }catch{}
  }
  if (window.launcher?.twitchSetVisible) window.launcher.twitchSetVisible(key === "home");
  setTimeout(sendTwitchBounds, 120);
}

navButtons.forEach(b => b.addEventListener("click", () => setPage(b.dataset.page)));

document.getElementById("btnRefresh").addEventListener("click", () => location.reload());
document.getElementById("btnExit").addEventListener("click", () => window.close());

// ---------------- App Updates UI (GitHub Releases via electron-updater) ----------------
(function wireUpdaterUI(){
  const bar = document.getElementById("updateBar");
  if (!bar || !window.launcher) return;

  const txt = document.getElementById("updateText");
  const meta = document.getElementById("updateMeta");
  const progWrap = document.getElementById("updateProgressWrap");
  const prog = document.getElementById("updateProgress");
  const btnCheck = document.getElementById("btnUpdateCheck");
  const btnDl = document.getElementById("btnUpdateDownload");
  const btnInstall = document.getElementById("btnUpdateInstall");
  const btnHide = document.getElementById("btnUpdateHide");

  const show = () => bar.classList.remove("hidden");
  const hide = () => bar.classList.add("hidden");

  let lastState = null;

  function setProgress(percent){
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    if (prog) prog.style.width = `${p}%`;
  }

  function setButtons({ canDownload=false, canInstall=false }={}){
    if (btnDl) btnDl.classList.toggle("hidden", !canDownload);
    if (btnInstall) btnInstall.classList.toggle("hidden", !canInstall);
  }

  async function refreshVersionMeta(){
    try{
      const r = await window.launcher.updateGetVersion();
      if (r?.ok && meta) meta.textContent = `Version: ${r.version}`;
    }catch{}
  }

  // Initial state
  refreshVersionMeta();
  setButtons({ canDownload:false, canInstall:false });
  if (progWrap) progWrap.classList.add("hidden");
  setProgress(0);

  // Actions
  if (btnHide) btnHide.addEventListener("click", hide);
  if (btnCheck) btnCheck.addEventListener("click", async ()=>{
    show();
    if (txt) txt.textContent = "Prüfe auf Updates…";
    setButtons({ canDownload:false, canInstall:false });
    if (progWrap) progWrap.classList.add("hidden");
    setProgress(0);
    const r = await window.launcher.updateCheck();
    if (r?.skipped && txt) txt.textContent = "Update-Check ist nur in der installierten Version verfügbar.";
    if (!r?.ok && !r?.skipped && txt) txt.textContent = `Update-Check fehlgeschlagen: ${r?.error || "Unbekannter Fehler"}`;
  });
  if (btnDl) btnDl.addEventListener("click", async ()=>{
    show();
    if (txt) txt.textContent = "Lade Update herunter…";
    setButtons({ canDownload:false, canInstall:false });
    if (progWrap) progWrap.classList.remove("hidden");
    setProgress(0);
    const r = await window.launcher.updateDownload();
    if (!r?.ok && txt) txt.textContent = `Download fehlgeschlagen: ${r?.error || "Unbekannter Fehler"}`;
  });
  if (btnInstall) btnInstall.addEventListener("click", async ()=>{
    // This will quit the app.
    await window.launcher.updateInstall();
  });

  // Live status from main process
  window.launcher.onUpdateStatus((payload) => {
    if (!payload) return;
    lastState = payload.state || lastState;
    show();

    switch(payload.state){
      case "checking":
        if (txt) txt.textContent = "Prüfe auf Updates…";
        setButtons({ canDownload:false, canInstall:false });
        if (progWrap) progWrap.classList.add("hidden");
        setProgress(0);
        break;
      case "available": {
        const v = payload?.info?.version ? `v${payload.info.version}` : "eine neue Version";
        if (txt) txt.textContent = `Update verfügbar (${v}).`;
        setButtons({ canDownload:true, canInstall:false });
        if (progWrap) progWrap.classList.add("hidden");
        setProgress(0);
        break;
      }
      case "none":
        if (txt) txt.textContent = "Kein Update verfügbar.";
        setButtons({ canDownload:false, canInstall:false });
        if (progWrap) progWrap.classList.add("hidden");
        setProgress(0);
        // Auto-hide after a short moment so it doesn't annoy
        setTimeout(() => {
          if (lastState === "none") hide();
        }, 3500);
        break;
      case "downloading": {
        const p = payload?.progress?.percent;
        if (txt) txt.textContent = `Download läuft… ${typeof p === "number" ? p + "%" : ""}`;
        setButtons({ canDownload:false, canInstall:false });
        if (progWrap) progWrap.classList.remove("hidden");
        if (typeof p === "number") setProgress(p);
        break;
      }
      case "downloaded": {
        const v = payload?.info?.version ? `v${payload.info.version}` : "";
        if (txt) txt.textContent = `Update heruntergeladen ${v}. Neustart zum Installieren.`;
        setButtons({ canDownload:false, canInstall:true });
        if (progWrap) progWrap.classList.add("hidden");
        setProgress(100);
        break;
      }
      case "error":
        if (txt) txt.textContent = `Update-Fehler: ${payload.error || "Unbekannter Fehler"}`;
        setButtons({ canDownload:false, canInstall:false });
        if (progWrap) progWrap.classList.add("hidden");
        break;
    }
  });
})();

// SETTINGS
async function loadSettings(){
  const el = document.getElementById("armaPathText");
  const res = await window.launcher.settingsGet();
  if (res?.ok){
    el.textContent = res.settings.armaPath || "–";
    const o = res.settings.armaOptions || {};
    const set = (id,val)=>{ const e=document.getElementById(id); if(e) e.checked=!!val; };
    set("optNoSplash", o.noSplash);
    set("optSkipIntro", o.skipIntro);
    set("optWindow", o.window);
    set("optNoPause", (o.noPause ?? true));
    set("optEnableHT", o.enableHT);
    set("optHugePages", o.hugePages);
    set("optNoPauseAudio", (o.noPauseAudio ?? true));
    set("optShowScriptErrors", o.showScriptErrors);
    const extra=document.getElementById("optExtraParams");
    if (extra) extra.value = o.extraParams || "";
  }
}

document.getElementById("btnPickArma").addEventListener("click", async ()=>{
  const r = await window.launcher.settingsPickFolder();
  if (r?.ok && r.path){
    await window.launcher.settingsSetArmaPath(r.path);
    await loadSettings();
  }
});



const btnMoreParams = document.getElementById("btnMoreParams");
if (btnMoreParams) btnMoreParams.addEventListener("click", ()=> alert("Weitere Startparameter: kommt als nächstes."));

// initial
loadSettings();

// ---------------- Quick links (Blog/Forum/Discord/Wiki) ----------------
async function wireQuickLinks(){
  const cards = Array.from(document.querySelectorAll('.quickCard[data-link]'));
  if (!cards.length) return;
  let cfg = null;
  try{ cfg = await window.launcher?.getConfig?.(); }catch{ cfg = null; }
  const links = cfg?.config?.links || {};

  cards.forEach(card => {
    card.addEventListener('click', async () => {
      const key = card.dataset.link;
      const url = links?.[key];
      if (!url){
        alert(`Link fehlt in config.json: links.${key}`);
        return;
      }
      const res = await window.launcher?.openExternal?.(url);
      if (!res?.ok){
        alert(res?.error || 'Konnte Website nicht öffnen.');
      }
    });
  });
}
wireQuickLinks();


function wireExternalAnchors(){
  const els = Array.from(document.querySelectorAll('[data-external]'));
  if (!els.length) return;

  let cfg = null;
  const getLinks = async () => {
    if (cfg) return cfg;
    try{ cfg = await window.launcher?.getConfig?.(); }catch{ cfg = null; }
    return cfg;
  };

  els.forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const key = el.dataset.external;
      const c = await getLinks();
      const links = c?.config?.links || {};
      const url =
        links?.[key] ||
        (key === 'discordBugtracker' ? links?.discord : null) ||
        (key === 'github' ? links?.github : null);

      if (!url){
        alert(`Link fehlt in config.json: links.${key}`);
        return;
      }
      const res = await window.launcher?.openExternal?.(url);
      if (!res?.ok){
        alert(res?.error || 'Konnte Website nicht öffnen.');
      }
    });
  });
}
wireExternalAnchors();



// ensure twitch on startup (HOME)
try{ window.launcher?.twitchSetVisible?.(true); setTimeout(sendTwitchBounds, 200); }catch{}



// ---------------- Teamspeak polling (API) ----------------
async function updateTeamspeak(){
  const onlineEl = document.getElementById("tsOnline");
  const maxEl = document.getElementById("tsMax");
  const pctEl = document.getElementById("tsPercent");

  try{
    if (!window.launcher?.teamspeakGetStatus) return;
    const res = await window.launcher.teamspeakGetStatus();
    if (!res?.ok) throw new Error(res?.error || "TS API Fehler");
    const online = Number(res.online ?? 0);
    const max = Number(res.max ?? 0);

    if (onlineEl) onlineEl.textContent = isFinite(online) ? String(online) : "--";
    if (maxEl) maxEl.textContent = isFinite(max) ? String(max) : "--";

    const pct = (max > 0) ? Math.round((online / max) * 100) : 0;
    if (pctEl) pctEl.textContent = `${pct}%`;

    // clear error highlight
    const card = document.querySelector(".tsCard");
    if (card) card.classList.remove("tsError");
  }catch(e){
    console.warn("Teamspeak API nicht erreichbar:", e);
    // show a visible hint
    if (onlineEl) onlineEl.textContent = "--";
    if (maxEl) maxEl.textContent = "--";
    if (pctEl) pctEl.textContent = "--";
    const card = document.querySelector(".tsCard");
    if (card) card.classList.add("tsError");
  }
}
setInterval(updateTeamspeak, 10000);
updateTeamspeak();

setInterval(() => { try{ sendTwitchBounds(); }catch{} }, 1200);



// ---------------- MODS UI ----------------
function bytesToMB(b){ return (b/1024/1024).toFixed(1); }

function wireMods(){
  const btnDl = document.getElementById("btnModsDownload");
  const btnCheck = document.getElementById("btnModsCheck");
  const btnCancel = document.getElementById("btnModsCancel");
  const wrap = document.getElementById("modsProgressWrap");
  const fill = document.getElementById("modsBarFill");
  const text = document.getElementById("modsProgressText");
  const stats = document.getElementById("modsStats");
  const badge = document.getElementById("modsStatusBadge");
  const modsHero = document.getElementById("modsHeroCard");
  const btnFolder = document.getElementById("btnModsFolder");

  let lastPlannedFiles = null;
  let lastPlannedBytes = null;
  let lastActionNeeded = null;

  refreshModsLocalStatus = async () => {
    try{
      if (!window.launcher?.modsLocalStatus) return;
      const r = await window.launcher.modsLocalStatus();
      if (!r?.ok) return;
      if (r.installed){
        badge.textContent = "Installiert";
        badge.classList.remove("red","orange");
        badge.classList.add("green");
        if (modsHero){ modsHero.classList.remove("mod-missing","mod-outdated"); modsHero.classList.add("mod-ok"); }
      } else {
        badge.textContent = "Nicht installiert";
        badge.classList.remove("green","orange");
        badge.classList.add("red");
        if (modsHero){ modsHero.classList.remove("mod-ok","mod-outdated"); modsHero.classList.add("mod-missing"); }
      }
      // Download button stays available; "Prüfen" decides if anything is needed.
      return !!r.installed;
    }catch(e){
      console.warn("modsLocalStatus failed", e);
    }
  };

  if (btnFolder){
    btnFolder.addEventListener("click", async () => {
      const s = await window.launcher.settingsGet();
      const cfg = await window.launcher.getConfig();
      const folder = cfg?.config?.ftp?.folder || "@FiresideGaming_Test";
      const arma = s?.settings?.armaPath;
      if (!arma) return alert("Arma Pfad fehlt.");
      window.launcher.openPath(arma + "\\" + folder);
    });
  }

  if (btnDl){
    btnDl.addEventListener("click", async () => {
      // If we already checked and nothing is needed, don't start a pointless download.
      if (lastActionNeeded === false || lastPlannedFiles === 0){
        alert("Alles ist aktuell – kein Download nötig.");
        return;
      }
      wrap.style.display = "block";
      fill.style.width = "0%";
      text.textContent = "Starte Download…";
      stats.textContent = "";
      badge.textContent = "Download läuft…";
      badge.classList.add("red");
      if (btnCancel) btnCancel.disabled = false;
      const res = await window.launcher.modsStartDownload();
      if (!res?.ok && !res?.cancelled){
        alert(res?.error || "Download fehlgeschlagen.");
      }
    });
  }

  if (btnCheck){
    btnCheck.addEventListener("click", async () => {
      wrap.style.display = "block";
      fill.style.width = "0%";
      text.textContent = "Prüfe Dateien…";
      stats.textContent = "";
      const res = await window.launcher.modsCheckUpdates();
      if (!res?.ok){
        alert(res?.error || "Prüfen fehlgeschlagen.");
        return;
      }
      const plannedFiles = Number(res.plannedFiles ?? res.planned?.length ?? 0);
      const plannedBytes = Number(res.plannedBytes ?? 0);
      const staleFiles = Number(res.staleFiles ?? 0);
      const staleBytes = Number(res.staleBytes ?? 0);

      lastActionNeeded = (plannedFiles > 0) || (staleFiles > 0);
      lastPlannedFiles = plannedFiles + staleFiles;
      lastPlannedBytes = plannedBytes + staleBytes;

      if (btnDl) btnDl.disabled = !lastActionNeeded;
    });
  }

  if (btnCancel){
    btnCancel.addEventListener("click", async () => {
      await window.launcher.modsCancelDownload();
    });
    btnCancel.disabled = true;
  }

  if (window.launcher?.onModsProgress){
    window.launcher.onModsProgress((p) => {
      if (!p) return;
      if (p.stage === "listed"){
        text.textContent = `Dateien gefunden: ${p.totalFiles}`;
        const skipped = Number(p.skippedFiles || 0);
        const skippedTxt = skipped > 0 ? ` • ${skipped} aktuell` : "";
        stats.textContent = `0 / ${p.totalFiles} Dateien • 0 MB / ${bytesToMB(p.totalBytes)} MB${skippedTxt}`;
      }
      if (p.stage === "checked"){
        const plannedFiles = Number(p.plannedFiles || 0);
        const plannedBytes = Number(p.plannedBytes || 0);

        const pct = (p.totalBytes > 0) ? Math.round(((p.totalBytes - plannedBytes) / p.totalBytes) * 100) : 0;
        fill.style.width = Math.max(0, Math.min(100, pct)) + "%";

        const staleFiles = Number(p.staleFiles || 0);
        const staleBytes = Number(p.staleBytes || 0);

        // Wenn der Server Dateien entfernt hat, braucht der User trotzdem einen "Download"-Lauf,
        // damit wir lokal aufräumen können (stale/removed Files löschen).
        const actionNeeded = (plannedFiles > 0) || (staleFiles > 0);

        // Remember whether a download run is required (download OR cleanup only)
        lastActionNeeded = actionNeeded;

        // Für den Download-Button merken wir uns, ob überhaupt etwas zu tun ist.
        // (Geänderte Dateien ODER veraltete lokale Dateien)
        lastPlannedFiles = plannedFiles + staleFiles;
        lastPlannedBytes = plannedBytes + staleBytes;

        const staleTxt = staleFiles > 0 ? ` • ${staleFiles} veraltet (wird beim Download gelöscht)` : "";

        if (!actionNeeded){
          text.textContent = "Alles aktuell ✅";
          badge.textContent = "Aktuell";
          badge.classList.remove("red","orange");
          badge.classList.add("green");
          if (modsHero){ modsHero.classList.remove("mod-missing","mod-outdated"); modsHero.classList.add("mod-ok"); }
          stats.textContent = `${p.totalFiles} Dateien • nichts zu laden${staleTxt}`;
        } else if (plannedFiles === 0 && staleFiles > 0){
          text.textContent = `Update verfügbar: Bereinigung (${staleFiles} Dateien)`;
          badge.textContent = "Update verfügbar";
          badge.classList.remove("red","green");
          badge.classList.add("orange");
          if (modsHero){ modsHero.classList.remove("mod-missing","mod-ok"); modsHero.classList.add("mod-outdated"); }
          stats.textContent = `${p.totalFiles} Dateien • nichts zu laden${staleTxt}`;
        } else {
          text.textContent = `Update verfügbar: ${plannedFiles} Dateien`;
          badge.textContent = "Update verfügbar";
          badge.classList.remove("red","green");
          badge.classList.add("orange");
          if (modsHero){ modsHero.classList.remove("mod-missing","mod-ok"); modsHero.classList.add("mod-outdated"); }
          stats.textContent = `${plannedFiles} Dateien • ${bytesToMB(plannedBytes)} MB zu laden${staleTxt}`;
        }

        if (btnDl) btnDl.disabled = !actionNeeded;
      }
      if (p.stage === "cleaning"){
        const f = Number(p.staleFiles || 0);
        const b = Number(p.staleBytes || 0);
        text.textContent = `Räume auf… (${f} Dateien)`;
        stats.textContent = b > 0 ? `${bytesToMB(b)} MB werden gelöscht` : "";
      }
      if (p.stage === "downloading"){
        const pct = p.totalBytes > 0 ? Math.round((p.doneBytes / p.totalBytes) * 100) : Math.round((p.doneFiles / Math.max(1,p.totalFiles))*100);
        fill.style.width = pct + "%";
        text.textContent = `Download… ${pct}%`;
        stats.textContent = `${p.doneFiles} / ${p.totalFiles} Dateien • ${bytesToMB(p.doneBytes)} MB / ${bytesToMB(p.totalBytes)} MB`;
      }
      if (p.stage === "done"){
        fill.style.width = "100%";
        text.textContent = p.upToDate ? "Schon aktuell ✅" : "Fertig ✅";
        badge.textContent = "Installiert";
        // After a successful run, switch to "ok" state (green)
        // even if we previously showed "update available" (orange).
        badge.classList.remove("red","orange");
        badge.classList.add("green");
        if (modsHero){ modsHero.classList.remove("mod-missing","mod-outdated"); modsHero.classList.add("mod-ok"); }
        if (btnCancel) btnCancel.disabled = true;
      }
      if (p.stage === "cancelled"){
        text.textContent = "Abgebrochen";
        // Keep local status correct (may still be installed)
        refreshModsLocalStatus();
        if (btnCancel) btnCancel.disabled = true;
      }
      if (p.stage === "error"){
        text.textContent = `Fehler: ${p.error}`;
      }
    });
  }

  // initial local+remote status on launcher start
  (async ()=>{
    const installed = await refreshModsLocalStatus();
    if (installed){
      try{
        const res = await window.launcher.modsCheckUpdates();
        if (res?.ok){
          const plannedFiles = Number(res.plannedFiles ?? res.planned?.length ?? 0);
          const staleFiles = Number(res.staleFiles ?? 0);
          const actionNeeded = (plannedFiles > 0) || (staleFiles > 0);

          if (!actionNeeded){
            badge.textContent = "Aktuell";
            badge.classList.remove("red","orange");
            badge.classList.add("green");
            if (modsHero){ modsHero.classList.remove("mod-missing","mod-outdated"); modsHero.classList.add("mod-ok"); }
          } else {
            badge.textContent = "Update verfügbar";
            badge.classList.remove("red","green");
            badge.classList.add("orange");
            if (modsHero){ modsHero.classList.remove("mod-missing","mod-ok"); modsHero.classList.add("mod-outdated"); }
          }

          if (btnDl) btnDl.disabled = !actionNeeded;
        }
      }catch(e){
        console.warn("Auto modsCheckUpdates failed", e);
      }
    }
  })();
}
wireMods();


// sanity check for mods handlers
(async()=>{ try{ await window.launcher?.modsPing?.(); }catch(e){ console.warn('mods:ping failed', e); } })();

async function refreshLastUpdate(){
  const el = document.getElementById("lastUpdateValue");
  if (!el || !window.launcher?.modsGetLastUpdate) return;
  try{
    const res = await window.launcher.modsGetLastUpdate();
    if (res?.ok && res.lastUpdate){
      const d = new Date(res.lastUpdate);
      // Berlin locale
      el.textContent = d.toLocaleString("de-DE", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
    } else {
      el.textContent = "–";
    }
  }catch(e){
    el.textContent = "–";
  }
}

refreshLastUpdate();
setInterval(refreshLastUpdate, 5 * 60 * 1000);


function readArmaOptionsFromUI(){
  return {
    noSplash: !!document.getElementById("optNoSplash")?.checked,
    skipIntro: !!document.getElementById("optSkipIntro")?.checked,
    window: !!document.getElementById("optWindow")?.checked,
    enableHT: !!document.getElementById("optEnableHT")?.checked,
        hugePages: !!document.getElementById("optHugePages")?.checked,
        noPause: !!document.getElementById("optNoPause")?.checked,
        noPauseAudio: !!document.getElementById("optNoPauseAudio")?.checked,
    showScriptErrors: !!document.getElementById("optShowScriptErrors")?.checked,
    extraParams: (document.getElementById("optExtraParams")?.value || "").trim()
  };
}

async function saveArmaOptionsFromUI(){
  if (!window.launcher?.settingsSetArmaOptions) return;
  const opts = readArmaOptionsFromUI();
  await window.launcher.settingsSetArmaOptions(opts);
}

async function startArma(mod){
  const hint = document.getElementById("armaStartHint");
  try{
    // if settings UI exists, save current values first
    if (document.getElementById("optNoSplash")) await saveArmaOptionsFromUI();

    const sres = await window.launcher.settingsGet();
    const opts = sres?.ok ? (sres.settings.armaOptions || {}) : {};
    const res = await window.launcher.armaStart({ mod, options: opts });

    if (!res?.ok){
      const msg = res?.error || "Arma konnte nicht gestartet werden.";
      if (hint) hint.textContent = msg; else alert(msg);
    } else {
      if (hint) hint.textContent = "Arma wird gestartet…";
    }
  }catch(err){
    const msg = (err && err.message) ? err.message : String(err);
    if (hint) hint.textContent = msg; else alert(msg);
  }
}

const btnArma = document.getElementById("btnArmaStartSettings");
if (btnArma) btnArma.addEventListener("click", ()=> startArma("@FiresideGaming_Test"));

["optNoSplash","optSkipIntro","optWindow","optEnableHT","optHugePages","optNoPause","optNoPauseAudio","optShowScriptErrors","optExtraParams"]
  .map(id=>document.getElementById(id))
  .filter(Boolean)
  .forEach(el=>{
    el.addEventListener("change", ()=>{ try{ saveArmaOptionsFromUI(); }catch{} });
    el.addEventListener("keyup", ()=>{ try{ saveArmaOptionsFromUI(); }catch{} });
  });



// Apply default Arma options on launcher start
async function applyArmaDefaults(){
  try{
    const res = await window.launcher.settingsGet();
    if (!res?.ok) return;
    const opts = res.settings.armaOptions || {};
    let changed = false;

    // required defaults
    if (opts.noPause !== true) { opts.noPause = true; changed = true; }
    if (opts.noPauseAudio !== true) { opts.noPauseAudio = true; changed = true; }

    // performance defaults should be OFF unless user explicitly enables them later
    if (opts.enableHT !== false) { opts.enableHT = false; changed = true; }
    if (opts.hugePages !== false) { opts.hugePages = false; changed = true; }

    if (changed && window.launcher.settingsSetArmaOptions){
      await window.launcher.settingsSetArmaOptions(opts);
    }
  }catch{}
}

// run defaults once on load
applyArmaDefaults();


// Ensure global button works on every page (wait for DOM)
window.addEventListener("DOMContentLoaded", () => {
  const globalBtn = document.getElementById("globalArmaStartBtn");
  if (!globalBtn) return;
  globalBtn.addEventListener("click", () => startArma("@FiresideGaming_Test"));
});
