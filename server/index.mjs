import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { readDb, mutate, uid, paths, emptyDb, ensureAccounts, dedupeAgents, migrateSaleCosts, assignLegacyBatches, backfillSaleHistory, autoBackupOncePerDay, manualBackup, backupInfo } from "./store.mjs";
import { ensureOllama, scanLabel, OLLAMA_SETTINGS } from "./ollama.mjs";
import { buildDayWorkbook } from "./excel.mjs";
import { buildWarehouseBackup, buildCompanyMasterBackup, companyBackupFilename, backupDate } from "./backupExports.mjs";
import { createCompleteReset } from "./completeReset.mjs";

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "35mb" }));

const today = () => new Date().toISOString().slice(0, 10);
const num = v => Number(v || 0);
// A removed warehouse product is kept as an archived record (active: false). Products saved before this existed have no flag = active.
const isActive = p => p.active !== false;

function publicState(db) {
  // dueByAgent = the same current balance the wallet screens show (walletTotals below), so every view agrees.
  const dueByAgent = {};
  for (const id of new Set([...db.agents.map(a => a.id), ...db.ledger.map(l => l.agentId)])) dueByAgent[id] = walletTotals(db, id).pendingCents / 100;
  return { ...db, walletResets: db.walletResets || [], dueByAgent };
}

// The ONE cumulative wallet formula for an agent, shared by /api/payments (how much can still be paid) and
// /api/agents/:id/reset-wallet (how much a reset settles): Stock Cost Due (every ledger SALE entry - a sale adds its
// stock cost, a refund reversal subtracts the full sale amount, see /api/refunds) minus Wallet Credit (every PAYMENT
// plus every SETTLEMENT - a settlement is the non-cash write-off Reset Wallet creates, counted exactly like a
// payment). The balance is never negative: a credit in the agent's favour is not something StockPilot pays out.
//
// Wallet Reset baseline: each reset stores the ids of every ledger entry the agent had at that moment. The CURRENT
// wallet counts only entries created after the agent's latest reset; nothing is ever deleted, so all earlier sales,
// payments, refunds and settlements stay in the ledger, in Month Close archives and in every report.
// client/src/wallet.js mirrors this exactly.
function latestWalletReset(db, agentId) {
  const own = (db.walletResets || []).filter(r => r.agentId === agentId);
  return own.length ? own[own.length - 1] : null;
}
function currentWalletEntries(db, agentId) {
  const reset = latestWalletReset(db, agentId);
  const before = new Set(reset?.excludedLedgerIds || []);
  return db.ledger.filter(l => l.agentId === agentId && !before.has(l.id));
}
function walletTotals(db, agentId) {
  const entries = currentWalletEntries(db, agentId);
  const cents = type => Math.round(entries.filter(l => l.type === type).reduce((t, l) => t + num(l.amount), 0) * 100);
  const dueCents = cents("SALE");
  const creditCents = cents("PAYMENT") + cents("SETTLEMENT");
  return { dueCents, creditCents, balanceCents: dueCents - creditCents, pendingCents: Math.max(0, dueCents - creditCents) };
}

// Lets the launcher tell whether the running backend is older than the code on disk (Node never reloads code while running).
const serverStartedAt = new Date().toISOString();
// dataFile lets the desktop app confirm it is talking to a backend that uses the expected business-data folder.
app.get("/api/server-info", (_req, res) => res.json({ pid: process.pid, startedAt: serverStartedAt, dataFile: paths.dbFile }));

app.get("/api/health", async (_req, res) => {
  const ollama = await ensureOllama();
  res.json({ ok: true, ollama });
});

// Backups: a manual "Back Up Now" copy, and a small status read-out. (Automatic daily backups happen inside the data layer.)
app.post("/api/backup", (_req, res) => {
  try { res.json({ ok: true, ...manualBackup() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/backup-info", (_req, res) => {
  try { res.json(backupInfo()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/state", (_req, res) => res.json(publicState(readDb())));

const completeReset = createCompleteReset({ paths, emptyDb });
app.post("/api/business-reset/prepare", (_req, res) => {
  try { res.json(completeReset.prepare()); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.post("/api/business-reset", (req, res) => {
  try {
    const { database, ...result } = completeReset.reset(req.body);
    res.json({ ...result, state: publicState(database) });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// Export-only reads deliberately bypass readDb's missing-file initialization and
// legacy normalization. These endpoints never save, migrate or back up the database.
function sendBackupWorkbook(res, workbook, filename) {
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

app.get("/api/products/export-backup", (_req, res) => {
  try {
    const db = JSON.parse(fs.readFileSync(paths.dbFile, "utf8"));
    sendBackupWorkbook(res, buildWarehouseBackup(db), `StockPilot_Warehouse_Backup_${backupDate()}.xlsx`);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/product-master/export-backup", (req, res) => {
  try {
    const db = JSON.parse(fs.readFileSync(paths.dbFile, "utf8"));
    const companyId = String(req.query.companyId || "");
    const workbook = buildCompanyMasterBackup(db, companyId);
    const company = db.companies.find(c => c.id === companyId);
    sendBackupWorkbook(res, workbook, companyBackupFilename(company.name, backupDate()));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Companies use the existing ID-based records. Missing active flags mean active,
// so older installations need no migration or rewritten relationships.
function requireActiveCompany(db, id) {
  const company = db.companies.find(c => c.id === id);
  if (!company) throw new Error("Select a Company.");
  if (company.active === false) throw new Error("Company is archived. Select an active company.");
  return company;
}

function companyName(db, rawName, exceptId) {
  const name = String(rawName || "").trim();
  if (!name) throw new Error("Company name is required.");
  if (db.companies.some(c => c.id !== exceptId && c.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error("Company already exists (including archived companies).");
  }
  return name;
}

// Include nested Month Close snapshots, corrections and future operational
// collections. A matching stored ID conservatively prevents permanent deletion.
function companyHasReferences(db, id) {
  const contains = value => value === id || (value && typeof value === "object" && Object.values(value).some(contains));
  return Object.entries(db).some(([key, value]) => key !== "companies" && contains(value));
}

app.post("/api/companies", (req, res) => {
  try {
    res.json(mutate(db => {
      const name = companyName(db, req.body?.name);
      const company = { id: uid("co"), name, createdAt: new Date().toISOString() };
      db.companies.push(company);
      return company;
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/companies/:id", (req, res) => {
  try {
    res.json(mutate(db => {
      const company = db.companies.find(c => c.id === req.params.id);
      if (!company) throw new Error("Company not found.");
      company.name = companyName(db, req.body?.name, company.id);
      return company; // The ID, relationships and historical name snapshots stay unchanged.
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/companies/:id", (req, res) => {
  try {
    res.json(mutate(db => {
      const company = db.companies.find(c => c.id === req.params.id);
      if (!company) throw new Error("Company not found.");
      if (companyHasReferences(db, company.id)) {
        company.active = false;
        return { deleted: false, deactivated: true };
      }
      db.companies = db.companies.filter(c => c.id !== company.id);
      return { deleted: true, deactivated: false };
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Case-insensitive company lookup; a new permanent company (with a generated id) is created when the name is new.
function findOrCreateCompany(db, rawName) {
  const name = String(rawName || "").trim();
  if (!name) throw new Error("Company name is required.");
  let company = db.companies.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
  if (!company) {
    company = { id: uid("co"), name, createdAt: new Date().toISOString() };
    db.companies.push(company);
  }
  return requireActiveCompany(db, company.id);
}

app.post("/api/agents", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Agent name is required." });

  try {
    const result = mutate(db => {
      const nameLower = name.toLowerCase();
      const sameName = db.agents.filter(a => a.name.trim().toLowerCase() === nameLower);
      // Only an ACTIVE agent blocks the name: an archived one (removed earlier because it had history) must never make
      // its name permanently unusable. At most one agent can be active for a given name at a time.
      if (sameName.some(a => a.active !== false)) throw new Error("Agent already exists.");
      const company = req.body.companyId ? requireActiveCompany(db, req.body.companyId) : findOrCreateCompany(db, req.body.companyName);

      // Reactivate the earlier archived agent instead of creating a second record for the same name: this keeps its
      // id, so every historical sale/payment/ledger/refund entry (which points at that id) keeps showing correctly.
      const archived = sameName.find(a => a.active === false);
      if (archived) {
        archived.active = true;
        archived.companyId = company.id;
        ensureAccounts(db, archived); // usually already has its 3 accounts; adds any that are missing
        return { ...archived, reactivated: true };
      }

      const agent = { id: uid("agent"), name, companyId: company.id, active: true, createdAt: new Date().toISOString() };
      db.agents.push(agent);
      ensureAccounts(db, agent);
      return { ...agent, reactivated: false };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/agents/:id/company", (req, res) => {
  try {
    const result = mutate(db => {
      const agent = db.agents.find(a => a.id === req.params.id);
      if (!agent) throw new Error("Agent not found.");
      agent.companyId = (req.body.companyId ? requireActiveCompany(db, req.body.companyId) : findOrCreateCompany(db, req.body.companyName)).id;
      return agent;
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Agents with no history are removed with their accounts; agents with history are only deactivated.
app.delete("/api/agents/:id", (req, res) => {
  try {
    const result = mutate(db => {
      const agent = db.agents.find(a => a.id === req.params.id);
      if (!agent) throw new Error("Agent not found.");
      // ledger covers both SALE cost entries and PAYMENT entries.
      const hasHistory = [db.ledger, db.todaySales, db.salesHistory, db.stockMovements, db.refunds].some(list => list.some(x => x.agentId === agent.id));
      if (hasHistory) {
        agent.active = false;
        return { deleted: false, deactivated: true };
      }
      db.agents = db.agents.filter(a => a.id !== agent.id);
      db.accounts = db.accounts.filter(a => a.agentId !== agent.id);
      return { deleted: true, deactivated: false };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Reset Wallet: starts the agent's CURRENT wallet from a fresh ₹0 baseline. It writes ONE walletResets record (who,
// when, the balance/due/credit just before, and the ids of the ledger entries it closes off) and never edits or deletes
// a sale, payment, refund, settlement, ledger entry, agent, account or product. Requires { confirm: true }.
app.post("/api/agents/:id/reset-wallet", (req, res) => {
  try {
    if (req.body?.confirm !== true) throw new Error("Wallet reset needs confirmation.");
    const result = mutate(db => {
      const agent = db.agents.find(a => a.id === req.params.id);
      if (!agent) throw new Error("Agent not found.");
      const before = walletTotals(db, agent.id);
      const now = new Date();
      db.walletResets ||= [];
      const reset = {
        id: uid("wreset"), agentId: agent.id, agentName: agent.name, companyId: agent.companyId || "",
        resetAt: now.toISOString(), date: localDay(now),
        dueBefore: before.dueCents / 100, creditBefore: before.creditCents / 100,
        balanceBefore: before.balanceCents / 100, pendingBefore: before.pendingCents / 100,
        excludedLedgerIds: db.ledger.filter(l => l.agentId === agent.id).map(l => l.id),
        note: String(req.body?.note || "Wallet reset").slice(0, 200)
      };
      db.walletResets.push(reset);
      return { reset: true, settled: before.pendingCents > 0, amount: before.pendingCents / 100, resetRecord: { ...reset, excludedLedgerIds: undefined, excludedCount: reset.excludedLedgerIds.length } };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/accounts", (req, res) => {
  const { agentId, marketplace, name } = req.body;
  if (!agentId || !marketplace || !name) return res.status(400).json({ error: "agentId, marketplace and name are required." });
  const result = mutate(db => {
    const account = { id: uid("acct"), agentId, marketplace, name, active: true };
    db.accounts.push(account);
    return account;
  });
  res.json(result);
});

// Product images are small data URLs (resized by the client) stored inside the product record.
const cleanImage = v => {
  const s = String(v || "");
  if (!s) return "";
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(s) || s.length > 700000) throw new Error("Invalid or too large product image.");
  return s;
};

app.post("/api/products/:id/image", (req, res) => {
  try {
    const image = cleanImage(req.body.image);
    const result = mutate(db => {
      const p = db.products.find(x => x.id === req.params.id);
      if (!p) throw new Error("Product not found.");
      p.image = image;
      return p;
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/products", (req, res) => {
  const sku = String(req.body.sku || "").trim();
  const name = String(req.body.name || "").trim();
  const stock = num(req.body.stock);
  const costPrice = num(req.body.costPrice);
  if (!sku || !name) return res.status(400).json({ error: "Warehouse Product Code and product name are required." });
  if (costPrice < 0 || stock < 0) return res.status(400).json({ error: "Cost price and opening stock cannot be negative." });

  try {
    const result = mutate(db => {
      const same = db.products.find(p => p.sku.toLowerCase() === sku.toLowerCase());
      if (same) throw new Error(isActive(same) ? "Warehouse Product Code already exists." : "Warehouse Product Code already exists on a removed (archived) product. Codes are permanent and cannot be reused.");
      const p = {
        id: uid("prod"),
        sku, name, costPrice, stock,
        image: cleanImage(req.body.image),
        lowStockLevel: num(req.body.lowStockLevel || 5),
        createdAt: new Date().toISOString()
      };
      db.products.push(p);
      if (stock) db.stockMovements.push({
        id: uid("mov"), date: today(), productId: p.id, type: "OPENING", qty: stock, note: "Opening stock"
      });
      return p;
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Edit one existing warehouse product. The Warehouse Product Code (and id) never change, so this can only update, never duplicate.
// Changing Current Stock records a stock movement for the difference, so stock history still adds up. Past sales keep their own snapshots.
app.put("/api/products/:id", (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name ?? "").trim();
    const costPrice = Number(body.costPrice);
    const stock = Number(body.stock);
    if (!name) throw new Error("Product name is required.");
    if (String(body.costPrice ?? "").trim() === "" || !Number.isFinite(costPrice) || costPrice < 0) throw new Error("Cost price must be a number, 0 or more.");
    if (String(body.stock ?? "").trim() === "" || !Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) throw new Error("Current stock must be a whole number, 0 or more.");
    const image = "image" in body ? cleanImage(body.image) : undefined; // omitted = keep the current image, "" = remove it
    const result = mutate(db => {
      const p = db.products.find(x => x.id === req.params.id);
      if (!p) throw new Error("Product not found.");
      if (!isActive(p)) throw new Error("This product has been removed and can no longer be edited.");
      p.name = name;
      p.costPrice = costPrice;
      if (image !== undefined) p.image = image;
      const diff = stock - num(p.stock);
      if (diff) {
        p.stock = stock;
        db.stockMovements.push({
          id: uid("mov"), date: today(), productId: p.id, type: diff > 0 ? "IN" : "ADJUSTMENT",
          qty: diff, note: "Edited in Warehouse", createdAt: new Date().toISOString()
        });
      }
      p.updatedAt = new Date().toISOString();
      return p;
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Remove a warehouse product. A product that nothing refers to (no Product Master mapping, sale, refund, undo record, or stock movement
// other than its own opening stock) is deleted for good. Anything else is only archived (active: false): the record, its code and all
// history stay, but it disappears from the Warehouse list and from every selector used for new work. Same rule as agents.
app.delete("/api/products/:id", (req, res) => {
  try {
    const result = mutate(db => {
      const p = db.products.find(x => x.id === req.params.id);
      if (!p) throw new Error("Product not found.");
      if (!isActive(p)) return { deleted: false, archived: true, alreadyRemoved: true };
      const used = [
        db.productMaster.some(m => m.productId === p.id),
        db.todaySales.some(s => s.productId === p.id),
        db.salesHistory.some(s => s.productId === p.id),
        db.refunds.some(r => r.productId === p.id),
        (db.undoLog || []).some(u => (u.sales || []).some(s => s.productId === p.id)),
        db.stockMovements.some(m => m.productId === p.id && m.type !== "OPENING")
      ].some(Boolean);
      if (used) {
        p.active = false;
        p.removedAt = new Date().toISOString();
        return { deleted: false, archived: true };
      }
      db.products = db.products.filter(x => x.id !== p.id);
      db.stockMovements = db.stockMovements.filter(m => m.productId !== p.id); // only its own opening-stock line
      return { deleted: true, archived: false };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const isNumeric = v => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

function parseWarehouseSheet(fileBase64, products) {
  const buf = Buffer.from(String(fileBase64 || "").replace(/^data:[^,]*;base64,/, ""), "base64");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets["WAREHOUSE"];
  if (!sheet) throw new Error('Sheet named "WAREHOUSE" was not found in the Excel file.');

  const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", blankrows: true });
  const headers = ["warehouse_product_code", "product_name", "COST PRICE", "OPENING STOCK"];
  const found = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || []).map(h => String(h).trim());
  const missing = headers.filter(h => !found.includes(h));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}`);

  const existing = new Set(products.map(p => p.sku.toLowerCase()));
  const archived = new Set(products.filter(p => !isActive(p)).map(p => p.sku.toLowerCase()));
  const seen = new Set();
  const rows = [];
  raw.forEach((r, i) => {
    if (headers.every(h => String(r[h] ?? "").trim() === "")) return;
    const code = String(r.warehouse_product_code ?? "").trim();
    const name = String(r.product_name ?? "").trim();
    const errors = [];
    if (code && archived.has(code.toLowerCase())) errors.push("this code belongs to a removed (archived) product");
    if (!code) errors.push("warehouse_product_code required");
    if (!name) errors.push("product_name required");
    if (!isNumeric(r["COST PRICE"]) || Number(r["COST PRICE"]) < 0) errors.push("COST PRICE must be a number >= 0");
    if (!isNumeric(r["OPENING STOCK"]) || Number(r["OPENING STOCK"]) < 0) errors.push("OPENING STOCK must be a number >= 0");
    if (code && seen.has(code.toLowerCase())) errors.push("duplicate code in file");
    if (code) seen.add(code.toLowerCase());
    rows.push({
      row: i + 2, code, name,
      costPrice: isNumeric(r["COST PRICE"]) ? Number(r["COST PRICE"]) : r["COST PRICE"],
      openingStock: isNumeric(r["OPENING STOCK"]) ? Number(r["OPENING STOCK"]) : r["OPENING STOCK"],
      status: errors.length ? "Error" : existing.has(code.toLowerCase()) ? "Existing" : "New",
      error: errors.join("; ")
    });
  });
  return rows;
}

app.get("/api/products/import-template", (_req, res) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["warehouse_product_code", "product_name", "COST PRICE", "OPENING STOCK"]]), "WAREHOUSE");
  res.setHeader("Content-Disposition", 'attachment; filename="StockPilot_Warehouse_Import_Template.xlsx"');
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
});

app.post("/api/products/import-preview", (req, res) => {
  try {
    res.json({ rows: parseWarehouseSheet(req.body.fileBase64, readDb().products) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/products/import", (req, res) => {
  try {
    const result = mutate(db => {
      const rows = parseWarehouseSheet(req.body.fileBase64, db.products);
      let added = 0, updated = 0;
      for (const r of rows) {
        if (r.status === "Error") continue;
        const p = db.products.find(x => x.sku.toLowerCase() === r.code.toLowerCase());
        if (p) {
          p.name = r.name;
          p.costPrice = r.costPrice;
          updated++;
        } else {
          const np = {
            id: uid("prod"), sku: r.code, name: r.name, costPrice: r.costPrice, stock: r.openingStock,
            lowStockLevel: 5, createdAt: new Date().toISOString()
          };
          db.products.push(np);
          if (np.stock) db.stockMovements.push({
            id: uid("mov"), date: today(), productId: np.id, type: "OPENING", qty: np.stock, note: "Opening stock"
          });
          added++;
        }
      }
      return { added, updated, errors: rows.filter(r => r.status === "Error") };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Product Master: Company + Marketplace SKU -> Warehouse product ----
const MARKETPLACES = ["Amazon", "Flipkart", "Meesho"];
const MASTER_COLUMNS = ["warehouse_product_code", "marketplace_sku", "product_name"];

function masterScope(db, companyId, marketplace) {
  const company = requireActiveCompany(db, companyId);
  if (!MARKETPLACES.includes(marketplace)) throw new Error("Select a Marketplace.");
  return company;
}

function parseProductMasterSheet(db, companyId, marketplace, fileBase64) {
  masterScope(db, companyId, marketplace);
  const buf = Buffer.from(String(fileBase64 || "").replace(/^data:[^,]*;base64,/, ""), "base64");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets["PRODUCT_MASTER"];
  if (!sheet) throw new Error('Sheet named "PRODUCT_MASTER" was not found in the Excel file.');

  const found = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || []).map(h => String(h).trim());
  const missing = MASTER_COLUMNS.filter(h => !found.includes(h));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}`);

  const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", blankrows: true });
  const byCode = new Map(db.products.map(p => [p.sku.toLowerCase(), p]));
  const existing = new Set(db.productMaster
    .filter(m => m.companyId === companyId && String(m.marketplace).toLowerCase() === marketplace.toLowerCase())
    .map(m => m.marketplaceSku.toLowerCase()));
  const seen = new Set();
  const rows = [];
  raw.forEach((r, i) => {
    if (MASTER_COLUMNS.every(h => String(r[h] ?? "").trim() === "")) return;
    const code = String(r.warehouse_product_code ?? "").trim();
    const sku = String(r.marketplace_sku ?? "").trim();
    const name = String(r.product_name ?? "").trim();
    const errors = [];
    if (!code) errors.push("warehouse_product_code required");
    if (!sku) errors.push("marketplace_sku required");
    if (!name) errors.push("product_name required");
    if (code && !byCode.has(code.toLowerCase())) errors.push("warehouse product code not found in Warehouse");
    else if (code && !isActive(byCode.get(code.toLowerCase()))) errors.push("warehouse product was removed (archived)");
    if (sku && seen.has(sku.toLowerCase())) errors.push("duplicate marketplace_sku in file");
    if (sku) seen.add(sku.toLowerCase());
    rows.push({
      row: i + 2, code, sku, name,
      productId: byCode.get(code.toLowerCase())?.id || "",
      status: errors.length ? "Error" : existing.has(sku.toLowerCase()) ? "Existing" : "New",
      error: errors.join("; ")
    });
  });
  return rows;
}

app.get("/api/product-master/template", (req, res) => {
  try {
    const company = masterScope(readDb(), String(req.query.companyId || ""), String(req.query.marketplace || ""));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([MASTER_COLUMNS]), "PRODUCT_MASTER");
    const fileName = `${company.name}_${req.query.marketplace}_Product_Master.xlsx`.replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/product-master/import-preview", (req, res) => {
  try {
    const { companyId, marketplace, fileBase64 } = req.body;
    res.json({ rows: parseProductMasterSheet(readDb(), companyId, marketplace, fileBase64) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Correct one existing mapping: point it at a different warehouse product. Company, marketplace and marketplace SKU never change,
// nothing is created, and warehouse stock / cost price are not touched. The mapping's product name is only updated on request.
app.post("/api/product-master/:id/product", (req, res) => {
  try {
    const result = mutate(db => {
      const m = db.productMaster.find(x => x.id === req.params.id);
      if (!m) throw new Error("Product Master row not found.");
      requireActiveCompany(db, m.companyId);
      const p = db.products.find(x => x.id === String(req.body?.productId || ""));
      if (!p || !isActive(p)) throw new Error("Select an existing warehouse product.");
      m.productId = p.id;
      if (req.body?.updateName) m.productName = p.name;
      return m;
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Manually add ONE Product Master mapping (the "+ Add Product" form). Uses the exact same rules as the Excel importer
// above (warehouse_product_code must be an existing, active Warehouse product; all 3 fields required) but, unlike the
// importer, an already-mapped Marketplace SKU is a hard error here rather than an update - this route only ever
// creates a new row; edit an existing one with /api/product-master/:id/product instead. Never creates or changes a
// Warehouse product.
app.post("/api/product-master", (req, res) => {
  try {
    const companyId = String(req.body?.companyId || "");
    const marketplace = String(req.body?.marketplace || "");
    const code = String(req.body?.code || "").trim();
    const sku = String(req.body?.sku || "").trim();
    const name = String(req.body?.name || "").trim();
    const result = mutate(db => {
      masterScope(db, companyId, marketplace); // same "select a Company / Marketplace" check as the rest of Product Master
      const errors = [];
      if (!code) errors.push("Warehouse Product Code is required.");
      if (!sku) errors.push("Marketplace SKU is required.");
      if (!name) errors.push("Product Name is required.");
      const product = code ? db.products.find(p => p.sku.toLowerCase() === code.toLowerCase()) : undefined;
      if (code && !product) errors.push("Warehouse Product Code not found in Warehouse.");
      else if (code && !isActive(product)) errors.push("That warehouse product was removed (archived).");
      const duplicate = sku && db.productMaster.some(m => m.companyId === companyId
        && String(m.marketplace).toLowerCase() === marketplace.toLowerCase() && m.marketplaceSku.toLowerCase() === sku.toLowerCase());
      if (duplicate) errors.push("This Marketplace SKU is already mapped for this Company and Marketplace.");
      if (errors.length) throw new Error(errors.join(" "));

      const m = { id: uid("pm"), companyId, marketplace, marketplaceSku: sku, productId: product.id, productName: name, createdAt: new Date().toISOString() };
      db.productMaster.push(m);
      return m;
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Remove ONE Product Master mapping (Company + Marketplace + Marketplace SKU). This never touches the Warehouse
// product, its stock or cost, and never touches a sale, refund or ledger entry - those already keep their own
// snapshot (warehouseProductCode, productName, marketplaceSku) taken at the time of sale, not a live link to this
// row, so removing a mapping cannot change any historical record. Only this exact row disappears; the same
// Warehouse product's OTHER Company/Marketplace mappings are untouched.
app.delete("/api/product-master/:id", (req, res) => {
  try {
    const result = mutate(db => {
      const m = db.productMaster.find(x => x.id === req.params.id);
      if (!m) throw new Error("Product Master row not found.");
      db.productMaster = db.productMaster.filter(x => x.id !== m.id);
      return { deleted: true };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/product-master/import", (req, res) => {
  try {
    const { companyId, marketplace, fileBase64 } = req.body;
    const result = mutate(db => {
      const rows = parseProductMasterSheet(db, companyId, marketplace, fileBase64);
      let added = 0, updated = 0;
      for (const r of rows) {
        if (r.status === "Error") continue;
        const m = db.productMaster.find(x => x.companyId === companyId && String(x.marketplace).toLowerCase() === marketplace.toLowerCase() && x.marketplaceSku.toLowerCase() === r.sku.toLowerCase());
        if (m) {
          m.productId = r.productId;
          m.productName = r.name;
          updated++;
        } else {
          db.productMaster.push({
            id: uid("pm"), companyId, marketplace, marketplaceSku: r.sku, productId: r.productId,
            productName: r.name, createdAt: new Date().toISOString()
          });
          added++;
        }
      }
      return { added, updated, errors: rows.filter(r => r.status === "Error") };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/stock-adjust", (req, res) => {
  const productId = req.body.productId;
  const qtyGiven = req.body.qty !== undefined && req.body.qty !== null && String(req.body.qty).trim() !== "";
  const costGiven = req.body.costPrice !== undefined && req.body.costPrice !== null && String(req.body.costPrice).trim() !== "";
  const qty = qtyGiven ? Number(req.body.qty) : 0;
  const costPrice = costGiven ? Number(req.body.costPrice) : undefined;
  const note = String(req.body.note || "Stock adjustment");
  if (!productId) return res.status(400).json({ error: "Product is required." });
  if (!Number.isFinite(qty)) return res.status(400).json({ error: "Quantity change must be a number." });
  if (costGiven && (!Number.isFinite(costPrice) || costPrice < 0)) return res.status(400).json({ error: "Cost price must be a number, 0 or more." });

  try {
    const result = mutate(db => {
      const p = db.products.find(x => x.id === productId);
      if (!p || !isActive(p)) throw new Error("Product not found.");
      if (!qty && (costPrice === undefined || costPrice === num(p.costPrice))) throw new Error("Nothing to update. Change the cost price or enter a quantity.");
      if (p.stock + qty < 0) throw new Error("Stock cannot go below zero.");
      if (costPrice !== undefined) p.costPrice = costPrice;
      if (qty) {
        p.stock += qty;
        db.stockMovements.push({
          id: uid("mov"), date: today(), productId, type: qty > 0 ? "IN" : "ADJUSTMENT",
          qty, note, createdAt: new Date().toISOString()
        });
      }
      return p;
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/sales", (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const created = mutate(db => {
      const out = [];
      const batchId = uid(`batch_${today().replaceAll("-", "")}`); // every sale saved in this click shares one batch
      // Scanned labels must never add the same Order ID twice (checks today's sales, history and this batch).
      const seenOrders = new Set([...db.todaySales, ...db.salesHistory].map(x => String(x.orderId || "").trim().toLowerCase()).filter(Boolean));
      for (const row of rows) {
        const oid = String(row.orderId || "").trim().toLowerCase();
        if (row.source === "ollama-label" && oid) {
          if (seenOrders.has(oid)) throw new Error(`Order ID ${row.orderId} has already been saved.`);
          seenOrders.add(oid);
        }
        const qty = Math.max(1, num(row.qty || 1));
        const p = db.products.find(x => x.id === row.productId);
        const account = db.accounts.find(x => x.id === row.accountId);
        if (!p || !isActive(p)) throw new Error(`Product not found for ${row.orderId || "sale"}.`);
        if (!account) throw new Error("Account not found.");
        if (account.agentId !== row.agentId) throw new Error("Selected account does not belong to selected agent.");
        if (p.stock < qty) throw new Error(`Not enough stock for ${p.name}. Available: ${p.stock}.`);

        // Reporting snapshot: who/where/what was sold, kept with the sale so monthly reports never depend on later edits.
        const saleAgent = db.agents.find(a => a.id === row.agentId);
        const saleCompany = db.companies.find(c => c.id === saleAgent?.companyId);
        if (saleCompany?.active === false) throw new Error("Company is archived. Select an active company.");
        const mapped = db.productMaster.filter(m => m.companyId === saleAgent?.companyId && m.productId === p.id
          && String(m.marketplace).toLowerCase() === String(account.marketplace).toLowerCase());

        const sale = {
          id: uid("sale"),
          batchId,
          date: row.date || today(),
          agentId: row.agentId,
          agentName: saleAgent?.name || "",
          companyId: saleAgent?.companyId || "",
          companyName: saleCompany?.name || "",
          accountId: row.accountId,
          marketplace: account.marketplace,
          marketplaceSku: String(row.marketplaceSku || (mapped.length === 1 ? mapped[0].marketplaceSku : "")).trim(),
          productId: p.id,
          sku: p.sku,
          warehouseProductCode: p.sku,
          productName: p.name,
          qty,
          saleAmount: num(row.saleAmount),
          profit: null, // true profit needs marketplace fees/tax, which StockPilot does not hold; costTotal below is the stock cost
          // Cost snapshot: the warehouse cost price at the moment of sale. Later cost-price edits never change it.
          unitCost: num(p.costPrice),
          costTotal: num(p.costPrice) * qty,
          orderId: String(row.orderId || ""),
          trackingId: String(row.trackingId || ""),
          source: row.source || "manual",
          createdAt: new Date().toISOString()
        };

        p.stock -= qty;
        db.todaySales.push(sale);
        db.stockMovements.push({
          id: uid("mov"), date: sale.date, productId: p.id, type: "SALE",
          qty: -qty, agentId: row.agentId, saleId: sale.id, note: `${account.marketplace} ${sale.orderId || ""}`.trim()
        });
        db.ledger.push({
          id: uid("led"), date: sale.date, agentId: row.agentId, type: "SALE",
          amount: sale.costTotal, costBasis: true, referenceId: sale.id, // agent owes warehouse cost x qty, not the selling amount
          note: `${account.marketplace} sale ${sale.orderId || ""}`.trim(),
          createdAt: new Date().toISOString()
        });
        out.push(sale);
      }
      return out;
    });
    res.json(created);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Undo the most recently saved sales batch: sales, warehouse stock, stock movements and the agent SALE cost entries.
// Payments and unrelated sales are never touched. A batch already archived by Close Day cannot be undone here.
app.post("/api/sales/undo-last-batch", (_req, res) => {
  try {
    const result = mutate(db => {
      const withBatch = [...db.salesHistory, ...db.todaySales].filter(s => s.batchId);
      if (!withBatch.length) throw new Error(db.salesHistory.length ? "This batch is already archived." : "No saved sales batch to undo.");
      const last = withBatch.reduce((a, b) => String(b.createdAt || "") >= String(a.createdAt || "") ? b : a);
      const batch = db.todaySales.filter(s => s.batchId === last.batchId);
      if (!batch.length || db.salesHistory.some(s => s.batchId === last.batchId)) throw new Error("This batch is already archived.");

      if (batch.some(sale => db.refunds.some(r => r.saleId === sale.id))) throw new Error("A sale in this batch has been refunded, so the batch cannot be undone.");
      for (const sale of batch) {
        if (!db.products.some(p => p.id === sale.productId)) throw new Error(`Cannot undo: warehouse product for order ${sale.orderId || sale.id} no longer exists.`);
      }
      const ids = new Set(batch.map(s => s.id));
      const removedLedger = db.ledger.filter(l => l.type === "SALE" && ids.has(l.referenceId));
      const removedMovements = db.stockMovements.filter(m => m.type === "SALE" && ids.has(m.saleId));
      for (const sale of batch) db.products.find(p => p.id === sale.productId).stock += Number(sale.qty || 0);

      db.todaySales = db.todaySales.filter(s => !ids.has(s.id));
      db.ledger = db.ledger.filter(l => !removedLedger.includes(l));
      db.stockMovements = db.stockMovements.filter(m => !removedMovements.includes(m));
      (db.undoLog ||= []).push({ id: uid("undo"), batchId: last.batchId, undoneAt: new Date().toISOString(), sales: batch, ledger: removedLedger, stockMovements: removedMovements });
      return { batchId: last.batchId, undone: batch.length, orderIds: batch.map(s => s.orderId).filter(Boolean) };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Refunds -------------------------------------------------------------------------------------------------------
// A sale can be refunded once, within 10 days of its sale date (local time). The original sale is never deleted. One atomic step:
//   * a permanent record in db.refunds (the authority for "already refunded", so refresh / restart / Close Day cannot allow a 2nd refund)
//   * the refunded qty goes back to the SAME warehouse product (stock movement type REFUND)
//   * a negative SALE ledger entry reduces the agent's Sales Due by the FULL original sale amount (not the product cost; not a payment)
const REFUND_DAYS = 10;
const pad2 = n => String(n).padStart(2, "0");
const localDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function saleLocalDate(sale) {
  const t = Date.parse(sale.createdAt || "");
  return Number.isFinite(t) ? new Date(t) : new Date(`${String(sale.date || "").slice(0, 10)}T12:00:00`);
}
// Last local calendar day on which the sale can still be refunded: sale day + 10 days (Sep 10 -> Sep 20).
function refundDeadlineDay(sale) {
  const d = saleLocalDate(sale);
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + REFUND_DAYS));
}

app.post("/api/refunds", (req, res) => {
  try {
    const saleId = String(req.body?.saleId || "");
    if (!saleId) throw new Error("Select a sale to refund.");
    const result = mutate(db => {
      const sale = [...db.todaySales, ...db.salesHistory].find(s => s.id === saleId);
      if (!sale) throw new Error("Sale not found.");
      if (db.refunds.some(r => r.saleId === sale.id)) throw new Error("This sale has already been refunded.");
      if (localDay(new Date()) > refundDeadlineDay(sale)) throw new Error(`The ${REFUND_DAYS}-day refund window for this sale ended on ${refundDeadlineDay(sale)}.`);
      const product = db.products.find(p => p.id === sale.productId);
      if (!product) throw new Error("The warehouse product for this sale no longer exists.");

      const qty = Number(sale.qty || 0);
      const now = new Date();
      const saleAgent = db.agents.find(a => a.id === sale.agentId);
      const saleCompanyId = sale.companyId || saleAgent?.companyId || "";
      const original = db.ledger.find(l => l.type === "SALE" && l.referenceId === sale.id);
      const costAmount = original ? Number(original.amount || 0) : (typeof sale.costTotal === "number" ? sale.costTotal : 0);
      const dueReversalAmount = Number(sale.saleAmount || 0);   // what comes off the agent's Sales Due

      const refund = {
        id: uid("refund"),
        refundedAt: now.toISOString(),
        refundDate: localDay(now),
        saleId: sale.id,
        saleDate: localDay(saleLocalDate(sale)),
        saleAt: sale.createdAt || "",
        orderId: sale.orderId || "",
        companyId: saleCompanyId,
        companyName: sale.companyName || db.companies.find(c => c.id === saleCompanyId)?.name || "",
        agentId: sale.agentId,
        agentName: sale.agentName || saleAgent?.name || "",
        accountId: sale.accountId,
        marketplace: sale.marketplace,
        marketplaceSku: sale.marketplaceSku || "",
        productId: product.id,
        warehouseProductCode: sale.warehouseProductCode || product.sku,
        productName: sale.productName || product.name,
        qty,
        refundAmount: Number(sale.saleAmount || 0),
        costAmount,          // stock cost of the sale (information only, used for the profit line)
        dueReversalAmount    // full sale amount taken off the agent's Sales Due
      };

      product.stock += qty;
      db.stockMovements.push({ id: uid("mov"), date: refund.refundDate, productId: product.id, type: "REFUND", qty, agentId: sale.agentId, saleId: sale.id, refundId: refund.id, note: `Refund ${sale.orderId || sale.id}` });
      if (dueReversalAmount) db.ledger.push({
        id: uid("led"), date: refund.refundDate, agentId: sale.agentId, type: "SALE", kind: "REFUND_REVERSAL",
        amount: -dueReversalAmount, costBasis: true, referenceId: refund.id, refundId: refund.id,
        note: `Refund reversal ${sale.orderId || sale.id}`, createdAt: refund.refundedAt
      });
      db.refunds.push(refund);
      return refund;
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Agents may only pay against an existing unpaid balance: payment <= walletTotals().pendingCents. No advance credit.
app.post("/api/payments", (req, res) => {
  const { agentId } = req.body;
  const amount = num(req.body.amount);
  if (!agentId || !(amount > 0)) return res.status(400).json({ error: "Agent and positive payment amount are required." });

  try {
    const entry = mutate(db => {
      if (!db.agents.some(a => a.id === agentId)) throw new Error("Agent not found.");
      const companyId = db.agents.find(a => a.id === agentId)?.companyId;
      if (db.companies.some(c => c.id === companyId && c.active === false)) throw new Error("Company is archived. Select an active company.");
      const { pendingCents: dueCents } = walletTotals(db, agentId);
      if (dueCents === 0) throw new Error("No payment due.");
      if (Math.round(amount * 100) > dueCents) throw new Error(`Payment cannot exceed pending due of ₹${(dueCents / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}.`);
      const l = {
        id: uid("led"), date: req.body.date || localDay(new Date()), agentId, type: "PAYMENT",
        amount, note: String(req.body.note || "Agent payment"),
        createdAt: new Date().toISOString()
      };
      db.ledger.push(l);
      return l;
    });
    res.json(entry);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/label-scan", async (req, res) => {
  try {
    const imageBase64 = String(req.body.imageBase64 || "").replace(/^data:image\/\w+;base64,/, "");
    if (!imageBase64) return res.status(400).json({ error: "Label image is required." });
    const started = Date.now();
    const rows = await scanLabel(imageBase64, req.body.marketplace);
    res.json({ rows, model: OLLAMA_SETTINGS.model, ms: Date.now() - started });
  } catch (e) {
    console.warn(`Label scan (Ollama ${OLLAMA_SETTINGS.model}) failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Scan diagnostics (developer log): one JSON line per scanned row in <data folder>/logs/scan-diagnostics.jsonl.
// Holds extracted fields and decisions only - never the raw label text. Kept small (rotated at 2 MB).
app.post("/api/scan-diagnostics", (req, res) => {
  try {
    const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 500) : [];
    const errors = Array.isArray(req.body?.errors) ? req.body.errors.slice(0, 100).map(String) : [];
    const dir = path.join(paths.root, "logs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "scan-diagnostics.jsonl");
    try { if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, path.join(dir, "scan-diagnostics.previous.jsonl")); } catch {}
    const lines = [...records.map(r => JSON.stringify(r)), ...errors.map(e => JSON.stringify({ at: new Date().toISOString(), fileError: e }))];
    if (lines.length) fs.appendFileSync(file, lines.join("\n") + "\n");
    res.json({ ok: true, written: lines.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/ollama-info", async (_req, res) => {
  res.json({ ...OLLAMA_SETTINGS, status: await ensureOllama() });
});

app.post("/api/close-day", (_req, res) => {
  try {
    const db = readDb();
    const sales = [...db.todaySales];
    if (!sales.length) return res.status(400).json({ error: "No daily sales to export." });

    const wb = buildDayWorkbook(db, sales);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `StockPilot-Daily-${stamp}.xlsx`;
    const diskPath = path.join(paths.exportDir, fileName);
    XLSX.writeFile(wb, diskPath);

    mutate(live => {
      // Move today's sales into the permanent Sales History. A sale already in history is never added twice, and stock is not touched.
      const archived = new Set(live.salesHistory.map(s => s.id));
      live.salesHistory.push(...live.todaySales.filter(s => !archived.has(s.id)).map(s => ({ ...s, archivedAt: new Date().toISOString() })));
      live.todaySales = [];
    });

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    fs.createReadStream(diskPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Month Close -----------------------------------------------------------------------------------------------
// Archives the ENTIRE currently active Sales + Wallet period - every sale in todaySales and salesHistory, and every
// SALE/PAYMENT ledger entry - into one permanent, read-only snapshot, then empties todaySales, salesHistory and
// those ledger entries so the next month starts fresh. Releasing old Order IDs is a direct side effect of that: the
// duplicate check in POST /api/sales above only ever looks at todaySales + salesHistory, so once a sale is archived
// out of both, its Order ID is no longer "already saved" and a label with that same Order ID can be scanned again.
//
// Left completely untouched: Product Master, warehouse products/stock, stock movements, refunds (their own
// collection and their own 10-day logic), companies, agents, accounts, and any SETTLEMENT (Reset Wallet) ledger
// entries - none of those are SALE or PAYMENT type, so the filter below never touches them.
//
// Safety ("archive first, verify, only then reset, or reset nothing"): the snapshot is written to its own file on
// disk and read back to confirm it matches, BEFORE any active record is touched - all inside the mutate() callback
// below. mutate() only calls saveDb() if that callback returns normally; if the disk write/verify (or anything else
// in here) throws, saveDb() never runs, so stockpilot.json is not written at all and every active record is exactly
// as it was. The on-disk file is a redundant safety copy only - the app reads the archive from monthCloseArchive.
function writeMonthCloseSnapshotFile(archive) {
  const dir = path.join(paths.backupDir, "month-close");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${archive.id}.json`);
  const text = JSON.stringify(archive, null, 2);
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, text, "utf8");
    if (fs.readFileSync(temp, "utf8") !== text) throw new Error("snapshot copy did not verify");
    fs.renameSync(temp, file);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch {}
    throw new Error(`Month Close snapshot could not be written safely (${e.message}). Nothing was reset.`);
  }
  // Independent re-read, the actual verification step, from the final renamed file.
  const verify = JSON.parse(fs.readFileSync(file, "utf8"));
  if (verify.sales.length !== archive.sales.length || verify.ledger.length !== archive.ledger.length) {
    throw new Error("Month Close snapshot failed verification after writing. Nothing was reset.");
  }
  return path.relative(paths.root, file).replace(/\\/g, "/");
}

app.get("/api/month-close", (_req, res) => {
  const db = readDb();
  res.json({
    archives: (db.monthCloseArchive || []).map(a => ({
      id: a.id, closedAt: a.closedAt, label: a.label || "",
      salesCount: a.sales.length, ledgerCount: a.ledger.length, agentSummary: a.agentSummary, file: a.file
    })).reverse() // newest first
  });
});

app.post("/api/month-close", (req, res) => {
  try {
    const result = mutate(db => {
      const sales = [...db.todaySales, ...db.salesHistory];
      if (!sales.length) throw new Error("Nothing to close: there are no active sales.");
      const ledgerToArchive = db.ledger.filter(l => l.type === "SALE" || l.type === "PAYMENT");
      const archivedLedgerIds = new Set(ledgerToArchive.map(l => l.id));

      // Per-agent Sales Due / Paid / Balance for this closed period only, computed the SAME way the live wallet
      // does (SUM of SALE ledger amounts minus SUM of PAYMENT ledger amounts) - so it reconciles with what the
      // Agent Wallet Details panel showed for these exact entries right before the close. Left unclamped (unlike
      // the live "never negative" balance) since this is a historical record, not something anyone still owes.
      const byAgent = new Map();
      for (const l of ledgerToArchive) {
        const row = byAgent.get(l.agentId) || { due: 0, paid: 0 };
        if (l.type === "SALE") row.due += num(l.amount);
        if (l.type === "PAYMENT") row.paid += num(l.amount);
        byAgent.set(l.agentId, row);
      }
      const agentSummary = [...byAgent.entries()].map(([agentId, v]) => {
        const agent = db.agents.find(a => a.id === agentId);
        const company = db.companies.find(c => c.id === agent?.companyId);
        const due = Math.round(v.due * 100) / 100, paid = Math.round(v.paid * 100) / 100;
        return { agentId, agentName: agent?.name || "(removed agent)", companyId: agent?.companyId || "", companyName: company?.name || "", due, paid, balance: Math.round((due - paid) * 100) / 100 };
      }).sort((a, b) => a.agentName.localeCompare(b.agentName));

      const archive = {
        id: uid("close"),
        closedAt: new Date().toISOString(),
        label: String(req.body?.label || "").trim(),
        sales: sales.map(s => ({ ...s })),
        ledger: ledgerToArchive.map(l => ({ ...l })),
        agentSummary
      };
      archive.file = writeMonthCloseSnapshotFile(archive); // throws (aborting this whole mutate) if it can't be verified on disk

      (db.monthCloseArchive ||= []).push(archive);
      db.todaySales = [];
      db.salesHistory = [];
      db.ledger = db.ledger.filter(l => !archivedLedgerIds.has(l.id));

      return { id: archive.id, closedAt: archive.closedAt, salesArchived: archive.sales.length, ledgerArchived: archive.ledger.length, agentSummary, file: archive.file };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// SellQuanta desktop app: serve the built screen (client/dist, made by "npm --prefix client run build") from this same local address,
// so the desktop window needs no Vite dev server. Only files that exist are served; every /api route above is unchanged.
const clientDist = process.env.SELLQUANTA_CLIENT_DIST || path.join(import.meta.dirname, "..", "client", "dist");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist, { index: "index.html", setHeaders: (res, file) => { if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } }));
}

// Any unexpected error (for example an unreadable data file) is returned as JSON so the app can show the real message.
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || "Unexpected error." }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`StockPilot API running: http://127.0.0.1:${PORT}`);
  ensureOllama().then(s => console.log(`Ollama: ${s.ok ? "ready" : "not reachable yet"}`));
  autoBackupOncePerDay(); // one backup per local day, taken before anything else touches the data file
  // Start-up housekeeping (idempotent): fills missing accounts / reporting fields. If the data file is unreadable this is skipped
  // and nothing is written, so the app can still tell you what is wrong instead of crashing.
  let report;
  try {
    report = mutate(db => {
      const r = dedupeAgents(db);
      db.agents.filter(a => a.active !== false).forEach(a => ensureAccounts(db, a));
      r.costs = migrateSaleCosts(db);
      r.batches = assignLegacyBatches(db);
      r.history = backfillSaleHistory(db);
      return r;
    });
  } catch (e) {
    console.error(`Start-up check skipped, no data was changed: ${e.message}`);
    return;
  }
  if (report.batches) console.log(`Sales batches: ${report.batches} earlier sale(s) grouped into batches so they can be undone.`);
  if (report.history) console.log(`Sales history: ${report.history} sale(s) got reporting fields (company, agent name, marketplace SKU, product code).`);
  const c = report.costs;
  if (c.backfilled || c.ledgerConverted || c.skipped) console.log(`Sale cost snapshots: ${c.backfilled} sale(s) backfilled, ${c.ledgerConverted} ledger entr${c.ledgerConverted === 1 ? "y" : "ies"} converted to cost, ${c.skipped} sale(s) left as-is (no clear product cost).`);
  for (const r of report.removed) console.log(`Removed unused duplicate agent "${r.name}" (${r.id}); kept ${r.keptId}.`);
  for (const c of report.conflicts) console.warn(`Duplicate agent "${c.name}" has history on several records (${c.ids.join(", ")}); nothing was deleted.`);
});
