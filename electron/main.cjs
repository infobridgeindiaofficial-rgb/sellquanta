// SellQuanta desktop shell (Electron).
// Wraps the existing app without changing it: starts the existing backend (server/index.mjs) hidden in the background with
// Electron's own built-in Node, waits until it really answers, then shows the built screen (client/dist, served by that
// backend on 127.0.0.1:8787) inside a native window. No browser, no console windows, no Vite, no separate Node install.
// Business data: in development (running from the project folder) the project's data\ folder, exactly like the browser
// version. Installed: %APPDATA%\SellQuanta Data (Program Files is read-only). Override: SELLQUANTA_DATA_ROOT.
"use strict";

const { app, BrowserWindow, Menu, shell, session, dialog, Notification } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFile } = require("node:child_process");
const dataLocation = require("./dataLocation.cjs");

const ROOT = path.resolve(__dirname, "..");          // the app files (project folder in development, resources\app when installed)
const BACKEND_PORT = 8787;                                   // client/src/api.js calls http://127.0.0.1:8787/api
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const CLIENT_DIR = path.join(ROOT, "client");
const CLIENT_DIST = path.join(CLIENT_DIR, "dist");
const ICON = path.join(ROOT, "tools", "SellQuanta.ico");
const LOADING_PAGE = path.join(__dirname, "loading.html");
const DATA_ROOT = process.env.SELLQUANTA_DATA_ROOT
  ? path.resolve(process.env.SELLQUANTA_DATA_ROOT)
  : (app.isPackaged ? dataLocation.productionDataRoot(app) : ROOT);
const DATA_FILE = path.join(DATA_ROOT, dataLocation.DB_REL);
const samePath = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Name first: it decides the userData folder (%APPDATA%\SellQuanta) and the single-instance lock.
app.setName("SellQuanta");
if (process.platform === "win32") app.setAppUserModelId("com.sellquanta.desktop");

const USER_DATA = app.getPath("userData");
const LOG_DIR = path.join(USER_DATA, "logs");
const BACKEND_PID_FILE = path.join(USER_DATA, "backend.pid");
fs.mkdirSync(LOG_DIR, { recursive: true });
// Opened only by the instance that holds the single-instance lock, so a second launch never truncates the running app's log.
let shellLog = null;
function openLog() {
  const file = path.join(LOG_DIR, "desktop.log");
  try { if (fs.existsSync(file)) fs.copyFileSync(file, path.join(LOG_DIR, "desktop.previous.log")); } catch {}
  shellLog = fs.createWriteStream(file, { flags: "w" });
}
const log = (...a) => { if (shellLog) shellLog.write(`[${new Date().toISOString()}] ${a.join(" ")}\n`); };

let win = null;
let backend = null;            // ChildProcess when this shell started the backend
let backendPid = null;         // pid of a backend this shell owns (started now, or left over from an earlier SellQuanta run)
let ollamaChild = null;        // only set when SellQuanta itself started Ollama (a pre-existing Ollama is never stopped)
let quitting = false;
let cleanedUp = false;
let starting = false;

// ---------------------------------------------------------------------------------------------------------------------
// Only one SellQuanta: a second launch just brings the existing window to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  openLog();
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(main);
}

// ---------------------------------------------------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, timeoutMs = 1500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, error: e };
  }
}

async function waitFor(check, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (quitting) return false;
    if (await check()) return true;
    await sleep(400);
  }
  return false;
}

function setStatus(text) {
  log("status:", text);
  if (win && !win.isDestroyed()) win.webContents.executeJavaScript(`window.setStatus && setStatus(${JSON.stringify(text)})`).catch(() => {});
}
function setError(text) {
  log("error:", text);
  if (win && !win.isDestroyed()) win.webContents.executeJavaScript(`window.setError && setError(${JSON.stringify(text)})`).catch(() => {});
}

function killTree(pid) {
  // taskkill /T also stops the process's own children. windowsHide: no console flash.
  return new Promise(resolve => {
    if (!pid) return resolve();
    if (process.platform !== "win32") { try { process.kill(pid); } catch {} return resolve(); }
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Backend

// "down" = nothing listening, "ours" = a SellQuanta backend answers, "other" = some other program owns the port.
// Readiness is checked on a real API response, never on cosmetic page text.
async function backendState() {
  const r = await get(`${BACKEND_ORIGIN}/api/server-info`);
  if (r.status === 0) return { state: "down" };
  try {
    const info = JSON.parse(r.text);
    if (r.ok && Number.isInteger(info.pid) && info.startedAt) return { state: "ours", pid: info.pid, startedAt: info.startedAt, dataFile: info.dataFile };
  } catch {}
  return { state: "other" };
}

async function uiServed() {
  const r = await get(`${BACKEND_ORIGIN}/`);
  return r.ok && /id="root"/.test(r.text) && /<script[^>]+type="module"/.test(r.text);
}

function readOwnedPid() {
  try { return Number(fs.readFileSync(BACKEND_PID_FILE, "utf8").trim()) || null; } catch { return null; }
}

function startBackend() {
  const out = fs.createWriteStream(path.join(LOG_DIR, "backend.log"), { flags: "w" });
  backend = spawn(process.execPath, [path.join(ROOT, "server", "index.mjs")], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(BACKEND_PORT), SELLQUANTA_CLIENT_DIST: CLIENT_DIST, SELLQUANTA_DATA_ROOT: DATA_ROOT },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  backendPid = backend.pid;
  try { fs.writeFileSync(BACKEND_PID_FILE, String(backend.pid)); } catch {}
  backend.stdout.pipe(out);
  backend.stderr.pipe(out);
  log("backend started, pid", backend.pid);
  const child = backend;
  child.on("error", e => log("backend spawn error:", e.message));
  child.on("exit", code => {
    log("backend exited, code", code);
    if (backend === child) { backend = null; backendPid = null; }
    if (!quitting) {
      setTimeout(() => {
        if (quitting) return;
        if (win && !win.isDestroyed() && !win.webContents.getURL().startsWith("file:")) win.loadFile(LOADING_PAGE).then(() =>
          setError(`The SellQuanta engine stopped unexpectedly.\nYour data is safe. Click Try again to restart it.\n\nDetails were saved to: ${path.join(LOG_DIR, "backend.log")}`));
        else setError(`The SellQuanta engine stopped unexpectedly.\nYour data is safe. Click Try again to restart it.\n\nDetails were saved to: ${path.join(LOG_DIR, "backend.log")}`);
      }, 200);
    }
  });
}

async function stopOwnedBackend() {
  const pid = backendPid;
  const child = backend;
  backend = null;
  backendPid = null;
  if (!pid) return;
  log("stopping backend, pid", pid);
  await killTree(pid);
  if (child && child.exitCode === null) await Promise.race([new Promise(r => child.once("exit", r)), sleep(5000)]);
  await waitFor(async () => (await backendState()).state === "down", 5);
  try { fs.unlinkSync(BACKEND_PID_FILE); } catch {}
}

// ---------------------------------------------------------------------------------------------------------------------
// Dev only: keep client/dist in step with client/src, so the desktop window never shows an out-of-date screen.
// (A packaged install ships a finished client/dist and never rebuilds.)
function newestMtime(p) {
  let st;
  try { st = fs.statSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const name of fs.readdirSync(p)) newest = Math.max(newest, newestMtime(path.join(p, name)));
  return newest;
}

function clientBuildNeeded() {
  const vite = path.join(CLIENT_DIR, "node_modules", "vite", "bin", "vite.js");
  if (app.isPackaged || !fs.existsSync(vite)) return false;
  const built = newestMtime(path.join(CLIENT_DIST, "index.html"));
  if (!built) return true;
  const src = Math.max(newestMtime(path.join(CLIENT_DIR, "src")), newestMtime(path.join(CLIENT_DIR, "public")),
                       newestMtime(path.join(CLIENT_DIR, "index.html")), newestMtime(path.join(CLIENT_DIR, "vite.config.js")));
  return src > built;
}

function buildClient() {
  return new Promise(resolve => {
    const out = fs.createWriteStream(path.join(LOG_DIR, "client-build.log"), { flags: "w" });
    const p = spawn(process.execPath, [path.join(CLIENT_DIR, "node_modules", "vite", "bin", "vite.js"), "build"], {
      cwd: CLIENT_DIR, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    p.stdout.pipe(out);
    p.stderr.pipe(out);
    p.on("error", e => { log("client build error:", e.message); resolve(false); });
    p.on("exit", code => { log("client build exit", code); resolve(code === 0); });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Ollama: use a running one; otherwise start an installed one silently; if not installed, SellQuanta still opens.
// Models and settings are the user's own Ollama install (inherited environment, e.g. OLLAMA_MODELS); nothing is pulled.

async function ollamaUp() {
  return (await get(`${OLLAMA_ORIGIN}/api/tags`, 1500)).ok;
}

function findOllama() {
  const candidates = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) if (dir) candidates.push(path.join(dir.replace(/"/g, ""), "ollama.exe"));
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"));
  for (const pf of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) if (pf) candidates.push(path.join(pf, "Ollama", "ollama.exe"));
  return candidates.find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
}

async function ensureOllama() {
  if (await ollamaUp()) { log("ollama: already running - using it"); return "running"; }
  const exe = findOllama();
  if (!exe) { log("ollama: not installed - AI label scanning will show a setup message"); return "not-installed"; }
  log("ollama: starting", exe);
  try {
    ollamaChild = spawn(exe, ["serve"], { env: process.env, windowsHide: true, stdio: "ignore" });
    ollamaChild.on("error", e => { log("ollama start error:", e.message); ollamaChild = null; });
    ollamaChild.on("exit", code => { log("ollama exited, code", code); ollamaChild = null; });
  } catch (e) {
    log("ollama start error:", e.message);
    ollamaChild = null;
    return "failed";
  }
  return "starting";
}

async function stopOwnedOllama() {
  if (!ollamaChild) return;
  log("stopping the Ollama that SellQuanta started, pid", ollamaChild.pid);
  await killTree(ollamaChild.pid);
  ollamaChild = null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Window + security

function isAppUrl(url) {
  return url === BACKEND_ORIGIN || url.startsWith(`${BACKEND_ORIGIN}/`);
}

function openExternally(url) {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) shell.openExternal(url).catch(() => {});
}

function hardenSession() {
  // Deny every browser permission prompt except copying to the clipboard and fullscreen.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === "clipboard-sanitized-write" || permission === "fullscreen"));

  // Excel exports / templates / backups: saved straight into Downloads like a browser does (never overwriting a file),
  // with a Windows notification; clicking it shows the file in its folder.
  session.defaultSession.on("will-download", (_e, item) => {
    const dir = process.env.SELLQUANTA_DOWNLOAD_DIR || app.getPath("downloads");
    const name = item.getFilename() || "SellQuanta-download";
    const ext = path.extname(name), base = path.basename(name, ext);
    let target = path.join(dir, name);
    for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${base} (${i})${ext}`);
    item.setSavePath(target);
    item.once("done", (_ev, state) => {
      log("download", state, target);
      if (state !== "completed" || !Notification.isSupported()) return;
      const n = new Notification({ title: "SellQuanta", body: `Saved to ${path.basename(dir)}: ${path.basename(target)}`, icon: ICON, silent: true });
      n.on("click", () => shell.showItemInFolder(target));
      n.show();
    });
  });
}

app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", e => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) openExternally(url);          // web links open in the default browser
    return { action: "deny" };                        // never a second Electron window
  });
  contents.on("will-navigate", (e, url) => {
    const current = contents.getURL();
    if (isAppUrl(url)) return;                        // SellQuanta itself
    if (url.startsWith("file:") && current.startsWith("file:")) return; // the loading page
    e.preventDefault();
    openExternally(url);
  });
  contents.on("will-redirect", (e, url) => { if (!isAppUrl(url) && !url.startsWith("file:")) e.preventDefault(); });
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "SellQuanta",
    icon: ICON,
    backgroundColor: "#F7F7F4",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });
  win.once("ready-to-show", () => { win.maximize(); win.show(); });
  win.on("closed", () => { win = null; });
  // If the page itself crashes, reload it (the backend and data are unaffected).
  win.webContents.on("render-process-gone", (_e, details) => {
    log("renderer gone:", details.reason);
    if (!quitting && details.reason !== "clean-exit" && win && !win.isDestroyed()) setTimeout(() => win && !win.isDestroyed() && win.webContents.reload(), 500);
  });

  // Keyboard: F5 / Ctrl+R reload the screen; F12 opens DevTools in development only.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const k = input.key.toLowerCase();
    if (k === "f5" || (input.control && k === "r")) { e.preventDefault(); if (!win.webContents.getURL().startsWith("file:")) win.webContents.reload(); }
    if (k === "f12" && !app.isPackaged) { e.preventDefault(); win.webContents.toggleDevTools(); }
  });

  // "Try again" on the loading/error page sets location.hash.
  win.webContents.on("did-navigate-in-page", (_e, url) => { if (/#retry-/.test(url)) start(); });
  return win.loadFile(LOADING_PAGE);
}

// ---------------------------------------------------------------------------------------------------------------------
// Start-up

async function start() {
  if (starting || quitting) return;
  starting = true;
  try {
    await startInner();
  } catch (e) {
    setError(`Unexpected start-up problem: ${e.message}\n\nDetails: ${path.join(LOG_DIR, "desktop.log")}`);
  } finally {
    starting = false;
  }
}

async function startInner() {
  setStatus("Starting SellQuanta...");

  // 1. Local AI (Ollama). Settled before the backend starts, so the backend never races to start a second copy of it.
  setStatus("Checking local AI (Ollama)...");
  const ollama = await ensureOllama();
  if (ollama === "starting") {
    setStatus("Starting local AI (Ollama)...");
    const up = await waitFor(ollamaUp, 15);
    log(up ? "ollama: ready" : "ollama: not ready after 15s - continuing; label scanning will say so if it stays down");
  }

  // 2. Dev only: rebuild the screen if its source changed since the last build.
  if (clientBuildNeeded()) {
    setStatus("Updating the SellQuanta screen (first start after a change can take a few seconds)...");
    const built = await buildClient();
    if (!built && !fs.existsSync(path.join(CLIENT_DIST, "index.html"))) {
      return setError(`The SellQuanta screen could not be built.\n\nDetails: ${path.join(LOG_DIR, "client-build.log")}`);
    }
  }
  if (!fs.existsSync(path.join(CLIENT_DIST, "index.html"))) {
    return setError("The SellQuanta screen (client\\dist) is missing. Run: npm --prefix client run build");
  }

  // 3. Is a SellQuanta engine already running? Reuse it only if it is one this app started and it uses the same data.
  setStatus("Starting the SellQuanta engine...");
  let b = await backendState();
  if (b.state === "other") {
    return setError("Another program on this computer is using the connection SellQuanta needs, so SellQuanta cannot start.\nClose that program (or restart the computer) and click Try again.");
  }
  if (b.state === "ours") {
    const owned = readOwnedPid() === b.pid;       // left behind by an earlier SellQuanta desktop run
    const sameData = samePath(b.dataFile, DATA_FILE);
    if (owned && sameData && await uiServed()) {
      backendPid = b.pid;
      log("reusing SellQuanta backend from an earlier run, pid", b.pid);
    } else if (owned) {
      log("restarting a SellQuanta backend from an earlier run, pid", b.pid);
      backendPid = b.pid;
      await stopOwnedBackend();
      b = { state: "down" };
    } else {
      return setError("SellQuanta is already open in the browser version (the window named 'SellQuanta Backend').\nClose that window, then click Try again.");
    }
  }

  // 4. First start of the installed app: offer to import existing data (copied and verified, never moved or overwritten).
  if (b.state === "down" && !fs.existsSync(DATA_FILE)) {
    const ok = await offerImport();
    if (!ok) return;
  }

  // 5. Start our own engine.
  if (b.state === "down") {
    startBackend();
    const ready = await waitFor(async () => { const s = await backendState(); return s.state === "ours" && samePath(s.dataFile, DATA_FILE) && await uiServed(); }, 45);
    if (quitting) return;
    if (!ready) return setError(`The SellQuanta engine did not start within 45 seconds.\n\nDetails were saved to: ${path.join(LOG_DIR, "backend.log")}`);
  }

  setStatus("Opening SellQuanta...");
  if (!quitting && win && !win.isDestroyed()) await win.loadURL(`${BACKEND_ORIGIN}/`);
}

async function offerImport() {
  const roots = process.env.SELLQUANTA_LEGACY_ROOTS ? process.env.SELLQUANTA_LEGACY_ROOTS.split(path.delimiter) : dataLocation.defaultLegacyRoots(app);
  const legacy = dataLocation.findLegacy(roots, DATA_ROOT);
  if (!legacy) { log("no existing data found to import - starting with a new, empty data file in", DATA_ROOT); return true; }
  const s = legacy.summary;
  log("existing data found:", legacy.file, JSON.stringify(s));
  let choice = { import: 0, fresh: 1, cancel: 2 }[process.env.SELLQUANTA_TEST_IMPORT_ANSWER];   // automated tests only
  if (choice === undefined) {
    const r = await dialog.showMessageBox(win, {
      type: "question",
      title: "SellQuanta",
      message: "Use your existing SellQuanta data?",
      detail: `SellQuanta found data from the browser version on this computer:\n${legacy.file}\n\n` +
        `Companies: ${s.companies}   Products: ${s.products}   Agents: ${s.agents}\nSales history: ${s.salesHistory}   Today's sales: ${s.todaySales}\n` +
        `Last changed: ${s.modified.toLocaleString()}\n\n` +
        `"Import my data" COPIES it into SellQuanta's data folder:\n${DATA_ROOT}\n` +
        `A verified backup is made first. The original file is not changed or deleted.\n\n` +
        `Close the browser version of SellQuanta before importing.`,
      buttons: ["Import my data", "Start with empty data", "Exit"],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    choice = r.response;
  }
  if (choice === 2) { log("import: user chose Exit"); app.quit(); return false; }
  if (choice === 1) { log("import: user chose to start with empty data"); return true; }
  setStatus("Importing your existing data (making a verified backup first)...");
  try {
    const result = dataLocation.importLegacy(legacy, DATA_ROOT, log);
    log("import: done", JSON.stringify(result));
    return true;
  } catch (e) {
    log("import failed:", e.message);
    setError(`Your existing data could not be imported, so nothing was changed.\n${e.message}\n\nClick Try again.`);
    return false;
  }
}

async function main() {
  Menu.setApplicationMenu(null);
  hardenSession();
  log(`SellQuanta ${app.getVersion()} starting. electron ${process.versions.electron}, node ${process.versions.node}, packaged ${app.isPackaged}, app ${ROOT}, data ${DATA_ROOT}`);
  await createWindow();
  start();
}

// ---------------------------------------------------------------------------------------------------------------------
// Shutdown: stop only what SellQuanta started (its backend, and Ollama only if SellQuanta started it).

app.on("window-all-closed", () => app.quit());

app.on("before-quit", e => {
  if (cleanedUp) return;
  e.preventDefault();
  if (quitting) return;
  quitting = true;
  log("quitting");
  Promise.allSettled([stopOwnedBackend(), stopOwnedOllama()]).finally(() => {
    cleanedUp = true;
    log("clean exit");
    if (shellLog) shellLog.end(() => app.quit()); else app.quit();
  });
});
