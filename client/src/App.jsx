import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { fileToImageDataUrls, fileToPdfPages } from "./pdf";
import { scanPdfPage } from "./fastPdfParser";
import { createScanPerf, newScanRunId, scanRowPerf } from "./scanPerf";
import { resolveScanRow, scanDiagnostic } from "./autoDetect";
import { verifyAiRows } from "./labelScan";
import { dashboardStats, monthOptions, monthLabel, saleDay, agentWalletBreakdown } from "./dashboardStats";
import { warehouseSummary } from "./warehouseSummary";
import { refundableSales, saleLocalDay, REFUND_DAYS } from "./refunds";
import { agentWalletTotals, ledgerTypeLabel, latestWalletReset, paymentHistory, localDateTime } from "./wallet";
import LabelSegregator from "./LabelSegregator";
import CompleteReset from "./CompleteReset";
import { Icon } from "./icons";

const money = n => { const v = Number(n || 0); return `${v < 0 ? "-" : ""}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`; };

// ---- Presentation-only helpers (no data, no calculations: they only change how existing values look) ----
// Renders the exact string money() returns, with the ₹ sign wrapped so it can be shown in a quieter grey.
function Money({ n, className = "" }) {
  const s = money(n);
  const i = s.indexOf("₹");
  return <span className={`money ${Number(n || 0) < 0 ? "neg" : ""} ${className}`.trim()}>{s.slice(0, i)}<span className="cur">₹</span>{s.slice(i + 1)}</span>;
}
// Small coloured marker in front of a marketplace name. Text is unchanged.
function Mkt({ name }) {
  if (!name) return "—";
  return <span className={`mkt ${String(name).toLowerCase()}`}>{name}</span>;
}
// Visual style for the status strings the scanner already produces. The text shown is the original status.
const STATUS_LOOK = { "Matched":["ok","check"], "Saved":["saved","check"], "Duplicate":["dup","copy"], "Needs Review":["warn","alert"], "Not Found":["err","error"], "Error":["err","error"] };
function StatusBadge({ status }) {
  const [kind, icon] = STATUS_LOOK[status] || ["warn", "alert"];
  return <span className={`badge ${kind}`}><Icon name={icon} size={11} strokeWidth={2.4}/>{status}</span>;
}
function EmptyRow({ colSpan, children }) {
  return <tr><td colSpan={colSpan} className="muted empty-cell">{children}</td></tr>;
}
// Toast colour is picked only from the wording of the existing message text; the message itself is unchanged.
const toastKind = text => /could not|cannot|can't|not enough|must be|exceed|error|fail|rejected|invalid|not found|no payment due/i.test(text) ? "err"
  : /saved|added|updated|removed|deleted|recorded|closed|finished|restored|reset successfully|reactivated|archived|imported|undid|refund recorded/i.test(text) ? "ok" : "info";

// Download/export button with visible feedback: label -> "Downloading..." -> "✓ Downloaded" (2.5s) -> label.
// `action` performs the existing download unchanged; it returns false when nothing was started (e.g. the user
// cancelled a confirm) and throws when the download failed - the button then shows "Download failed" briefly.
function DownloadButton({ action, label, busyLabel = "Downloading…", className = "ghost", iconSize = 15, icon = "download", disabled = false }) {
  const [phase, setPhase] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = async () => {
    if (phase === "busy") return;
    clearTimeout(timer.current);
    setPhase("busy");
    let next = "done";
    try { if ((await action()) === false) next = "idle"; }
    catch { next = "failed"; }
    setPhase(next);
    if (next !== "idle") timer.current = setTimeout(() => setPhase("idle"), next === "done" ? 2500 : 3500);
  };
  const text = phase === "busy" ? busyLabel : phase === "done" ? "Downloaded" : phase === "failed" ? "Download failed" : label;
  const ic = phase === "done" ? "check" : phase === "failed" ? "error" : icon;
  return <button className={`${className} dl-btn ${phase === "idle" ? "" : `dl-${phase}`}`} disabled={disabled || phase === "busy"} onClick={run} aria-live="polite" data-label={label}>
    <Icon name={ic} size={iconSize}/>{text}</button>;
}

function Card({ children, className = "" }) {
  return <div className={`card ${className}`}>{children}</div>;
}

function Stat({ label, value, sub, className = "" }) {
  return <Card className={`stat ${className}`.trim()}><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="muted">{sub}</div>}</Card>;
}

const NAV_ICON = { dashboard:"dashboard", sales:"scan", warehouse:"box", master:"link", agents:"wallet", refunds:"refund", close:"sheet" };
const PAGE_SUBTITLE = {
  dashboard: "Business performance across companies, marketplaces and inventory.",
  sales: "Scan shipping labels, resolve mappings and record today's sales.",
  warehouse: "Manage warehouse products, stock levels and cost.",
  master: "Map marketplace SKUs to warehouse products.",
  agents: "Track agent stock cost, payments and outstanding balances.",
  refunds: "Process eligible refunds and review refund history.",
  close: "Export and close the current day's sales safely."
};

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [state, setState] = useState(null);
  const [health, setHealth] = useState({ ollama: { ok: false } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const businessGeneration = useRef(0);
  const [viewGeneration, setViewGeneration] = useState(0);

  const reload = async () => {
    const generation = businessGeneration.current;
    const s = await api.state();
    if (generation === businessGeneration.current) setState(s);
  };

  const businessResetCompleted = result => {
    // Invalidate pending old-business reads and unmount every page's local state
    // (scan rows/files, selections, cached forms and history panels included).
    businessGeneration.current++;
    for (const storage of ["localStorage", "sessionStorage"]) {
      for (const key of ["sp_master_company", "sp_master_marketplace", "sp_mode"]) {
        try { window[storage].removeItem(key); } catch {}
      }
    }
    setState(result.state); setTab("agents"); setBusy(false);
    setViewGeneration(businessGeneration.current);
    setMsg(`Complete Reset successful. Full backup preserved: ${result.backup}`);
    void reload().catch(e => setMsg(`Reset succeeded; could not refresh: ${e.message}. Full backup: ${result.backup}`));
  };

  useEffect(() => {
    try { localStorage.removeItem("sp_mode"); } catch {} // leftover from the removed demo switch
    reload().catch(e => setMsg(e.message));
    api.health().then(setHealth).catch(() => {});
  }, []);

  if (!state) return <div className="loading">{msg || "Starting SellQuanta…"}</div>;

  const low = state.products.filter(p => p.active !== false && p.stock <= (p.lowStockLevel ?? 5));

  const notify = (text) => {
    setMsg(text);
    window.setTimeout(() => setMsg(""), 3000);
  };

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="logo"><img src="/logo.png" alt="" width="26" height="26" /></div>
          <div><b>SellQuanta</b><small>Local Edition</small></div>
        </div>

        <nav>
          {[
            ["dashboard","Dashboard"],
            ["sales","Daily Sales"],
            ["warehouse","Warehouse"],
            ["master","Product Master"],
            ["agents","Agents & Wallet"],
            ["refunds","Refunds"],
            ["close","Excel / Close Day"]
          ].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined}><Icon name={NAV_ICON[id]} size={16} strokeWidth={1.75}/>{label}</button>
          ))}
        </nav>

        <div className="aside-status" title={health?.ollama?.ok ? "Ollama is running" : "Ollama is not reachable"}>
          <span className={`dot ${health?.ollama?.ok ? "ok" : ""}`}></span>
          Ollama <span className="state">{health?.ollama?.ok ? "Ready" : "Not ready"}</span>
        </div>
      </aside>

      <main key={viewGeneration}>
        <header>
          <div>
            <h1>{{
              dashboard:"Dashboard",
              sales:"Daily Sales",
              warehouse:"Warehouse",
              master:"Product Master",
              agents:"Agents & Wallet",
              refunds:"Refunds",
              close:"Excel / Close Day"
            }[tab]}</h1>
            <p>{PAGE_SUBTITLE[tab]}</p>
          </div>
        </header>

        {msg && <div className={`toast ${toastKind(msg)}`} role="status"><Icon name={{ok:"check",err:"error",info:"info"}[toastKind(msg)]} size={16}/><span>{msg}</span></div>}

        {state.companies.length === 0 && tab !== "agents" && <Card>
          <h3>Add your first company</h3>
          <p className="muted">Create a company to set up agents, marketplace accounts and Product Master mappings.</p>
          <button onClick={() => setTab("agents")}>Add Company</button>
        </Card>}

        {tab === "dashboard" && <Dashboard state={state} />}
        {tab === "sales" && <Sales state={state} reload={reload} notify={notify} setHealth={setHealth} />}
        {tab === "warehouse" && <Warehouse state={state} reload={reload} notify={notify} />}
        {tab === "master" && <ProductMaster state={state} reload={reload} notify={notify} />}
        {tab === "agents" && <Agents state={state} reload={reload} notify={notify} />}
        {tab === "refunds" && <Refunds state={state} reload={reload} notify={notify} />}
        {tab === "close" && <CloseDay state={state} reload={reload} notify={notify} busy={busy} setBusy={setBusy} onBusinessReset={businessResetCompleted} />}
      </main>
    </div>
  );
}

function Dashboard({ state }) {
  const [month, setMonth] = useState(() => monthOptions(state)[0]);
  const months = monthOptions(state);
  const shown = months.includes(month) ? month : months[0];
  const d = dashboardStats(state, shown);
  const empty = <EmptyRow colSpan="6">No sales in this month.</EmptyRow>;

  return <>
    <div className="dash-top">
      <Card className="flush">
        <div className="ph"><h3>This month</h3><span className="meta">All monthly figures below are for {monthLabel(shown)}.</span>
          <div className="acts">
            <label className="check-label" htmlFor="dash-month">Month</label>
            <select id="dash-month" className="compact" value={shown} onChange={e=>setMonth(e.target.value)}>
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>
        <div className="figs">
          <div className="fig-cell"><span className="fig-l">Monthly Sales</span><span className="fig-v xl"><Money n={d.totals.sales}/></span><span className="fig-s">Net · Gross {money(d.totals.grossSales)} − Refunds {money(d.totals.refundAmount)}</span></div>
          <div className="fig-cell"><span className="fig-l">Monthly Orders</span><span className="fig-v">{d.totals.orders}</span>{d.totals.refundCount ? <span className="fig-s">{`${d.totals.refundCount} refund${d.totals.refundCount === 1 ? "" : "s"} this month`}</span> : null}</div>
          <div className="fig-cell"><span className="fig-l">Monthly Quantity</span><span className="fig-v">{d.totals.qty}</span><span className="fig-s">{`Sold ${d.totals.grossQty} − Refunded ${d.totals.refundQty}`}</span></div>
          <div className="fig-cell"><span className="fig-l">Monthly Profit</span><span className="fig-v na">Not available</span><span className="fig-s">{d.profit.salesMinusStockCost === null ? "needs marketplace fees & tax" : `Sales − stock cost ${money(d.profit.salesMinusStockCost)} (before fees & tax)`}</span></div>
        </div>
      </Card>

      <Card className="flush">
        <div className="ph"><h3>Today Summary</h3></div>
        <div className="today-rows">
          <div className="r"><span>Today Orders</span><b>{d.today.orders}</b></div>
          <div className="r"><span>Today Quantity</span><b>{d.today.qty}</b></div>
          <div className="r"><span>Today Sales</span><b><Money n={d.today.sales}/></b></div>
        </div>
      </Card>
    </div>

    <div className="dgrid">
      <Card className="flush">
        <div className="ph"><h3>Company Performance</h3><span className="meta">by marketplace · selected month</span></div>
        <div className="table-wrap"><table><thead><tr><th>Company / Marketplace</th><th className="n">Orders</th><th className="n">Qty</th><th className="n">Net Sales</th><th className="n">Refunds</th></tr></thead>
        <tbody>{d.companies.length ? d.companies.map(c => <React.Fragment key={c.id}>
          <tr className="group"><td>{c.name}</td><td className="n">{c.orders}</td><td className="n">{c.qty}</td><td className="n"><Money n={c.sales}/></td><td className="n"><Money n={c.refundAmount}/></td></tr>
          {c.marketplaces.map(m => <tr className="child" key={m.marketplace}><td><Mkt name={m.marketplace}/></td><td className="n">{m.orders}</td><td className="n">{m.qty}</td><td className="n"><Money n={m.sales}/></td><td></td></tr>)}
        </React.Fragment>) : <EmptyRow colSpan="5">No companies yet.</EmptyRow>}</tbody></table></div>
      </Card>

      <Card className="flush">
        <div className="ph"><h3>Low Stock</h3>
          <span className={`badge ${d.lowStock.length ? "warn" : ""}`} title="right now, at / below alert level">{d.lowStock.length ? <Icon name="alert" size={11} strokeWidth={2.4}/> : null}{d.lowStock.length} at / below alert level</span>
        </div>
        {d.lowStock.length ? <div className="low-list">{d.lowStock.slice(0,8).map(p => <div className="li" key={p.id}>
            <div style={{minWidth:0}}><b>{p.name}</b><small className="code">{p.sku}</small></div>
            {Number(p.stock) <= 0 ? <span className="badge err">Out</span> : <span className="badge warn">Low</span>}
            <span className={`q ${Number(p.stock) <= 0 ? "zero" : "lowq"}`}>{p.stock}</span>
          </div>)}</div>
          : <div className="empty">No low-stock products.</div>}
      </Card>
    </div>

    <div className="dgrid pair">
      <Card className="flush">
        <div className="ph"><h3>Top Selling Products</h3><span className="meta">Selected month</span></div>
        <div className="table-wrap"><table><thead><tr><th>Product</th><th>Warehouse Product Code</th><th>Company</th><th>Marketplace</th><th className="n">Qty Sold</th><th className="n">Sales</th></tr></thead>
        <tbody>{d.topProducts.length ? d.topProducts.slice(0,10).map((p,i) => <tr key={i}>
          <td className="strong">{p.productName}</td><td><span className="code">{p.code}</span></td><td className="sub">{p.company}</td><td><Mkt name={p.marketplace}/></td><td className="n strong">{p.qty}</td><td className="n"><Money n={p.sales}/></td>
        </tr>) : empty}</tbody></table></div>
      </Card>

      <Card className="flush">
        <div className="ph"><h3>Top Performing Accounts</h3><span className="meta">Selected month</span></div>
        <div className="table-wrap"><table><thead><tr><th>Company</th><th>Marketplace</th><th className="n">Orders</th><th className="n">Quantity</th><th className="n">Sales</th></tr></thead>
        <tbody>{d.accounts.map(a => <tr key={a.company + a.marketplace}>
          <td>{a.company}</td><td><Mkt name={a.marketplace}/></td><td className="n">{a.orders}</td><td className="n">{a.qty}</td><td className="n strong"><Money n={a.sales}/></td>
        </tr>)}</tbody></table></div>
      </Card>
    </div>

    <Card className="flush">
      <div className="ph"><h3>Agent Activity</h3><span className="meta">Selected month</span></div>
      <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Company</th><th className="n">Orders</th><th className="n">Qty Sold</th><th className="n">Sales Due</th></tr></thead>
      <tbody>{d.agents.length ? d.agents.map(a => <tr key={a.id}>
        <td className="strong">{a.name}</td><td className="sub">{a.company}</td><td className="n">{a.orders}</td><td className="n">{a.qty}</td><td className="n"><Money n={a.salesDue}/></td>
      </tr>) : <EmptyRow colSpan="5">Add your first agent.</EmptyRow>}</tbody></table></div>
      <p className="note">Sales Due here is the stock cost of this month's sales only. Payments and the running wallet balance are on Agents &amp; Wallet.</p>
    </Card>
  </>;
}

function Sales({ state, reload, notify, setHealth }) {
  const activeCompanyIds = new Set(state.companies.filter(c => c.active !== false).map(c => c.id));
  const salesAgents = state.agents.filter(a => a.active !== false && activeCompanyIds.has(a.companyId));
  const [agentId, setAgentId] = useState(salesAgents[0]?.id || "");
  const accounts = state.accounts.filter(a => a.agentId === agentId && salesAgents.some(agent => agent.id === a.agentId));
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const activeProducts = state.products.filter(p => p.active !== false); // removed (archived) products are not offered for new sales
  const [productId, setProductId] = useState(activeProducts[0]?.id || "");
  const [qty, setQty] = useState(1);
  const [amount, setAmount] = useState("");
  const [orderId, setOrderId] = useState("");
  const [scanRows, setScanRows] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(null);
  const [scanErrors, setScanErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const nextRowId = useRef(0); // stable per-row identity for the whole page session, never reused, never index-based
  const pendingScanPerf = useRef([]);
  const activeBatchPerf = useRef(null);
  useEffect(()=>{
    activeBatchPerf.current?.log('progress_commit',{current:progress?.current ?? null,total:progress?.total ?? null,scanning});
  },[progress,scanning]);
  useEffect(() => {
    if (!pendingScanPerf.current.length) return;
    const ids=new Set(scanRows.map(r=>r._id));
    pendingScanPerf.current=pendingScanPerf.current.filter(entry=>{
      if (!entry.ids.every(id=>ids.has(id))) return true;
      entry.perf.log('scanRows_commit',{rows:entry.ids.length,totalFileToCommitMs:Number((performance.now()-entry.started).toFixed(3))});
      for (const row of scanRows) if (entry.ids.includes(row._id)) scanRowPerf.delete(row);
      return false;
    });
  },[scanRows]);

  useEffect(() => {
    if (!salesAgents.some(a => a.id === agentId)) setAgentId(salesAgents[0]?.id || "");
    const list = accounts;
    if (!list.some(a => a.id === accountId)) setAccountId(list[0]?.id || "");
  }, [agentId, accountId, state.accounts, state.agents, state.companies]);

  const account = state.accounts.find(a => a.id === accountId);

  const manualSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.addSales([{ agentId, accountId, productId, qty:Number(qty), saleAmount:Number(amount || 0), orderId, source:"manual" }]);
      await reload();
      setOrderId(""); setAmount(""); setQty(1);
      notify("Sale added and stock deducted.");
    } catch(e) { notify(e.message); }
    finally { setSaving(false); }
  };

  // Every scanned row finds its own Marketplace -> Company -> Agent -> Account -> Warehouse product (see autoDetect.js). Nothing is picked by hand.
  const detectCtx = { companies: state.companies.filter(c => activeCompanyIds.has(c.id)), agents: salesAgents, accounts: state.accounts, productMaster: state.productMaster.filter(m => activeCompanyIds.has(m.companyId)), products: activeProducts, allProductMaster: state.productMaster, allProducts: state.products };

  const savedOrders = new Set([...state.todaySales, ...state.salesHistory].map(x => String(x.orderId || "").trim().toLowerCase()).filter(Boolean));
  const seenInScan = new Set();
  // A row keeps its place in this table forever once scanned (see runScan/saveScans below) - r._saved / r._saveError are
  // set on the row itself once we know the ACTUAL backend result, so "Saved" always wins over Duplicate/Matched/etc:
  // a saved row's own orderId now also appears in savedOrders after reload(), and must never show as its own duplicate.
  const view = scanRows.map(r => {
    const oid = String(r.orderId || "").trim().toLowerCase();
    const duplicate = !!oid && (savedOrders.has(oid) || seenInScan.has(oid));
    if (oid) seenInScan.add(oid);
    const rowPerf=scanRowPerf.get(r);
    const d = rowPerf ? rowPerf.sync('product_company_agent_account_resolution',()=>resolveScanRow(r,detectCtx,rowPerf),{rowId:r._id}) : resolveScanRow(r, detectCtx);
    rowPerf?.log('mapping_result',{rowId:r._id,status:d.status,reason:d.reason,marketplace:d.marketplace});
    // A quantity that could not be confirmed from the label's Qty field (qtyGuard.js) blocks saving until the user
    // confirms or edits it - an otherwise Matched row shows as Needs Review and is not eligible for Save All Sales.
    const holdNotes = [r._reviewNote, r._qtyUncertain ? r._qtyNote : "", r._amountUncertain ? r._amountNote : ""].filter(Boolean);
    const fieldHold = holdNotes.length > 0 && d.status === "Matched";
    const baseStatus = duplicate ? "Duplicate" : fieldHold ? "Needs Review" : d.status;
    const baseReason = duplicate ? (savedOrders.has(oid) ? "already saved" : "repeated in this scan") : fieldHold ? holdNotes.join(" · ") : [d.reason, ...holdNotes].filter(Boolean).join(" · ");
    // Eligible for Save All Sales: genuinely Matched and not already saved - independent of any PAST failed attempt,
    // so a corrected/retryable row is picked up again without the user having to do anything else.
    const eligible = !r._saved && !r._qtyUncertain && !r._amountUncertain && !r._reviewNote && baseStatus === "Matched";
    const status = r._saved ? "Saved" : r._saveError ? "Error" : baseStatus;
    const reason = r._saved ? "" : r._saveError ? r._saveError : baseReason;
    return { r, ...d, status, reason, eligible };
  });
  const matched = view.filter(v => v.eligible);

  const undoLastBatch = async () => {
    if (!window.confirm("Undo the last saved sales batch and restore stock?")) return;
    try {
      const r = await api.undoLastBatch();
      await reload();
      notify(`Undid ${r.undone} sale(s); warehouse stock and agent due restored.`);
    } catch(e) { notify(e.message); }
  };

  // Neither of these touches scanRows: it is the working queue for the whole session (see runScan/saveScans below),
  // and must survive choosing a different file set or clearing the segregator's file input.
  const chooseFiles = e => {
    setFiles(Array.from(e.target.files || []));
    setScanErrors([]); setProgress(null);
    e.target.value = "";
  };
  const clearFiles = () => { setFiles([]); setScanErrors([]); setProgress(null); };

  // PDF text first; complete parsed rows skip Ollama regardless of mapping status.
  const runScan = async scanFiles => {
    if (!scanFiles.length) return;
    const rows = [], errors = [];
    const runId=newScanRunId();
    const batchPerf=createScanPerf(runId);
    activeBatchPerf.current=batchPerf;
    const fileTraces=[];
    batchPerf.log('runScan_start',{files:scanFiles.length,url:window.location.href,assets:[...document.scripts].map(s=>s.src).filter(Boolean),ollamaCalledMeaning:'label inference only; health ping logged separately'});
    setScanning(true);
    try {
      for (let i = 0; i < scanFiles.length; i++) {
        const started=performance.now();
        const perf=createScanPerf(runId,scanFiles[i].name,i+1);
        const entry={perf,started,ids:[]};
        const sourceScan={complete:false};
        let allPagesHaveRows=true;
        fileTraces.push(entry);
        const fileEnd=perf.begin('file',{bytes:scanFiles[i].size,type:scanFiles[i].type});
        setProgress({ current: i + 1, total: scanFiles.length });
        perf.log('progress_update_requested',{current:i+1,total:scanFiles.length});
        try {
          const add = (found, pageText) => { if (!found.length) allPagesHaveRows=false; const end=perf.begin('scanRows_buffer',{count:found.length}); for (const r of found) { const row={
            _id: `row_${nextRowId.current++}`,
            ...r,
            _sourceFile:scanFiles[i],
            _sourceScan:sourceScan,
            _pageText: found.length === 1 ? pageText : "",
            _docText: pageText,
            qty: Math.max(1, Number(r.qty || 1)),
            saleAmount: Number(r.saleAmount || 0),
            // Fields the scanner could not verify from the label (labelScan.js) block saving until confirmed/edited.
            _qtyUncertain: !!r._holds?.qty || !!r._qtyUncertain, _qtyNote: r._holds?.qty || r._qtyNote,
            _amountUncertain: !!r._holds?.amount, _amountNote: r._holds?.amount,
            _reviewNote: r._holds?.order || ""
          }; rows.push(row); entry.ids.push(row._id); scanRowPerf.set(row,perf); } end(); };
          const isPdf = scanFiles[i].type === "application/pdf" || scanFiles[i].name.toLowerCase().endsWith(".pdf");
          if (isPdf) {
            // Routing is independent for every page/file; images render only for fallback.
            for (const page of await perf.async('pdf_text_extraction',()=>fileToPdfPages(scanFiles[i],perf))) {
              perf.log('page_start',{page:page.pageNumber});
              const text = page.lines.join(" ");
              add(await scanPdfPage(page, detectCtx, api.scanLabel,perf), text);
            }
          } else {
            perf.source('OLLAMA_FALLBACK');
            perf.log('fallback_decision_end',{fallbackRequired:true,reason:'image input'});
            for (const imageBase64 of await perf.async('image_input_preparation',()=>fileToImageDataUrls(scanFiles[i]))) {
              perf.state.ollamaCalled=true;
              const result = await perf.async('ollama_request',()=>api.scanLabel({ imageBase64 }));
              console.debug('[Daily Sales image]', { method: 'OLLAMA_FALLBACK', file: scanFiles[i].name });
              const found = result.rows || [];
              add(verifyAiRows(found, [], { marketplace: null, rows: [] }).map(r => ({ ...r, _scanMethod: 'OLLAMA_FALLBACK', _diag: { stages: ['ollama (image, no text layer)'], ollama: { called: true, ok: true, model: result.model || '' }, verifyNotes: r._verifyNotes || [] } })), "");
            }
          }
          sourceScan.complete=allPagesHaveRows;
        } catch(e) { perf.log('file_error',{error:e.message}); errors.push(`${scanFiles[i].name}: ${e.message}`); }
        finally {
          fileEnd({rows:entry.ids.length,appendDeferredUntilBatchEnd:true});
          batchPerf.source(perf.state.parserSource);
          for (const key of ['ollamaCalled','imageRendered','imageRenderStarted']) batchPerf.state[key] ||= perf.state[key];
        }
      }
      // Append to whatever is already in the table - a second "Scan Selected" must never drop earlier (including
      // already-Saved) rows. Choosing files and Clear Files both preserve this table.
      pendingScanPerf.current.push(...fileTraces);
      for (const {perf,ids} of fileTraces) perf.log('scanRows_append_requested',{rows:ids.length});
      setScanRows(x => batchPerf.sync('scanRows_append_update',() => [...x, ...rows],{existingRows:x.length,newRows:rows.length})); setScanErrors(x => [...x, ...errors]);
      // Per-row diagnostics (developer log, not shown in the table): console + <data folder>/logs/scan-diagnostics.jsonl.
      try {
        const seen = new Set(scanRows.map(z => String(z.orderId || "").trim().toLowerCase()).filter(Boolean));
        const records = rows.map(row => {
          const d = resolveScanRow(row, detectCtx);
          const oid = String(row.orderId || "").trim().toLowerCase();
          const dup = oid && (savedOrders.has(oid) || seen.has(oid)) ? (savedOrders.has(oid) ? "already saved" : "repeated in this scan") : "";
          if (oid) seen.add(oid);
          return scanDiagnostic(row, d, dup ? { status: "Duplicate", reason: dup } : {});
        });
        for (const rec of records) console.info('[Scan diagnostic]', rec);
        for (const e of errors) console.warn('[Scan diagnostic] file error:', e);
        if (records.length || errors.length) void api.scanDiagnostics({ records, errors }).catch(() => {});
      } catch (err) { console.warn('[Scan diagnostic] failed:', err.message); }
      // Health is informational: it must not hold the scan queue busy after rows
      // are ready. In particular, an unavailable Ollama may leave this pending.
      void batchPerf.async('post_scan_health_request',()=>api.health().catch(()=>({ollama:{ok:true}})),{endpoint:'/api/health',mayPingOrStartOllama:true})
        .then(setHealth).catch(error=>batchPerf.log('post_scan_health_error',{error:error.message}));
      notify(`${rows.length} label row(s) read from ${scanFiles.length - errors.length} of ${scanFiles.length} file(s).`);
    } finally { setScanning(false); setProgress(null); batchPerf.log('runScan_end',{rows:rows.length,errors:errors.length}); }
  };

  const saleRowFor = ({r, product, agent, account, sku}) => ({
    agentId: agent.id, accountId: account.id, productId:product.id, marketplaceSku: sku, qty:r.qty, saleAmount:r.saleAmount,
    orderId:r.orderId || "", trackingId:r.trackingId || "", source:"ollama-label"
  });
  // Marks rows by their STABLE _id (never by array position/index - a save can finish out of order and the table can
  // grow in between), so each row's own confirmed result is what changes it, nothing else.
  const markRows = (ids, patch) => setScanRows(x => x.map(z => ids.has(z._id) ? { ...z, ...patch } : z));

  // /api/sales saves its whole request as one all-or-nothing transaction (see server/index.mjs mutate()): either every
  // row in the call is persisted together, or - if any one of them fails (e.g. a stock race) - NONE of them are. So:
  //   1) try the normal single request for every eligible row (fast path: keeps them as one undo-able batch, same as
  //      today, when everything succeeds - the overwhelmingly common case).
  //   2) only if that whole request is rejected, fall back to saving each of those rows with its OWN request, so the
  //      ones that genuinely succeed are kept and only the real failure(s) stay open - never guessed, only what the
  //      backend actually confirmed. A row already marked _saved is NEVER resent (see `eligible` above), so stock can
  //      never be deducted twice for it, whether this click is the first attempt or a retry of a past failure.
  const saveScans = async () => {
    if (saving || !matched.length) return;
    setSaving(true);
    const targets = matched;
    try {
      try {
        await api.addSales(targets.map(saleRowFor));
        markRows(new Set(targets.map(v => v.r._id)), { _saved: true, _saveError: undefined });
        await reload();
        notify(`${targets.length} sale(s) saved and warehouse stock deducted.`);
      } catch (bulkErr) {
        let ok = 0;
        for (const v of targets) {
          try {
            await api.addSales([saleRowFor(v)]);
            markRows(new Set([v.r._id]), { _saved: true, _saveError: undefined });
            ok++;
          } catch (rowErr) {
            markRows(new Set([v.r._id]), { _saveError: rowErr.message });
          }
        }
        await reload();
        notify(ok
          ? `${ok} of ${targets.length} sale(s) saved. The rest are still shown with their error - fix and try again.`
          : `Could not save: ${bulkErr.message}`);
      }
    } finally { setSaving(false); }
  };

  // Display-only: how many rows currently show each status (computed from the same `view` list the table renders).
  const statusCounts = view.reduce((t, v) => { t[v.status] = (t[v.status] || 0) + 1; return t; }, {});
  const SOURCE_LABEL = { "ollama-label":["scan","Label scan"], "manual":["hand","Manual"] };

  return <>
    <Card className="flush">
      <div className="ph"><h3 className="eyebrow"><span className="stepn">1</span>Scan Shipping Labels</h3><span className="meta">Amazon, Flipkart and Meesho labels together</span></div>
      <div className="scan-grid">
        <div className="scan-l">
          <label className={`upload ${scanning ? "busy" : ""}`}>
            <span className="up-ic"><Icon name="upload" size={18}/></span>
            <span><span className="up-t">{scanning ? (progress ? `Scanning ${progress.current} / ${progress.total}` : "Scanning with Ollama…") : "Choose Shipping Labels"}</span><span className="up-s">PDF / JPG / PNG · several files at once</span></span>
            <input disabled={scanning} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={chooseFiles} />
            {scanning && <span className="up-bar" aria-hidden="true"><i style={{width: progress ? `${Math.round(progress.current / progress.total * 100)}%` : "8%"}}/></span>}
          </label>
          <p className="hint">Drop Amazon, Flipkart and Meesho labels together (PDF / JPG / PNG). SellQuanta detects the marketplace, company and agent for every label.</p>
        </div>
        <div className="scan-r">
          {files.length > 0
            ? <LabelSegregator files={files} scanning={scanning} onScanSelected={runScan} onClear={clearFiles} savedOrders={savedOrders} scanRows={scanRows} />
            : <div className="scan-empty"><span className="ei"><Icon name="inbox" size={16}/></span><span>Chosen labels appear here, grouped by date and marketplace.</span></div>}
        </div>
      </div>
    </Card>

    {(scanRows.length > 0 || scanErrors.length > 0) && <Card className="flush">
      <div className="ph"><h3 className="eyebrow"><span className="stepn">2</span>Scanned Rows</h3><span className="meta">Order ID, Qty and Amount can be edited before saving</span></div>
      {scanRows.length > 0 && <div className="summary-strip" aria-label="Scanned row status counts">
        <div className="ss"><span className="sv">{view.length}</span><span className="sl">Rows</span></div>
        {[["Matched","var(--ok)"],["Needs Review","var(--warn)"],["Not Found","var(--err)"],["Duplicate","var(--dup)"],["Error","var(--err)"],["Saved","var(--ink-4)"]].filter(([k]) => statusCounts[k]).map(([k,c]) =>
          <div className="ss" key={k} style={{"--c":c}}><span className="sv">{statusCounts[k]}</span><span className="sl"><i></i>{k}</span></div>)}
      </div>}
      {scanErrors.map((e,i)=><p key={i} className="scanerr"><Icon name="error" size={14}/><span>Could not scan {e}</span></p>)}
      {scanRows.length > 0 && <div className="table-wrap scroll"><table id="scan-rows"><thead><tr><th>Order ID</th><th>Company</th><th>Agent</th><th>Marketplace</th><th>Marketplace SKU</th><th>Product Name</th><th className="n">Qty</th><th className="n">Amount</th><th>Warehouse Product</th><th>Status</th></tr></thead>
      <tbody>{view.map(({r, company, agent, marketplace, product, sku, masterName, status, reason})=>{
        const saved = !!r._saved;
        // Edits are matched by the row's own stable _id, never by its position in this list.
        const editRow = patch => setScanRows(x => x.map(z => z._id === r._id ? { ...z, ...patch } : z));
        const rowClass = saved ? "is-saved" : (status === "Error" || status === "Not Found") ? "is-err" : status === "Needs Review" ? "is-warn" : "";
        return <tr key={r._id} className={rowClass}>
        <td><input className="cin code" aria-label="Order ID" value={r.orderId || ""} disabled={saved} onChange={e=>editRow({orderId:e.target.value})}/></td>
        <td className="wrap">{company?.name || "—"}</td>
        <td>{agent?.name || "—"}</td>
        <td><Mkt name={marketplace}/></td>
        <td className="wrap"><span className="code">{sku || "—"}</span></td>
        <td className="wrap">{masterName || r.productName || "—"}</td>
        <td className="n"><input className="small cin r" aria-label="Qty" style={{width:52}} type="number" min="1" value={r.qty} disabled={saved} onChange={e=>{ const v=Number(e.target.value); editRow({qty:v, _qtyUncertain:!!r._qtyUncertain && !(Number.isInteger(v) && v>0)}); }}/></td>
        <td className="n"><input className="small cin r" aria-label="Amount" style={{width:76}} type="number" value={r.saleAmount} disabled={saved} onChange={e=>{ const v=Number(e.target.value); editRow({saleAmount:v, _amountUncertain:!!r._amountUncertain && !(v>0)}); }}/></td>
        <td className="wrap">{product ? <><span className="code">{product.sku}</span><small>{product.name}</small></> : "—"}</td>
        <td className="wrap" title={`Read by: ${r._scanMethod || "-"}${r._diag?.ollama?.called ? ` · Ollama ${r._diag.ollama.ok ? `OK${r._diag.ollama.ms ? ` (${Math.round(r._diag.ollama.ms/1000)}s)` : ""}` : `failed: ${r._diag.ollama.error || ""}`}` : " · Ollama not needed"}`}><StatusBadge status={status}/>{reason && <span className="reason">{reason}</span>}
          {!saved && (r._qtyUncertain || r._amountUncertain) && Number(r.qty) > 0 && (!r._amountUncertain || Number(r.saleAmount) > 0) && <button className="quiet sm qty-ok" onClick={()=>editRow({_qtyUncertain:false, _amountUncertain:false})}><Icon name="check" size={13}/>{r._qtyUncertain && r._amountUncertain ? `Qty ${r.qty} & ₹${r.saleAmount} are correct` : r._qtyUncertain ? `Qty ${r.qty} is correct` : `Amount ₹${r.saleAmount} is correct`}</button>}</td>
      </tr>; })}</tbody></table></div>}
      {scanRows.length > 0 && <div className="savebar">
        <span className="ready"><b>{matched.length}</b> matched row{matched.length === 1 ? "" : "s"} ready to save · warehouse stock is deducted on save</span>
        {matched.length > 0 && <button className="primary" disabled={saving} onClick={saveScans}><Icon name="check" size={15}/>Save All Sales</button>}
      </div>}
    </Card>}

    <Card className="flush">
      <div className="ph"><h3 className="eyebrow dim"><span className="stepn">+</span>Manual Sale</h3><span className="meta">For a sale without a label</span></div>
      <div className="pb">
        <div className="form-grid manual">
          <label>Agent<select value={agentId} onChange={e=>setAgentId(e.target.value)}>
            <option value="">Select agent</option>{salesAgents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
          <label>Account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>
            <option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
          <label>Product<select value={productId} onChange={e=>setProductId(e.target.value)}>
            <option value="">Select product</option>{activeProducts.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name} ({p.stock})</option>)}
          </select></label>
          <label>Qty<input type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)}/></label>
          <label>Amount<input type="number" value={amount} onChange={e=>setAmount(e.target.value)} /></label>
          <label>Order ID<input className="code" value={orderId} onChange={e=>setOrderId(e.target.value)} /></label>
          <button className="align-end" disabled={saving} onClick={manualSave}><Icon name="plus" size={15}/>Add Sale</button>
        </div>
      </div>
    </Card>

    <Card className="flush">
      <div className="ph"><h3 className="eyebrow"><span className="stepn">3</span>Today's Sales</h3><span className="meta">{state.todaySales.length} sale{state.todaySales.length === 1 ? "" : "s"} · newest first</span>
        <div className="acts"><button className="ghost sm" onClick={undoLastBatch}><Icon name="refund" size={14}/>Undo Last Batch</button></div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Account</th><th>Order</th><th>Product</th><th className="n">Qty</th><th className="n">Amount</th><th>Source</th></tr></thead>
      <tbody>{state.todaySales.length ? [...state.todaySales].reverse().map(s=><tr key={s.id}>
        <td className="strong">{state.agents.find(a=>a.id===s.agentId)?.name}</td>
        <td className="sub">{state.accounts.find(a=>a.id===s.accountId)?.name}</td>
        <td>{s.orderId ? <span className="code">{s.orderId}</span> : "—"}</td><td>{s.productName}</td><td className="n">{s.qty}</td><td className="n"><Money n={s.saleAmount}/></td>
        <td title={s.source}>{SOURCE_LABEL[s.source] ? <span className="src"><Icon name={SOURCE_LABEL[s.source][0]} size={13}/>{SOURCE_LABEL[s.source][1]}</span> : s.source}</td>
      </tr>):<EmptyRow colSpan="7">No sales entered today.</EmptyRow>}</tbody></table></div>
    </Card>
  </>;
}

function Warehouse({ state, reload, notify }) {
  const [exportingBackup, setExportingBackup] = useState(false);
  const exportBackup = async () => {
    if (exportingBackup) return false;
    setExportingBackup(true);
    try {
      const { blob, name } = await api.exportWarehouseBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { notify(e.message); throw e; }
    finally { setExportingBackup(false); }
  };
  const [sku,setSku]=useState("");
  const [name,setName]=useState("");
  const [cost,setCost]=useState(0);
  const [stock,setStock]=useState(0);
  const [low,setLow]=useState(5);
  const [adjustId,setAdjustId]=useState("");
  const [adjustQty,setAdjustQty]=useState("");
  const [adjustCost,setAdjustCost]=useState("");
  const [file,setFile]=useState(null);
  const [preview,setPreview]=useState(null);
  const [result,setResult]=useState(null);
  const [image,setImage]=useState("");
  const newImageInput = useRef(null);
  const changeImageInput = useRef(null);
  const changeImageId = useRef("");
  const products = state.products.filter(p => p.active !== false); // removed (archived) products are hidden here and in every selector
  const summary = warehouseSummary(products); // always calculated from the products above, so it follows every stock / cost / product change
  const [editId,setEditId]=useState("");
  const [editName,setEditName]=useState("");
  const [editCost,setEditCost]=useState("");
  const [editStock,setEditStock]=useState("");
  const [editImage,setEditImage]=useState("");
  const [editImageChanged,setEditImageChanged]=useState(false);
  const editImageInput = useRef(null);

  // Shrink to a small JPEG data URL (max 200px) so it can live inside the local JSON file.
  const fileToThumb = f => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 200 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    img.src = url;
  });

  const pickNewImage = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try { setImage(await fileToThumb(f)); } catch(err){notify(err.message);}
  };

  const pickChangeImage = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      await api.setProductImage(changeImageId.current, await fileToThumb(f));
      await reload(); notify("Product image saved.");
    } catch(err){notify(err.message);}
  };

  const startEdit = p => {
    setEditId(p.id); setEditName(p.name); setEditCost(String(p.costPrice ?? 0)); setEditStock(String(p.stock ?? 0));
    setEditImage(p.image || ""); setEditImageChanged(false);
  };

  const pickEditImage = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try { setEditImage(await fileToThumb(f)); setEditImageChanged(true); } catch(err){notify(err.message);}
  };

  const saveEdit = async () => {
    try {
      const body = { name:editName, costPrice:editCost, stock:editStock };
      if (editImageChanged) body.image = editImage;
      await api.updateProduct(editId, body);
      setEditId(""); await reload(); notify("Product updated.");
    } catch(e){notify(e.message);}
  };

  const removeProduct = async p => {
    if (!window.confirm("Are you sure you want to remove this product?")) return;
    try {
      const r = await api.removeProduct(p.id);
      if (editId === p.id) setEditId("");
      await reload();
      notify(r.deleted ? "Product removed." : "Product removed from the warehouse. Its history is kept.");
    } catch(e){notify(e.message);}
  };

  const add = async () => {
    try {
      await api.addProduct({sku,name,costPrice:Number(cost),stock:Number(stock),lowStockLevel:Number(low),image});
      setSku(""); setName(""); setCost(0); setStock(0); setLow(5); setImage(""); await reload(); notify("Product added.");
    } catch(e){notify(e.message);}
  };

  const fileToBase64 = f => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(f);
  });

  const fileInput = useRef(null);

  const downloadTemplate = async () => {
    try {
      const url = URL.createObjectURL(await api.productImportTemplate());
      const a = document.createElement("a"); a.href=url; a.download="SellQuanta_Warehouse_Import_Template.xlsx"; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e){notify(e.message); throw e;}
  };

  const pickFile = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setFile(f); setPreview(null); setResult(null);
    try {
      const { rows } = await api.previewProductImport(await fileToBase64(f));
      setPreview(rows);
    } catch(err){notify(err.message);}
  };

  const importValid = async () => {
    try {
      setResult(await api.importProducts(await fileToBase64(file)));
      setPreview(null); setFile(null); await reload(); notify("Import finished.");
    } catch(e){notify(e.message);}
  };

  const adjust = async () => {
    try {
      await api.adjustStock({productId:adjustId, costPrice:adjustCost, qty:adjustQty, note:"Manual warehouse adjustment"});
      setAdjustQty(""); await reload(); notify("Product updated.");
    } catch(e){notify(e.message);}
  };

  return <>
    <Card className="flush">
      <div className="tool-grid">
        <section>
          <h3>Manual Product Entry</h3>
          <div className="form-grid wh-entry">
            <label>Warehouse Product Code<input className="code" value={sku} onChange={e=>setSku(e.target.value)}/></label>
            <label>Product Name<input value={name} onChange={e=>setName(e.target.value)}/></label>
            <label>Cost Price<input type="number" min="0" value={cost} onChange={e=>setCost(e.target.value)}/></label>
            <label>Opening Stock<input type="number" min="0" value={stock} onChange={e=>setStock(e.target.value)}/></label>
            <label>Low Stock Alert<input type="number" value={low} onChange={e=>setLow(e.target.value)}/></label>
            <button className="align-end" onClick={add}><Icon name="plus" size={15}/>Add Product</button>
          </div>
          <div className="img-row">
            {image && <span className="thumb"><img src={image} alt=""/></span>}
            <button className="ghost sm" onClick={()=>newImageInput.current.click()}><Icon name="image" size={14}/>{image ? "Change Image" : "Product Image (optional)"}</button>
            <input ref={newImageInput} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={pickNewImage}/>
            {image && <button className="quiet sm" onClick={()=>setImage("")}>Remove</button>}
          </div>
        </section>

        <section>
          <h3>Bulk Import Products</h3>
          <div className="inline">
            <DownloadButton action={exportBackup} label="Export Warehouse Backup"/>
            <DownloadButton action={downloadTemplate} label="Download Excel Template"/>
            <button className="ghost" onClick={()=>fileInput.current.click()}><Icon name="upload" size={15}/>Upload Excel</button>
            <input ref={fileInput} type="file" accept=".xlsx" hidden onChange={pickFile}/>
            {file && <span className="muted">{file.name}</span>}
          </div>
          {preview && <div className="inline" style={{marginTop:12}}><button className="primary" onClick={importValid} disabled={!preview.some(r=>r.status!=="Error")}><Icon name="check" size={15}/>Import Valid Products</button></div>}
          {result && <div>
            <p className="result-line"><span>New products added: <b>{result.added}</b></span><span>Existing products updated: <b>{result.updated}</b></span><span>Error/skipped rows: <b>{result.errors.length}</b></span></p>
            {result.errors.length > 0 && <ul className="err-list">{result.errors.map(r=><li key={r.row}>Row {r.row}: {r.error}</li>)}</ul>}
          </div>}
        </section>
      </div>
      {preview && <div className="table-wrap scroll" style={{borderTop:"1px solid var(--line)"}}><table><thead><tr><th>Warehouse Product Code</th><th>Product Name</th><th className="n">Cost Price</th><th className="n">Opening Stock</th><th>Status</th></tr></thead>
      <tbody>{preview.length ? preview.map(r=><tr key={r.row} className={r.status==="Error" ? "is-err" : ""}>
        <td><span className="code">{r.code}</span></td><td>{r.name}</td><td className="n">{r.costPrice}</td><td className="n">{r.openingStock}</td>
        <td className="wrap"><span className={`badge ${r.status==="Error" ? "err" : r.status==="New" ? "" : "info"}`}>{r.status}</span>{r.error && <span className="reason">{r.error}</span>}</td>
      </tr>):<EmptyRow colSpan="5">No rows found in the WAREHOUSE sheet.</EmptyRow>}</tbody></table></div>}
    </Card>

    <Card className="flush">
      <div className="ph"><h3>Stock In / Adjustment</h3><span className="meta">Positive quantity adds stock, negative removes it</span></div>
      <div className="pb">
        <div className="form-grid stock-adj">
          <label>Product<select value={adjustId} onChange={e=>{setAdjustId(e.target.value); setAdjustCost(String(products.find(p=>p.id===e.target.value)?.costPrice ?? ""));}}>
            <option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name} ({p.stock})</option>)}
          </select></label>
          <label>Cost Price<input type="number" min="0" value={adjustCost} onChange={e=>setAdjustCost(e.target.value)}/></label>
          <label>Quantity Change<input type="number" placeholder="+20 or -2" value={adjustQty} onChange={e=>setAdjustQty(e.target.value)}/></label>
          <button className="align-end" onClick={adjust}>Update Product</button>
        </div>
      </div>
    </Card>

    <div className="stats cols-3">
      <Stat label="Total Products" value={summary.products.toLocaleString("en-IN")} />
      <Stat label="Total Stock Units" value={summary.units.toLocaleString("en-IN")} />
      <Stat label="Current Stock Value" value={<Money n={summary.value}/>} sub="Current Stock × Cost Price" className="primary" />
    </div>

    <Card className="flush">
      <div className="ph"><h3>Warehouse Stock</h3><span className="meta">{products.length} product{products.length === 1 ? "" : "s"}</span></div>
      <div className="table-wrap"><table><thead><tr><th style={{width:64}}>Image</th><th>Warehouse Product Code</th><th>Product Name</th><th className="n">Cost Price</th><th className="n">Current Stock</th><th className="n">Actions</th></tr></thead>
      <tbody>{products.length ? products.map(p=>{
        const editing = editId === p.id;
        const shownImage = editing ? editImage : p.image;
        const stockClass = Number(p.stock) <= 0 ? "zero" : Number(p.stock) <= (p.lowStockLevel ?? 5) ? "lowq" : "";
        return <tr key={p.id} className={editing ? "is-editing" : ""}>
        <td style={{paddingTop:6,paddingBottom:6}}>
          <div className="thumb">
            {shownImage
              ? <img src={shownImage} alt=""/>
              : <div className="ph-img"><Icon name="image" size={16} strokeWidth={1.7}/></div>}
            <button className="img-edit" title="Edit image" aria-label="Edit image" onClick={()=>{ if (editing) editImageInput.current.click(); else { changeImageId.current=p.id; changeImageInput.current.click(); } }}><Icon name="pencil" size={11} strokeWidth={2.2}/></button>
          </div>
          {editing && editImage && <button className="quiet sm" style={{marginTop:6,height:24,padding:"0 6px",fontSize:11}} onClick={()=>{setEditImage(""); setEditImageChanged(true);}}>Remove image</button>}
        </td>
        {editing
          ? <>
              <td title="The Warehouse Product Code is permanent and cannot be edited"><span className="code">{p.sku}</span></td>
              <td className="wrap"><input value={editName} onChange={e=>setEditName(e.target.value)}/></td>
              <td className="n"><input type="number" min="0" className="small" value={editCost} onChange={e=>setEditCost(e.target.value)}/></td>
              <td className="n"><input type="number" min="0" step="1" className="small" value={editStock} onChange={e=>setEditStock(e.target.value)}/></td>
              <td className="actions"><span className="row-acts">
                <button className="primary sm" onClick={saveEdit}>Save</button>
                <button className="ghost sm" onClick={()=>setEditId("")}>Cancel</button>
              </span></td>
            </>
          : <>
              <td><span className="code">{p.sku}</span></td><td className="strong wrap">{p.name}</td><td className="n"><Money n={p.costPrice}/></td><td className="n"><span className={`stock-q ${stockClass}`}>{p.stock}</span></td>
              <td className="actions"><span className="row-acts">
                <button className="icon-btn" title="Edit" aria-label={`Edit ${p.name}`} onClick={()=>startEdit(p)}><Icon name="pencil" size={15}/></button>
                <button className="icon-btn danger" title="Remove" aria-label={`Remove ${p.name}`} onClick={()=>removeProduct(p)}><Icon name="trash" size={15}/></button>
              </span></td>
            </>}
      </tr>;}):<EmptyRow colSpan="6">No products yet.</EmptyRow>}</tbody></table></div>
      <input ref={changeImageInput} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={pickChangeImage}/>
      <input ref={editImageInput} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={pickEditImage}/>
    </Card>
  </>;
}

function ProductMaster({ state, reload, notify }) {
  const [exportingBackup, setExportingBackup] = useState(false);
  const activeCompanies = state.companies.filter(c => c.active !== false);
  const remembered = key => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
  const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const [companyId,setCompanyId]=useState(() => { const v = remembered("sp_master_company"); return activeCompanies.some(c=>c.id===v) ? v : ""; });
  const [marketplace,setMarketplace]=useState(() => { const v = remembered("sp_master_marketplace"); return ["Amazon","Flipkart","Meesho"].includes(v) ? v : ""; });
  const [file,setFile]=useState(null);
  const [result,setResult]=useState(null);
  const fileInput = useRef(null);
  const ready = activeCompanies.some(c => c.id === companyId) && marketplace;
  const exportBackup = async () => {
    if (exportingBackup || !companyId) return false;
    setExportingBackup(true);
    try {
      const { blob, name } = await api.exportCompanyBackup(companyId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { notify(e.message); throw e; }
    finally { setExportingBackup(false); }
  };
  useEffect(() => {
    if (companyId && !activeCompanies.some(c => c.id === companyId)) {
      setCompanyId(""); remember("sp_master_company", ""); setFile(null); setResult(null);
    }
  }, [companyId, state.companies]);

  const resetImport = () => { setFile(null); setResult(null); };

  const fileToBase64 = f => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(f);
  });

  const downloadTemplate = async () => {
    try {
      const {blob,name} = await api.productMasterTemplate(companyId, marketplace);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=name; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e){notify(e.message); throw e;}
  };

  const pickFile = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setFile(f); setResult(null);
    try {
      setResult(await api.importProductMaster({companyId, marketplace, fileBase64: await fileToBase64(f)}));
      await reload(); notify("Import finished.");
    } catch(err){notify(err.message);}
  };

  const saved = state.productMaster.filter(m => m.companyId === companyId && String(m.marketplace).toLowerCase() === marketplace.toLowerCase());
  const [editId,setEditId]=useState("");
  const [editProductId,setEditProductId]=useState("");
  const [editName,setEditName]=useState(true);

  const saveMapping = async () => {
    try {
      await api.updateMasterProduct(editId, editProductId, editName);
      setEditId(""); await reload(); notify("Product Master mapping updated.");
    } catch(e){notify(e.message);}
  };

  const codeOf = id => state.products.find(p => p.id === id)?.sku || "—";
  const companyName = id => state.companies.find(c=>c.id===id)?.name || "—";

  // "+ Add Product": one manual mapping, always for the Company + Marketplace already selected above.
  const [showAdd,setShowAdd]=useState(false);
  const [addCode,setAddCode]=useState("");
  const [addSku,setAddSku]=useState("");
  const [addName,setAddName]=useState("");
  const [addError,setAddError]=useState("");
  const openAdd = () => { setAddCode(""); setAddSku(""); setAddName(""); setAddError(""); setShowAdd(true); };
  const addProduct = async () => {
    setAddError("");
    try {
      await api.addMasterProduct({ companyId, marketplace, code: addCode, sku: addSku, name: addName });
      setShowAdd(false); await reload(); notify("Product Master mapping added.");
    } catch(e){ setAddError(e.message); }
  };

  const removeMapping = async m => {
    if (!window.confirm(`Remove this product from ${companyName(m.companyId)} / ${m.marketplace} Product Master?`)) return;
    try {
      await api.removeMasterProduct(m.id);
      if (editId === m.id) setEditId("");
      await reload(); notify("Product Master mapping removed.");
    } catch(e){notify(e.message);}
  };

  return <>
    <Card className="flush">
      <div className={`context-bar ${ready ? "" : "idle"}`}>
        <label>Company<select value={companyId} onChange={e=>{setCompanyId(e.target.value); remember("sp_master_company", e.target.value); resetImport();}}>
          <option value="">Select company</option>{activeCompanies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label>Marketplace<select value={marketplace} onChange={e=>{setMarketplace(e.target.value); remember("sp_master_marketplace", e.target.value); resetImport();}}>
          <option value="">Select marketplace</option>{["Amazon","Flipkart","Meesho"].map(m=><option key={m} value={m}>{m}</option>)}
        </select></label>
        <DownloadButton action={exportBackup} label="Export Company Backup" disabled={!companyId}/>
      </div>
      {!ready && <div className="empty"><span className="ei"><Icon name="link" size={16}/></span><b>Select a company and marketplace to view Product Master mappings.</b></div>}
      {ready && <div className="ctx-line">
        <span>Editing <b>{companyName(companyId)}</b></span><Mkt name={marketplace}/><span>· {saved.length} mapping{saved.length === 1 ? "" : "s"}</span>
        <div className="acts">
          <DownloadButton action={downloadTemplate} label="Download Excel Template" className="ghost sm" iconSize={14}/>
          <button className="ghost sm" onClick={()=>fileInput.current.click()}><Icon name="upload" size={14}/>Upload Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx" hidden onChange={pickFile}/>
          <button className="sm" onClick={openAdd}><Icon name="plus" size={14}/>Add Product</button>
        </div>
      </div>}
      {ready && (file || result) && <div className="pb" style={{paddingTop:12,paddingBottom:12,borderBottom:"1px solid var(--line)"}}>
        {file && <span className="muted">{file.name}</span>}
        {result && <p className="result-line" style={{marginTop:file ? 8 : 0}}><span>Imported: <b>{result.added}</b></span><span>Updated: <b>{result.updated}</b></span><span>Errors: <b>{result.errors.length}</b></span></p>}
        {result && result.errors.length > 0 && <ul className="err-list">{result.errors.map(r=><li key={r.row}>Row {r.row}{r.code ? ` (${r.code})` : ""}: Error — {r.error}</li>)}</ul>}
      </div>}
      {ready && <>
        <h3 className="sub-h">Product Sheet</h3>
        <div className="table-wrap"><table><thead><tr><th>Warehouse Product Code</th><th>Marketplace SKU</th><th>Product Name</th><th className="n">Action</th></tr></thead>
        <tbody>{saved.length ? saved.map(m=>editId===m.id
          ? <tr key={m.id} className="is-editing">
              <td><select value={editProductId} onChange={e=>setEditProductId(e.target.value)}>
                {state.products.filter(p=>p.active!==false || p.id===m.productId).map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name}{p.active===false ? " (removed)" : ""}</option>)}
              </select></td>
              <td><span className="code">{m.marketplaceSku}</span></td>
              <td><label className="check-label"><input type="checkbox" checked={editName} onChange={e=>setEditName(e.target.checked)}/> Also use the warehouse product name</label></td>
              <td className="actions"><span className="row-acts">
                <button className="icon-btn" title="Save" aria-label="Save" onClick={saveMapping}><Icon name="check" size={16}/></button>
                <button className="icon-btn" title="Cancel" aria-label="Cancel" onClick={()=>setEditId("")}><Icon name="x" size={16}/></button>
              </span></td>
            </tr>
          : <tr key={m.id}>
              <td><span className="code">{codeOf(m.productId)}</span></td><td><span className="code">{m.marketplaceSku}</span></td><td>{m.productName}</td>
              <td className="actions"><span className="row-acts">
                <button className="icon-btn" title="Edit mapping" aria-label="Edit mapping" onClick={()=>{setEditId(m.id); setEditProductId(m.productId); setEditName(true);}}><Icon name="pencil" size={15}/></button>
                <button className="icon-btn danger" title="Remove mapping" aria-label="Remove mapping" onClick={()=>removeMapping(m)}><Icon name="trash" size={15}/></button>
              </span></td>
            </tr>) : <EmptyRow colSpan="4">No Product Master mappings for this company and marketplace yet.</EmptyRow>}</tbody></table></div>
      </>}
      {showAdd && <div className="backdrop" onClick={()=>setShowAdd(false)}>
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="pm-add-title" onClick={e=>e.stopPropagation()}>
          <div className="dh"><div style={{flex:1}}>
            <h3 id="pm-add-title">Add Product</h3>
            <p>Company: <b>{companyName(companyId)}</b> &nbsp;•&nbsp; Marketplace: <b>{marketplace}</b></p>
          </div><button className="icon-btn" title="Close" aria-label="Close" onClick={()=>setShowAdd(false)}><Icon name="x" size={16}/></button></div>
          <div className="db">
            <div className="form-grid one">
              <label>Warehouse Product Code<input className="code" value={addCode} onChange={e=>setAddCode(e.target.value)} autoFocus/></label>
              <label>Marketplace SKU<input className="code" value={addSku} onChange={e=>setAddSku(e.target.value)}/></label>
              <label>Product Name<input value={addName} onChange={e=>setAddName(e.target.value)}/></label>
            </div>
            {addError && <p className="form-error"><Icon name="error" size={14}/><span>{addError}</span></p>}
          </div>
          <div className="df">
            <button className="quiet" onClick={()=>setShowAdd(false)}>Cancel</button>
            <button className="primary" onClick={addProduct}>Save Product</button>
          </div>
        </div>
      </div>}
    </Card>
  </>;
}

function CompanyManagement({ state, reload, notify }) {
  const [name, setName] = useState("");
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (id, value) => {
    if (busy || !value.trim()) return;
    setBusy(true);
    try {
      if (id) await api.renameCompany(id, value);
      else await api.addCompany(value);
      setName(""); setEditId(""); await reload();
      notify(id ? "Company name updated. Existing relationships are preserved." : "Company added.");
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };
  const remove = async company => {
    if (busy || !window.confirm(`Remove ${company.name}? Used companies are archived and all related records are kept. Only a completely unused company is permanently deleted.`)) return;
    setBusy(true);
    try {
      const result = await api.removeCompany(company.id);
      if (editId === company.id) setEditId("");
      await reload();
      notify(result.deactivated ? "Company archived. Existing records are preserved." : "Unused company deleted.");
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };
  return <Card className="flush">
    <div className="ph"><h3>Company Management</h3></div>
    <div className="pb">
      {state.companies.length === 0 && <p className="muted">Add your first company</p>}
      <form className="form-grid" onSubmit={e => { e.preventDefault(); save("", name); }}>
        <label>Company Name<input required value={name} onChange={e => setName(e.target.value)} /></label>
        <button className="align-end" disabled={busy || !name.trim()}><Icon name="plus" size={15}/>Add Company</button>
      </form>
    </div>
    {state.companies.length > 0 && <div className="table-wrap"><table>
      <thead><tr><th>Company</th><th>Status</th><th className="n">Action</th></tr></thead>
      <tbody>{state.companies.map(c => <tr key={c.id}>
        <td>{editId === c.id ? <input aria-label="Edit company name" value={editName} onChange={e => setEditName(e.target.value)} /> : c.name}</td>
        <td><span className={`badge ${c.active === false ? "arch" : "ok"}`}>{c.active === false ? "Archived" : "Active"}</span></td>
        <td className="actions">{editId === c.id ? <>
          <button className="sm" disabled={busy || !editName.trim()} onClick={() => save(c.id, editName)}>Save name</button>
          <button className="ghost sm" disabled={busy} onClick={() => setEditId("")}>Cancel</button>
        </> : <button className="ghost sm" disabled={busy} onClick={() => { setEditId(c.id); setEditName(c.name); }}>Rename</button>}
        {c.active !== false && <button className="danger sm" disabled={busy} onClick={() => remove(c)}>Remove</button>}</td>
      </tr>)}</tbody>
    </table></div>}
  </Card>;
}

function Agents({ state, reload, notify }) {
  const activeCompanies = state.companies.filter(c => c.active !== false);
  const activeAgents = state.agents.filter(a => a.active !== false);
  const paymentAgents = activeAgents.filter(a => activeCompanies.some(c => c.id === a.companyId));
  const [name,setName]=useState("");
  const [companyId,setCompanyId]=useState("");
  const [agentId,setAgentId]=useState(paymentAgents[0]?.id || "");
  const [amount,setAmount]=useState("");
  const [note,setNote]=useState("");
  const [editId,setEditId]=useState("");
  const [editCompany,setEditCompany]=useState("");
  const [companyFilter,setCompanyFilter]=useState(""); // Part 4: "" = All Companies
  const [viewAgentId,setViewAgentId]=useState("");     // Part 1: which agent's Wallet Details panel is open
  useEffect(() => {
    if (!paymentAgents.some(a => a.id === agentId)) setAgentId("");
    if (!activeCompanies.some(c => c.id === companyId)) setCompanyId("");
    if (!activeCompanies.some(c => c.id === editCompany)) setEditCompany("");
  }, [state.companies, state.agents, agentId, companyId, editCompany]);

  const companyOf = a => state.companies.find(c=>c.id===a?.companyId)?.name || "—";
  const marketplacesOf = id => ["Amazon","Flipkart","Meesho"].filter(m=>state.accounts.some(x=>x.agentId===id && x.marketplace===m)).join(" • ");
  // Same cumulative wallet formula everywhere: see client/src/wallet.js (mirrors server walletTotals exactly).
  const totals = id => agentWalletTotals(state.ledger, id, state.walletResets);
  const shownAgents = companyFilter ? activeAgents.filter(a => a.companyId === companyFilter) : activeAgents;

  // Wallet card: ledger totals for the agents currently shown (all companies, or just the filtered one). Nothing is stored.
  const shownIds = new Set(shownAgents.map(a => a.id));
  const ledgerSum = type => state.ledger.filter(l => shownIds.has(l.agentId) && l.type===type).reduce((t,l)=>t+Number(l.amount||0),0);
  const totalReceived = ledgerSum("PAYMENT");           // actual cash received only
  const totalSettled = ledgerSum("SETTLEMENT");         // non-cash Reset Wallet write-offs
  const totalStockCost = ledgerSum("SALE");
  // Pending Due = the sum of the Balance column below (each agent's current wallet since its latest reset).
  const pendingDue = Math.round(shownAgents.reduce((t, a) => t + totals(a.id).pending, 0) * 100) / 100;
  void totalSettled;

  const viewAgent = state.agents.find(a => a.id === viewAgentId) || null;
  const lastReset = viewAgent ? latestWalletReset(state.walletResets, viewAgent.id) : null;
  const bd = viewAgent ? agentWalletBreakdown(state, viewAgent.id, lastReset) : null;
  const wt = viewAgent ? totals(viewAgent.id) : null;

  const resetWallet = async agent => {
    const w = totals(agent.id);
    const question = `RESET WALLET\n\nAgent: ${agent.name}\nCompany: ${companyOf(agent)}\nCurrent Balance: ${money(w.pending)}\n\n`
      + `The current wallet will start again from a fresh ₹0 baseline.\n`
      + `Nothing is deleted: all sales, refunds, payments and history stay saved and visible.\nNew sales and payments will count from now on.\n\nReset this wallet?`;
    if (!window.confirm(question)) return;
    try {
      await api.resetAgentWallet(agent.id);
      await reload();
      notify("Wallet reset to ₹0. Previous history has been preserved.");
    } catch(e){notify(e.message);}
  };

  const addAgent=async()=>{
    try {
      const r = await api.addAgent(name, companyId);
      setName(""); setCompanyId(""); await reload();
      notify(r.reactivated ? "Agent reactivated — its Amazon, Flipkart and Meesho accounts and history are kept." : "Agent added with Amazon, Flipkart and Meesho accounts.");
    }
    catch(e){notify(e.message);}
  };
  const saveCompany=async()=>{
    try { await api.setAgentCompany(editId, editCompany); setEditId(""); await reload(); notify("Company saved."); }
    catch(e){notify(e.message);}
  };
  // Same rule the server uses to decide Remove vs Archive, so the confirmation asks the right question up front.
  const agentHasHistory = id => [state.ledger, state.todaySales, state.salesHistory, state.stockMovements, state.refunds].some(list => list.some(x => x.agentId === id));
  const removeAgent=async id=>{
    const willArchive = agentHasHistory(id);
    const question = willArchive
      ? "This agent has sales, payment or ledger history. They will be archived (not deleted): their history stays, but they will no longer appear as an active agent. Continue?"
      : "Remove this agent? They have no history, so the agent and their Amazon, Flipkart and Meesho accounts will be permanently deleted.";
    if (!window.confirm(question)) return;
    try {
      const r = await api.deleteAgent(id);
      if (agentId === id) setAgentId("");
      if (viewAgentId === id && !r.deactivated) setViewAgentId(""); // fully deleted: nothing left to show details for
      await reload();
      notify(r.deactivated ? "Agent has transaction history and was archived instead of deleted." : "Agent deleted.");
    } catch(e){notify(e.message);}
  };
  const sel = agentId ? totals(agentId) : null;
  const pay=async()=>{
    if (sel && sel.pending <= 0) return notify("No payment due");
    if (!(Number(amount) > 0)) return notify("Payment amount must be a number greater than 0.");
    if (sel && Math.round(Number(amount) * 100) > Math.round(sel.pending * 100)) return notify(`Payment cannot exceed pending due of ${money(sel.pending)}.`);
    try {
      const who = state.agents.find(a=>a.id===agentId)?.name || "agent";
      await api.addPayment({agentId, amount:Number(amount), note});
      const paid = Number(amount);
      setAmount(""); setNote(""); await reload();
      notify(`${money(paid)} added to ${who} wallet`);
    }
    catch(e){notify(e.message);}
  };

  return <>
    <CompanyManagement state={state} reload={reload} notify={notify} />
    <div className="grid2">
      <Card>
        <h3>Add Agent</h3>
        <div className="form-grid agent-add">
          <label>Agent Name<input value={name} onChange={e=>setName(e.target.value)}/></label>
          <label>Company<select value={companyId} onChange={e=>setCompanyId(e.target.value)}>
            <option value="">Select company</option>{activeCompanies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
          <button className="align-end" disabled={!name.trim() || !activeCompanies.some(c => c.id === companyId)} onClick={addAgent}><Icon name="plus" size={15}/>Add Agent</button>
        </div>
      </Card>
      <Card>
        <h3>Add Agent Payment</h3>
        <div className="form-grid">
          <label>Agent<select value={agentId} onChange={e=>setAgentId(e.target.value)}>
            <option value="">Select agent</option>{paymentAgents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
          <label>Payment Amount<input type="number" min="0" max={sel ? sel.pending : undefined} disabled={!!sel && sel.pending <= 0} value={amount} onChange={e=>setAmount(e.target.value)}/></label>
          {agentId && <small className="field-note span2">Company: <b>{companyOf(state.agents.find(a=>a.id===agentId))}</b> &nbsp;•&nbsp; Stock Cost Due: <b>{money(sel.due)}</b> &nbsp;•&nbsp; Paid: <b>{money(sel.paid)}</b> &nbsp;•&nbsp; Pending Due: <b>{money(sel.pending)}</b>{sel.pending <= 0 && <b> &nbsp;•&nbsp; No payment due</b>}</small>}
          <label>Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="UPI / cash / bank transfer"/></label>
          <button className="align-end" onClick={pay} disabled={!!sel && sel.pending <= 0}>Add Payment</button>
        </div>
      </Card>
    </div>

    <div className="stats cols-3">
      <Stat label="Total Received" value={<Money n={totalReceived}/>} className="primary" />
      <Stat label="Total Stock Cost" value={<Money n={totalStockCost}/>} />
      <Stat label="Pending Due" value={<Money n={pendingDue}/>} />
    </div>

    <Card className="flush">
      <div className="ph"><h3>Agent Wallets</h3>
        <div className="acts">
          <select className="compact" aria-label="Company filter" value={companyFilter} onChange={e=>setCompanyFilter(e.target.value)}>
            <option value="">All Companies</option>
            {state.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Company</th><th>Accounts</th><th className="n">Stock Cost Due</th><th className="n">Wallet Credit</th><th className="n">Balance</th><th className="n">Action</th></tr></thead>
      <tbody>{shownAgents.map(a=>{ const t = totals(a.id); return <tr key={a.id} className={viewAgentId===a.id ? "is-editing" : ""}>
        <td><button className="link" title="View wallet details" aria-label={`View wallet details for ${a.name}`}
          onClick={()=>setViewAgentId(viewAgentId===a.id ? "" : a.id)}>{a.name}</button></td>
        <td>{editId===a.id
          ? <span className="row-acts" style={{display:"inline-flex",gap:4,alignItems:"center"}}>
              <select autoFocus aria-label="Agent company" style={{width:160}} value={editCompany} onChange={e=>setEditCompany(e.target.value)}>
                <option value="">Select company</option>{activeCompanies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="icon-btn" title="Save company" aria-label="Save company" onClick={saveCompany}><Icon name="check" size={16}/></button>
              <button className="icon-btn" title="Cancel" aria-label="Cancel" onClick={()=>setEditId("")}><Icon name="x" size={16}/></button>
            </span>
          : <span style={{display:"inline-flex",gap:2,alignItems:"center"}}>{companyOf(a)} <button className="icon-btn" title="Edit company" aria-label="Edit company" onClick={()=>{setEditId(a.id); setEditCompany(activeCompanies.some(c => c.id === a.companyId) ? a.companyId : "");}}><Icon name="pencil" size={13}/></button></span>}</td>
        <td><span className="mkts">{marketplacesOf(a.id).split(" • ").filter(Boolean).map(m=><Mkt key={m} name={m}/>)}</span></td>
        <td className="n"><Money n={t.due}/></td><td className="n"><Money n={t.paid}/></td><td className={`n ${t.pending > 0 ? "bal-due" : "strong"}`}><Money n={t.pending}/></td>
        <td className="actions"><button className="icon-btn danger" title="Delete agent" aria-label="Delete agent" onClick={()=>removeAgent(a.id)}><Icon name="trash" size={15}/></button></td></tr>; })}</tbody></table></div>
    </Card>

    {viewAgent && <Card className="flush">
      <div className="detail-head">
        <div>
          <h3>Agent Wallet Details — {viewAgent.name}</h3>
          <div className="kv-line"><span>Company: <b>{companyOf(viewAgent)}</b></span><span>Accounts: <b>{marketplacesOf(viewAgent.id) || "—"}</b></span>{viewAgent.active === false && <span className="badge arch">Archived</span>}</div>
          {lastReset && <div className="kv-line"><span>Current wallet since reset on <b>{localDateTime(lastReset.resetAt, lastReset.date)}</b> — earlier sales, refunds and payments stay in the history below and in reports.</span></div>}
        </div>
        <div className="acts">
          <button className="danger sm" title="Start this agent's current wallet again from ₹0 (history is kept)" onClick={()=>resetWallet(viewAgent)}><Icon name="refund" size={14}/>Reset Wallet</button>
          <button className="icon-btn" title="Close" aria-label="Close wallet details" onClick={()=>setViewAgentId("")}><Icon name="x" size={16}/></button>
        </div>
      </div>

      <div className="stats" style={{border:0,borderBottom:"1px solid var(--line)",borderRadius:0,margin:0}}>
        <Stat label="Total Sales" value={<Money n={bd.totals.sales}/>} sub={`${bd.totals.qty} unit(s), net of refunds`} />
        <Stat label="Total Stock Cost Due" value={<Money n={wt.due}/>} />
        <Stat label="Total Paid / Wallet Credit" value={<Money n={wt.paid}/>} />
        <Stat label="Current Balance" value={<Money n={wt.pending}/>} className="primary" />
      </div>

      <div className="detail-sec">
        <h3 className="sub-h">Marketplace Breakdown</h3>
        {bd.byMarketplace.length
          ? <div className="table-wrap"><table className="table-dense"><thead><tr><th>Marketplace</th><th className="n">Qty Sold</th><th className="n">Stock Cost Due</th><th className="n">Sale Amount</th></tr></thead>
            <tbody>{bd.byMarketplace.map(m=><tr key={m.marketplace}>
              <td><Mkt name={m.marketplace}/></td><td className="n">{m.qty}</td><td className="n"><Money n={m.stockCost}/></td><td className="n"><Money n={m.sales}/></td>
            </tr>)}</tbody></table></div>
          : <div className="empty">No sales for this agent yet.</div>}
      </div>

      <div className="detail-sec">
        <h3 className="sub-h">Product-wise Breakdown</h3>
        {bd.byProduct.length
          ? <div className="table-wrap"><table className="table-dense"><thead><tr><th>Product</th><th>Warehouse Product Code</th><th>Marketplace</th><th className="n">Qty Sold</th><th className="n">Unit Cost</th><th className="n">Total Stock Cost</th><th className="n">Sale Amount</th></tr></thead>
            <tbody>{bd.byProduct.map(g=><tr key={g.productId+"|"+g.marketplace}>
              <td className="strong">{g.productName}</td><td><span className="code">{g.code}</span></td><td><Mkt name={g.marketplace}/></td><td className="n">{g.qty}</td><td className="n"><Money n={g.unitCost}/></td><td className="n"><Money n={g.stockCost}/></td><td className="n"><Money n={g.sales}/></td>
            </tr>)}</tbody></table></div>
          : <div className="empty">No sales for this agent yet.</div>}
        {bd.refundCount > 0 && <p className="note">This agent has {bd.refundCount} refund{bd.refundCount===1?"":"s"}. A refunded sale's Qty Sold and Sale Amount above are not counted; its Total Stock Cost is
          reduced by the FULL sale amount (not just its cost), the same rule used everywhere else in SellQuanta - so a row can show a small negative amount. The totals above still add up exactly to Total Stock Cost Due.</p>}
      </div>

      <div className="detail-sec">
        <h3 className="sub-h">Payment / Settlement History</h3>
        {(() => { const hist = paymentHistory(state, viewAgent.id); return hist.length
          ? <div className="table-wrap"><table className="table-dense" id="payment-history"><thead><tr><th>Date &amp; Time</th><th>Type</th><th className="n">Amount</th><th>Note</th></tr></thead>
            <tbody>{hist.map(h=><tr key={h.id}>
              <td className="nowrap">{localDateTime(h.at, h.date)}</td><td><span className="badge tag">{h.type}</span>{h.archived && <span className="sub"> (month closed)</span>}</td><td className="n">{h.amount === null ? "—" : <Money n={h.amount}/>}</td><td className="sub wrap">{h.note}{h.type === "Wallet Reset" && typeof h.balanceBefore === "number" ? ` (balance before reset ${money(Math.max(0, h.balanceBefore))})` : ""}</td>
            </tr>)}</tbody></table></div>
          : <div className="empty">No payments or wallet resets for this agent yet.</div>; })()}
      </div>
    </Card>}

    <Card className="flush">
      <div className="ph"><h3>Ledger</h3><span className="meta">Latest 200 entries, newest first</span></div>
      <div className="table-wrap"><table className="table-dense"><thead><tr><th>Date</th><th>Agent</th><th>Type</th><th className="n">Amount</th><th>Note</th></tr></thead>
      <tbody>{[...state.ledger].reverse().slice(0,200).map(l=><tr key={l.id}>
        <td className="nowrap">{l.date}</td><td className="strong">{state.agents.find(a=>a.id===l.agentId)?.name}</td><td><span className="badge tag">{ledgerTypeLabel(l)}</span></td><td className="n"><Money n={l.amount}/></td><td className="sub wrap">{l.note}</td>
      </tr>)}</tbody></table></div>
    </Card>
  </>;
}

// Refunds: only sales still inside the 10-day window that have not been refunded. The server enforces the same rules.
function Refunds({ state, reload, notify }) {
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState("");
  const q = search.trim().toLowerCase();
  const eligible = refundableSales(state).filter(s => !q || String(s.orderId || "").toLowerCase().includes(q));
  const agentName = s => s.agentName || state.agents.find(a => a.id === s.agentId)?.name || "—";
  const companyName = s => s.companyName || state.companies.find(c => c.id === (s.companyId || state.agents.find(a => a.id === s.agentId)?.companyId))?.name || "—";
  const history = [...(state.refunds || [])].reverse();
  const dayOf = iso => saleDay({ createdAt: iso });

  const refund = async s => {
    if (!window.confirm(`Refund order ${s.orderId || s.id}?\n\n${s.productName} × ${s.qty} · ${money(s.saleAmount)}\n\nThe quantity goes back to the warehouse and the agent's Sales Due is reduced. A sale can be refunded only once.`)) return;
    setBusyId(s.id);
    try {
      await api.refundSale(s.id);
      await reload();
      notify(`Refund recorded for ${s.orderId || "the sale"}: ${money(s.saleAmount)}, stock returned.`);
    } catch(e) { notify(e.message); }
    finally { setBusyId(""); }
  };

  return <>
    <Card className="flush">
      <div className="ph"><h3>Refund</h3>
        <div className="acts"><input style={{width:240,height:32}} aria-label="Search Order ID" placeholder="Search Order ID" value={search} onChange={e=>setSearch(e.target.value)} /></div>
      </div>
      <p className="panel-note">Sales from the last {REFUND_DAYS} days that have not been refunded. Older sales stay in Sales History but can no longer be refunded.</p>
      <div className="table-wrap"><table><thead><tr><th>Sale Date</th><th>Order ID</th><th>Company</th><th>Agent</th><th>Marketplace</th><th>Product</th><th className="n">Qty</th><th className="n">Sale Amount</th><th></th></tr></thead>
      <tbody>{eligible.length ? eligible.map(s => <tr key={s.id}>
        <td className="nowrap">{saleLocalDay(s)}</td><td>{s.orderId ? <span className="code">{s.orderId}</span> : "—"}</td><td className="sub">{companyName(s)}</td><td>{agentName(s)}</td><td><Mkt name={s.marketplace}/></td>
        <td className="wrap">{s.productName}</td><td className="n">{s.qty}</td><td className="n"><Money n={s.saleAmount}/></td>
        <td className="actions"><button className="danger sm" disabled={busyId === s.id} onClick={()=>refund(s)}><Icon name="refund" size={13}/>Refund</button></td>
      </tr>) : <EmptyRow colSpan="9">{q ? "No refundable sale matches that Order ID." : "No refundable sales in the last 10 days."}</EmptyRow>}</tbody></table></div>
    </Card>

    <Card className="flush">
      <div className="ph"><h3>Refund History</h3><span className="meta">{history.length} refund{history.length === 1 ? "" : "s"} · newest first</span></div>
      <div className="table-wrap"><table className="table-dense"><thead><tr><th>Refund Date</th><th>Original Sale Date</th><th>Original Sale ID</th><th>Order ID</th><th>Company</th><th>Agent</th><th>Marketplace</th><th>Marketplace SKU</th><th>Warehouse Product Code</th><th>Product Name</th><th className="n">Qty</th><th className="n">Refund Amount</th><th>Refund ID</th></tr></thead>
      <tbody>{history.length ? history.map(r => <tr key={r.id}>
        <td className="nowrap">{r.refundDate || dayOf(r.refundedAt)}</td><td className="nowrap">{r.saleDate}</td><td title={r.saleId}><span className="code">{r.saleId.slice(0, 13)}…</span></td><td>{r.orderId ? <span className="code">{r.orderId}</span> : "—"}</td><td className="sub">{r.companyName || "—"}</td><td>{r.agentName || "—"}</td>
        <td><Mkt name={r.marketplace}/></td><td className="wrap">{r.marketplaceSku ? <span className="code">{r.marketplaceSku}</span> : "—"}</td><td><span className="code">{r.warehouseProductCode}</span></td><td className="wrap">{r.productName}</td><td className="n">{r.qty}</td><td className="n"><Money n={r.refundAmount}/></td><td title={r.id}><span className="badge arch">Refunded</span> <span className="code muted">{r.id.slice(0, 15)}…</span></td>
      </tr>) : <EmptyRow colSpan="13">No refunds yet.</EmptyRow>}</tbody></table></div>
    </Card>
  </>;
}

function CloseDay({ state, reload, notify, busy, setBusy, onBusinessReset }) {
  const qty = state.todaySales.reduce((a,s)=>a+Number(s.qty||0),0);
  const amount = state.todaySales.reduce((a,s)=>a+Number(s.saleAmount||0),0);

  const close = async () => {
    if (!window.confirm("Export today's Excel and clear ONLY the Daily Sales screen? Warehouse, agents, ledger and history will stay saved.")) return false;
    setBusy(true);
    try {
      const {blob,name} = await api.closeDay();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=name; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      await reload();
      notify("Day closed. Excel saved. Daily Sales reset only.");
    } catch(e){notify(e.message); throw e;}
    finally{setBusy(false);}
  };

  return <>
  <Card className="flush close-card">
    <div className="close-grid">
      <section>
        <div className="close-title"><span className="big-icon"><Icon name="sheet" size={18}/></span><h2>Close Today's Sales</h2></div>
        <p>Creates Excel with Daily Sales, Agent Summary, Product Usage and current Warehouse Stock.</p>
        <div className="close-stats"><span><b>{state.todaySales.length}</b> orders</span><span><b>{qty}</b> quantity</span><span><b><Money n={amount}/></b> sales</span></div>
        <DownloadButton action={close} label="Export Excel + Reset Daily Sales" busyLabel="Closing…" className="primary big" iconSize={16} disabled={busy || !state.todaySales.length}/>
        {!busy && !state.todaySales.length && <p className="disabled-why">No sales to close today.</p>}
      </section>
      <section>
        <h3 className="sub-h" style={{padding:"0 0 10px"}}>What happens</h3>
        <ul className="close-list">
          <li><Icon name="sheet" size={15}/><span>An Excel file is exported for today.</span></li>
          <li><Icon name="refund" size={15}/><span>Only the Daily Sales screen is cleared.</span></li>
        </ul>
        <div className="safe-note"><Icon name="shield" size={15}/><span>Permanent data stays safe: warehouse stock, products, agents, accounts, wallet ledger, stock movements and archived sales.</span></div>
      </section>
    </div>
  </Card>
  <MonthCloseCard state={state} reload={reload} notify={notify} />
  <BackupCard notify={notify} />
  <CompleteReset onComplete={onBusinessReset} />
  </>;
}

// Archives the ENTIRE currently active Sales + Wallet period (today's sales, all of Sales History, and every SALE /
// PAYMENT ledger entry) into a permanent, read-only snapshot, then resets those so the next month starts fresh -
// including releasing old Order IDs from duplicate detection. See server /api/month-close for exactly what is, and
// is not, touched. Warehouse, Product Master, agents/accounts/companies, refunds and stock are never touched here.
function MonthCloseCard({ state, reload, notify }) {
  const [busy, setBusy] = useState(false);
  const [archives, setArchives] = useState(null);
  const [open, setOpen] = useState(false);

  const load = () => api.monthCloseList().then(r => setArchives(r.archives)).catch(() => {});
  useEffect(() => { load(); }, []);

  const activeSales = state.todaySales.length + state.salesHistory.length;
  const activeQty = [...state.todaySales, ...state.salesHistory].reduce((t, s) => t + Number(s.qty || 0), 0);
  const activeAmount = [...state.todaySales, ...state.salesHistory].reduce((t, s) => t + Number(s.saleAmount || 0), 0);

  const closeMonth = async () => {
    const question = `Close Month?\n\n`
      + `This will archive ${activeSales} active sale(s) (${money(activeAmount)}, ${activeQty} unit(s)) and the agent wallet's Sales/Payment entries into a permanent, read-only record.\n\n`
      + `After that:\n`
      + `• Daily Sales and Sales History are emptied - old Order IDs become free to scan/add again.\n`
      + `• Every agent's Sales Due / Paid / Balance restarts from ₹0.\n\n`
      + `Warehouse stock, Product Master, agents, accounts, companies and refunds are NOT changed. Archived sales stay permanently visible below, read-only.\n\n`
      + `This cannot be undone from the app. Continue?`;
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      const r = await api.monthClose();
      await reload();
      await load();
      notify(`Month closed: ${r.salesArchived} sale(s) archived. Sales and Wallet are reset for the new active period.`);
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  return <Card className="flush">
    <div className="ph"><h3>Month Close</h3>
      <div className="acts"><button className="ghost" disabled={busy || !activeSales} onClick={closeMonth}><Icon name="archive" size={15}/>{busy ? "Closing…" : "Close Month"}</button></div>
    </div>
    <div className="pb">
      <p className="muted" style={{margin:"0 0 6px",lineHeight:1.55}}>Archives the current active Sales and Agent Wallet period permanently, then starts the next month fresh. Use this occasionally (e.g. once a month) - Daily "Export Excel + Reset Daily Sales" above stays for everyday use and does not touch the wallet.</p>
      {activeSales > 0 && <p className="kv-line" style={{margin:0}}><span>Currently active: <b>{activeSales}</b> sale(s) · <b>{activeQty}</b> unit(s) · <b>{money(activeAmount)}</b></span></p>}
      {archives && archives.length > 0 && <div style={{marginTop:12}}>
        <button className="quiet sm" onClick={()=>setOpen(o=>!o)}><Icon name="chevron" size={13} className={open ? "rot90" : ""}/>{open ? "Hide" : "Show"} closed months ({archives.length})</button>
      </div>}
    </div>
    {archives && archives.length > 0 && open && <div className="table-wrap" style={{borderTop:"1px solid var(--line)"}}><table className="table-dense"><thead><tr><th>Closed</th><th className="n">Sales</th><th className="n">Agents</th><th className="n">Total Due</th><th className="n">Total Paid</th><th className="n">Balance</th></tr></thead>
      <tbody>{archives.map(a=>{
        const totals = a.agentSummary.reduce((t,x)=>({due:t.due+x.due,paid:t.paid+x.paid,balance:t.balance+x.balance}),{due:0,paid:0,balance:0});
        return <tr key={a.id} className="is-archived">
          <td className="nowrap">{new Date(a.closedAt).toLocaleString("en-IN")}</td>
          <td className="n">{a.salesCount}</td>
          <td className="n">{a.agentSummary.length}</td>
          <td className="n"><Money n={totals.due}/></td>
          <td className="n"><Money n={totals.paid}/></td>
          <td className="n"><Money n={totals.balance}/></td>
        </tr>;
      })}</tbody></table></div>}
  </Card>;
}

// Data safety: shows the automatic daily backups and lets you take an extra backup right now.
function BackupCard({ notify }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.backupInfo().then(setInfo).catch(() => {});
  useEffect(() => { load(); }, []);

  const backupNow = async () => {
    setBusy(true);
    try { const r = await api.backupNow(); notify(`Backup saved: ${r.file}`); await load(); }
    catch(e) { notify(e.message); }
    finally { setBusy(false); }
  };

  return <Card className="flush">
    <div className="ph"><h3>Data Backup</h3>
      <div className="acts"><button className="ghost" disabled={busy} onClick={backupNow}><Icon name="shield" size={15}/>{busy ? "Backing up…" : "Back Up Now"}</button></div>
    </div>
    <div className="pb">
      <p className="muted" style={{margin:"0 0 6px",lineHeight:1.55}}>SellQuanta saves one backup per day automatically in the <b>backups</b> folder and keeps the latest {info?.keepDays ?? 30} days. Everything you enter is stored on this computer only.</p>
      {info && <p className="kv-line" style={{margin:0}}><span>Automatic backups kept: <b>{info.dailyCount}</b></span>{info.newestDaily ? <span>latest: <b>{info.newestDaily}</b></span> : null}<span>Manual backups: <b>{info.manualCount}</b> (in backups/manual)</span></p>}
    </div>
  </Card>;
}
