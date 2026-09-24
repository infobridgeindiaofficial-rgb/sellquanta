// SellQuanta desktop: where business data lives, and a careful one-time import of existing data.
// Rules: never overwrite existing data, never modify the source, verify every copy by SHA-256 before it is used.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DB_REL = path.join("data", "stockpilot.json");
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

// Installed app: %APPDATA%\SellQuanta Data  (data\, backups\, exports\). Kept outside the install folder and outside
// Electron's own profile folder, so updates and uninstall never touch it.
function productionDataRoot(app) {
  return path.join(app.getPath("appData"), "SellQuanta Data");
}

// Places an existing SellQuanta/StockPilot project folder is usually found (the browser version).
function defaultLegacyRoots(app) {
  const home = app.getPath("home");
  const desktops = [app.getPath("desktop"), path.join(home, "Desktop"), path.join(home, "OneDrive", "Desktop")];
  return [...new Set(desktops.map(d => path.join(d, "StockPilot-Fresh")))];
}

// Reads a database file for display only. Returns null if it is not a readable SellQuanta database.
function summarize(file) {
  try {
    const db = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!db || !Array.isArray(db.products) || !Array.isArray(db.agents)) return null;
    const n = k => (Array.isArray(db[k]) ? db[k].length : 0);
    return {
      companies: n("companies"), products: n("products"), agents: n("agents"), productMaster: n("productMaster"),
      todaySales: n("todaySales"), salesHistory: n("salesHistory"), bytes: fs.statSync(file).size,
      modified: fs.statSync(file).mtime
    };
  } catch {
    return null;
  }
}

function findLegacy(candidates, targetRoot) {
  for (const root of candidates) {
    const file = path.join(root, DB_REL);
    if (path.resolve(root).toLowerCase() === path.resolve(targetRoot).toLowerCase()) continue;
    const summary = fs.existsSync(file) ? summarize(file) : null;
    if (summary) return { root, file, summary };
  }
  return null;
}

// Copy one file without ever overwriting; verified by hash. Returns true if copied.
function copyVerified(src, dest) {
  if (fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.import-${process.pid}.tmp`;
  fs.copyFileSync(src, tmp);
  if (sha256(tmp) !== sha256(src)) { fs.rmSync(tmp, { force: true }); throw new Error(`Copy verification failed for ${src}`); }
  fs.renameSync(tmp, dest);
  return true;
}

function copyTreeNoOverwrite(srcDir, destDir, filter = () => true) {
  let copied = 0;
  if (!fs.existsSync(srcDir)) return copied;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name), d = path.join(destDir, entry.name);
    if (entry.isDirectory()) copied += copyTreeNoOverwrite(s, d, filter);
    else if (entry.isFile() && filter(entry.name) && copyVerified(s, d)) copied++;
  }
  return copied;
}

// One-time import. Source is only read. Order: verified safety backup first, then history files, then the live file last
// (written to a temp name, verified, then renamed), so a failure can never leave a half-imported database in use.
function importLegacy(legacy, targetRoot, log = () => {}) {
  const targetDb = path.join(targetRoot, DB_REL);
  if (fs.existsSync(targetDb)) throw new Error(`SellQuanta data already exists at ${targetDb}; nothing was imported.`);
  const srcHash = sha256(legacy.file);

  // 1. Verified backup of the source database inside the new data folder.
  const backupDir = path.join(targetRoot, "backups", `import-${stamp()}`);
  const backupFile = path.join(backupDir, "stockpilot.json");
  copyVerified(legacy.file, backupFile);
  if (sha256(backupFile) !== srcHash) throw new Error("Import backup verification failed; nothing was imported.");
  fs.writeFileSync(path.join(backupDir, "SOURCE.txt"),
    `Imported from: ${legacy.file}\r\nSHA-256: ${srcHash}\r\nImported at: ${new Date().toISOString()}\r\nThe original file was not changed.\r\n`);
  log(`import: verified backup ${backupFile} (${srcHash})`);

  // 2. History that the app reads or that the user may want: daily/manual backups, month-close archives, reset backups, exports.
  let history = 0;
  const b = path.join(legacy.root, "backups");
  if (fs.existsSync(b)) {
    for (const f of fs.readdirSync(b)) if (/^stockpilot-\d{4}-\d{2}-\d{2}\.json$/.test(f)) history += copyVerified(path.join(b, f), path.join(targetRoot, "backups", f)) ? 1 : 0;
    for (const sub of ["manual", "month-close", "business-reset"]) history += copyTreeNoOverwrite(path.join(b, sub), path.join(targetRoot, "backups", sub), n => n.endsWith(".json"));
  }
  history += copyTreeNoOverwrite(path.join(legacy.root, "exports"), path.join(targetRoot, "exports"), n => /\.xlsx$/i.test(n));
  fs.mkdirSync(path.join(targetRoot, "exports"), { recursive: true });
  log(`import: ${history} history/export file(s) copied`);

  // 3. The live database, last. Refuse if the source changed while importing (e.g. the browser version was saving).
  if (sha256(legacy.file) !== srcHash) throw new Error("The existing data file changed while it was being imported. Close the browser version of SellQuanta and try again.");
  fs.mkdirSync(path.dirname(targetDb), { recursive: true });
  copyVerified(backupFile, targetDb);
  const finalHash = sha256(targetDb);
  if (finalHash !== srcHash) { fs.rmSync(targetDb, { force: true }); throw new Error("Import verification failed; nothing was imported."); }
  log(`import: database imported to ${targetDb} (${finalHash})`);
  return { targetDb, backupFile, sha256: finalHash, historyFiles: history };
}

module.exports = { DB_REL, productionDataRoot, defaultLegacyRoots, summarize, findLegacy, importLegacy, sha256 };
