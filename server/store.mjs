import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Business-data folder (data/, backups/, exports/). Default: the project folder, exactly as before. The installed SellQuanta desktop app
// sets SELLQUANTA_DATA_ROOT to a writable per-user folder, because Program Files is read-only.
const root = process.env.SELLQUANTA_DATA_ROOT ? path.resolve(process.env.SELLQUANTA_DATA_ROOT) : path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const backupDir = path.join(root, "backups");
const exportDir = path.join(root, "exports");
const dbFile = path.join(dataDir, "stockpilot.json");

for (const dir of [dataDir, backupDir, exportDir]) fs.mkdirSync(dir, { recursive: true });

export const emptyDb = () => ({
  meta: { version: 1, createdAt: new Date().toISOString(), lastBackupDate: null },
  agents: [],
  accounts: [],
  companies: [], // User-owned records. Existing arrays/IDs are retained by normalize().
  products: [],
  productMaster: [],
  todaySales: [],
  salesHistory: [],
  ledger: [],
  stockMovements: [],
  refunds: [],
  monthCloseArchive: [] // permanent, read-only Month Close snapshots - see /api/month-close in server/index.mjs
});

// Product Master used to point at agents. Move those records to the matching Company by name; keep the rest untouched.
function migrateProductMaster(list, companies, agents) {
  return list.map(m => {
    if (m.companyId || !m.agentId) return m;
    const agentName = agents.find(a => a.id === m.agentId)?.name?.trim().toLowerCase();
    const company = agentName && companies.find(c => c.name.trim().toLowerCase() === agentName);
    if (!company) return m;
    const { agentId, ...rest } = m;
    return { ...rest, companyId: company.id, legacyAgentId: agentId };
  });
}

function normalize(db) {
  const base = emptyDb();
  const companies = Array.isArray(db.companies) ? db.companies : base.companies;
  const agents = Array.isArray(db.agents) ? db.agents : [];
  return {
    ...base,
    ...db,
    meta: { ...base.meta, ...(db.meta || {}) },
    agents,
    companies,
    accounts: Array.isArray(db.accounts) ? db.accounts : [],
    products: Array.isArray(db.products) ? db.products : [],
    refunds: Array.isArray(db.refunds) ? db.refunds : [],
    productMaster: migrateProductMaster(Array.isArray(db.productMaster) ? db.productMaster : [], companies, agents),
    todaySales: Array.isArray(db.todaySales) ? db.todaySales : [],
    salesHistory: Array.isArray(db.salesHistory) ? db.salesHistory : [],
    ledger: Array.isArray(db.ledger) ? db.ledger : [],
    stockMovements: Array.isArray(db.stockMovements) ? db.stockMovements : [],
    monthCloseArchive: Array.isArray(db.monthCloseArchive) ? db.monthCloseArchive : [],
    // Wallet Reset baselines (see /api/agents/:id/reset-wallet). Added 2026-09: older files simply have none.
    walletResets: Array.isArray(db.walletResets) ? db.walletResets : []
  };
}

export function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

const ACCOUNT_MARKETPLACES = ["Amazon", "Flipkart", "Meesho"];

// Give the agent exactly one account per marketplace; only missing ones are created.
export function ensureAccounts(db, agent) {
  for (const marketplace of ACCOUNT_MARKETPLACES) {
    if (db.accounts.some(a => a.agentId === agent.id && a.marketplace === marketplace)) continue;
    db.accounts.push({ id: uid("acct"), agentId: agent.id, marketplace, name: `${agent.name} - ${marketplace}`, active: true });
  }
}

// Remove duplicate agents (same name, ignoring case) only when it loses no history.
// If two or more duplicates have sales/ledger/stock history, nothing is deleted and the group is reported.
export function dedupeAgents(db) {
  const used = new Set([...db.ledger, ...db.todaySales, ...db.salesHistory, ...db.stockMovements].map(x => x.agentId).filter(Boolean));
  const groups = new Map();
  for (const a of db.agents) {
    const key = String(a.name).trim().toLowerCase();
    groups.set(key, [...(groups.get(key) || []), a]);
  }
  const removed = [], conflicts = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const withHistory = list.filter(a => used.has(a.id));
    if (withHistory.length > 1) { conflicts.push({ name: list[0].name, ids: withHistory.map(a => a.id) }); continue; }
    const keep = withHistory[0] || list[0];
    for (const a of list) {
      if (a === keep) continue;
      if (!keep.companyId && a.companyId) keep.companyId = a.companyId;
      db.agents = db.agents.filter(x => x !== a);
      db.accounts = db.accounts.filter(x => x.agentId !== a.id);
      removed.push({ name: a.name, id: a.id, keptId: keep.id });
    }
  }
  return { removed, conflicts };
}

// One-time backfill of cost snapshots on older sales, and conversion of their SALE ledger entries from selling amount to cost.
// Only done when the sale links to an existing product that has a cost price; otherwise the record is left untouched.
// The original ledger amount is kept in sellingAmount. Already-converted entries (costBasis) are never touched again.
export function migrateSaleCosts(db) {
  const sales = new Map([...db.todaySales, ...db.salesHistory].map(s => [s.id, s]));
  const report = { backfilled: 0, ledgerConverted: 0, skipped: 0 };
  for (const s of sales.values()) {
    if (typeof s.unitCost === "number") continue;
    const p = db.products.find(x => x.id === s.productId);
    if (!p || typeof p.costPrice !== "number") { report.skipped++; continue; }
    s.unitCost = p.costPrice;
    s.costTotal = p.costPrice * Number(s.qty || 0);
    report.backfilled++;
  }
  for (const l of db.ledger) {
    if (l.type !== "SALE" || l.costBasis) continue;
    const s = sales.get(l.referenceId);
    if (!s || typeof s.costTotal !== "number") continue;
    l.sellingAmount = l.amount;
    l.amount = s.costTotal;
    l.costBasis = true;
    report.ledgerConverted++;
  }
  return report;
}

// Older sales (today's and archived) lack the reporting snapshot fields. Fill ONLY missing ones from data that clearly links to the sale.
// Quantities, amounts, costs and stock are never changed; already-filled fields are never overwritten, so this is safe to re-run.
export function backfillSaleHistory(db) {
  let touched = 0;
  const norm = v => String(v ?? "").trim().toLowerCase();
  for (const s of [...db.todaySales, ...db.salesHistory]) {
    let changed = false;
    const set = (k, v) => { s[k] = v; changed = true; };
    const agent = db.agents.find(a => a.id === s.agentId);
    if (!s.companyId && agent?.companyId) set("companyId", agent.companyId);
    if (!s.companyName && s.companyId) { const c = db.companies.find(x => x.id === s.companyId); if (c) set("companyName", c.name); }
    if (!s.agentName && agent) set("agentName", agent.name);
    if (!s.warehouseProductCode) { const p = db.products.find(x => x.id === s.productId); if (p?.sku || s.sku) set("warehouseProductCode", p?.sku || s.sku); }
    if (s.marketplaceSku === undefined) {
      const mapped = db.productMaster.filter(m => m.companyId === s.companyId && m.productId === s.productId && norm(m.marketplace) === norm(s.marketplace));
      set("marketplaceSku", mapped.length === 1 ? mapped[0].marketplaceSku : ""); // "" = not clearly known; never guessed
    }
    if (!("profit" in s)) set("profit", null);
    if (changed) touched++;
  }
  return touched;
}

// Sales saved before batch tracking have no batchId. Group today's ones that were created within 3 seconds of each other
// (same agent and source), which is how one Save click behaved, so the newest group can be undone. Archived sales are left alone.
export function assignLegacyBatches(db) {
  let labelled = 0, n = 0, prev = null, current = "";
  for (const s of db.todaySales) {
    if (s.batchId) { prev = null; continue; }
    const t = Date.parse(s.createdAt || "");
    const sameGroup = prev && Number.isFinite(t) && Number.isFinite(prev.t) && t - prev.t <= 3000 && prev.agentId === s.agentId && prev.source === s.source;
    if (!sameGroup) current = `batch_${String(s.date || "").replaceAll("-", "")}_legacy${++n}_${uid("").slice(1, 9)}`;
    s.batchId = current;
    prev = { t, agentId: s.agentId, source: s.source };
    labelled++;
  }
  return labelled;
}

// ---- Storage -------------------------------------------------------------------------------------------------------
// ALL permanent business data lives in ONE file: data/stockpilot.json. It is only ever replaced by an atomic rename, so a crash
// or power cut mid-write leaves the previous complete file in place.
function writeFileAtomic(file, db) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(temp, file);
}

export function readDb() {
  if (!fs.existsSync(dbFile)) {          // first run only: start a new empty database
    const db = emptyDb();
    saveDb(db);
    return db;
  }
  try {
    return normalize(JSON.parse(fs.readFileSync(dbFile, "utf8")));
  } catch (e) {
    // NEVER replace an unreadable file with an empty database (that would silently wipe the business data).
    // Keep a copy for inspection, stop, and let the owner restore from backups/.
    const broken = `${dbFile}.unreadable-${Date.now()}`;
    try { fs.copyFileSync(dbFile, broken); } catch {}
    throw new Error(`The StockPilot data file could not be read (${e.message}). Nothing was changed. Restore the newest file from the backups folder.`);
  }
}

export function saveDb(input) {
  const db = normalize(input);
  autoBackupOncePerDay();                 // safe: copies the current file before the first write of a new day, never blocks the save
  writeFileAtomic(dbFile, db);
  return db;
}

export function mutate(mutator) {
  const db = readDb();
  const result = mutator(db);
  saveDb(db);
  return result;
}

// ---- Backups -------------------------------------------------------------------------------------------------------
// Automatic: at most ONE backup per local calendar day (backups/stockpilot-YYYY-MM-DD.json), made the first time StockPilot is used
// that day (server start or first save). The newest 30 daily backups are kept; older ones are removed. Manual backups live in
// backups/manual/ and are never removed automatically. A backup only READS the live file: a backup failure cannot change live data.
export const BACKUP_KEEP_DAYS = 30;
const DAILY_RE = /^stockpilot-(\d{4}-\d{2}-\d{2})\.json$/;
const pad2 = n => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Copy the live file to `target` safely: validate it first, write to a temp file, verify, then rename. Never overwrites `target`.
function safeCopyOfLive(target) {
  if (fs.existsSync(target)) return "exists";
  if (!fs.existsSync(dbFile)) return "no-live-file";
  const text = fs.readFileSync(dbFile, "utf8");
  const parsed = JSON.parse(text);                                   // an unreadable/partial file is never backed up
  if (!parsed || !Array.isArray(parsed.products) || !Array.isArray(parsed.agents)) throw new Error("live file is not a StockPilot database");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  try {
    fs.writeFileSync(temp, text, "utf8");
    if (fs.readFileSync(temp, "utf8") !== text) throw new Error("backup copy did not verify");
    fs.renameSync(temp, target);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch {}
    throw e;
  }
  return "created";
}

// Keep the newest BACKUP_KEEP_DAYS daily files (by the date in the file name); remove only older, correctly-named daily files.
function pruneDailyBackups() {
  const days = fs.readdirSync(backupDir).map(f => ({ f, m: DAILY_RE.exec(f) })).filter(x => x.m).sort((a, b) => b.m[1].localeCompare(a.m[1]));
  for (const old of days.slice(BACKUP_KEEP_DAYS)) { try { fs.unlinkSync(path.join(backupDir, old.f)); } catch {} }
}

let backupDoneFor = "";
let backupRetryAt = 0;
export function autoBackupOncePerDay() {
  const day = localDay();
  if (backupDoneFor === day || Date.now() < backupRetryAt) return { status: "skipped" };
  try {
    const status = safeCopyOfLive(path.join(backupDir, `stockpilot-${day}.json`));
    if (status === "no-live-file") return { status };
    backupDoneFor = day;
    pruneDailyBackups();
    return { status, day };
  } catch (e) {
    backupRetryAt = Date.now() + 10 * 60 * 1000;                    // try again in 10 minutes; live data is unaffected
    console.error(`Daily backup failed (live data is unaffected): ${e.message}`);
    return { status: "failed", error: e.message };
  }
}

// Manual backup ("Back Up Now"): a new timestamped file every time, kept until you delete it.
export function manualBackup() {
  const now = new Date();
  const name = `stockpilot-manual-${localDay(now).replace(/-/g, "")}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}.json`;
  const target = path.join(backupDir, "manual", name);
  const status = safeCopyOfLive(target);
  if (status !== "created") throw new Error("Backup was not created (" + status + ").");
  return { file: path.relative(root, target).replace(/\\/g, "/") };
}

export function backupInfo() {
  const daily = fs.readdirSync(backupDir).map(f => DAILY_RE.exec(f)).filter(Boolean).map(m => m[1]).sort().reverse();
  const manualDir = path.join(backupDir, "manual");
  const manual = fs.existsSync(manualDir) ? fs.readdirSync(manualDir).filter(f => f.endsWith(".json")).sort().reverse() : [];
  return { folder: "backups", keepDays: BACKUP_KEEP_DAYS, dailyCount: daily.length, newestDaily: daily[0] || null, manualCount: manual.length, newestManual: manual[0] || null };
}

export const paths = { root, dataDir, backupDir, exportDir, dbFile };
