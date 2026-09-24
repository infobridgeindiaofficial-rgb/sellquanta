import React, { useEffect, useMemo, useRef, useState } from "react";
import { fullySavedSourceFiles, unselectSourceFiles } from "./savedLabelSelection";
import { fileToPdfPages } from "./pdf";
import { detectMarketplace, detectDate, formatDisplayDate, extractOrderIdentifier } from "./labelDetectors";
import { Icon } from "./icons";

// Runs `fn` over `items` with at most `limit` running at once - keeps 40+ PDF text extractions from freezing the UI
// or opening dozens of pdf.js workers at the same time, without needing a queue library.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const MARKETPLACE_ORDER = ["Amazon", "Flipkart", "Meesho", "Needs Review"];
const norm = v => String(v || "").trim().toLowerCase();

// Segregation only: fast local PDF text (already used by the real scanner via fileToPdfPages) + the deterministic
// rules in labelDetectors.js. No Ollama call, no network call - a file that isn't a PDF (an image label) cannot be
// classified this way and lands in Needs Review, exactly like a PDF whose text doesn't confidently match anything.
async function segregateFile(file) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return { marketplace: null, dateIso: null, orderId: null, label: file.name };
  try {
    const pages = await fileToPdfPages(file);
    const text = pages.map(p => p.lines.join(" ")).join(" \n ");
    const marketplace = detectMarketplace(text).marketplace;
    const dateIso = detectDate(text).date;
    const orderId = marketplace ? extractOrderIdentifier(text, marketplace) : null;
    return { marketplace, dateIso, orderId, label: orderId ? `Order ID ${orderId}` : file.name };
  } catch (e) {
    return { marketplace: null, dateIso: null, orderId: null, label: file.name, error: e.message };
  }
}

// Compact "folder" view of uploaded shipping labels: Date -> Marketplace -> individual labels, collapsed by default,
// so 40-100 files stay a short page instead of a long raw filename list. Purely a selection layer: it never touches
// stockpilot.json, stock, sales, Product Master or agent balances - it only decides WHICH original File objects get
// handed to the existing scanner when "Scan Selected" is clicked.
export default function LabelSegregator({ files, scanning, onScanSelected, onClear, savedOrders, scanRows }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const previouslySavedFiles=useRef(new Set());

  useEffect(()=>{
    const savedFiles=fullySavedSourceFiles(scanRows);
    const newlySaved=new Set([...savedFiles].filter(file=>!previouslySavedFiles.current.has(file)));
    previouslySavedFiles.current=savedFiles;
    // Consume each confirmed save once; explicit later reselection remains possible.
    if (newlySaved.size) setSelected(s=>unselectSourceFiles(s,rows,newlySaved));
  },[scanRows,rows]);

  useEffect(() => {
    let cancelled = false;
    setSelected(new Set());
    if (!files.length) { setRows([]); return; }
    setBusy(true);
    mapLimit(files, 4, segregateFile).then(results => {
      if (cancelled) return;
      setRows(results.map((r, i) => ({ id: i, file: files[i], ...r })));
      setBusy(false);
    });
    return () => { cancelled = true; };
  }, [files]);

  const groups = useMemo(() => {
    const byDate = new Map();
    for (const r of rows) {
      const dateKey = r.dateIso || "\u0000needs-review";
      if (!byDate.has(dateKey)) byDate.set(dateKey, new Map());
      const byMp = byDate.get(dateKey);
      const mpKey = r.marketplace || "Needs Review";
      if (!byMp.has(mpKey)) byMp.set(mpKey, []);
      byMp.get(mpKey).push(r);
    }
    const dateKeys = [...byDate.keys()].sort((a, b) => {
      if (a === "\u0000needs-review") return 1;
      if (b === "\u0000needs-review") return -1;
      return b.localeCompare(a); // newest first
    });
    return dateKeys.map(dateKey => {
      const byMp = byDate.get(dateKey);
      const marketplaces = MARKETPLACE_ORDER.filter(m => byMp.has(m)).map(m => ({ marketplace: m, items: byMp.get(m) }));
      const total = marketplaces.reduce((t, m) => t + m.items.length, 0);
      return { dateKey, dateIso: dateKey === "\u0000needs-review" ? null : dateKey, total, marketplaces };
    });
  }, [rows]);

  const toggle = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = ids => setSelected(s => { const n = new Set(s); ids.forEach(id => n.add(id)); return n; });
  const stop = e => e.stopPropagation();

  const selectedFiles = rows.filter(r => selected.has(r.id)).map(r => r.file);

  return <div className="segr">
    <div className="segr-head">
      <Icon name="inbox" size={15}/>
      <b>Shipping Labels</b>
      <span className="muted">{busy ? "Reading labels…" : `${files.length} Label${files.length === 1 ? "" : "s"}`}</span>
    </div>

    <div className="tree">
    {!busy && groups.map(g => {
      const dateIds = g.marketplaces.flatMap(m => m.items.map(i => i.id));
      return <details key={g.dateKey}>
        <summary>
          <Icon name="chevron" size={14} className="chev"/>
          <Icon name={g.dateIso ? "folder" : "help"} size={15} className="fi"/>
          <span className="date-name">{g.dateIso ? formatDisplayDate(g.dateIso) : "Needs Review"}</span>
          <span className={`cnt ${g.dateIso ? "" : "warn"}`}>{g.total}</span>
          <button className="quiet sm" onClick={e=>{stop(e); selectAll(dateIds);}}>Select All</button>
        </summary>
        <div className="lvl2">
          {g.marketplaces.map(m => {
            const ids = m.items.map(i => i.id);
            return <details key={m.marketplace}>
              <summary>
                <Icon name="chevron" size={14} className="chev"/>
                {m.marketplace === "Needs Review"
                  ? <><Icon name="help" size={15} className="fi"/><span>{m.marketplace}</span></>
                  : <span className={`mkt ${m.marketplace.toLowerCase()}`}>{m.marketplace}</span>}
                <span className={`cnt ${m.marketplace === "Needs Review" ? "warn" : ""}`}>{m.items.length}</span>
                <button className="quiet sm" onClick={e=>{stop(e); selectAll(ids);}}>Select All</button>
              </summary>
              <div className="files">
                {m.items.map(item => {
                  const added = item.orderId && savedOrders.has(norm(item.orderId));
                  return <label key={item.id} className="f">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggle(item.id)} />
                    <span className="fname code">{item.label}</span>
                    {added && <span className="added"><Icon name="check" size={12} strokeWidth={2.4}/>Added</span>}
                  </label>;
                })}
              </div>
            </details>;
          })}
        </div>
      </details>;
    })}
    </div>

    <div className="segr-foot">
      <span className="sel-c">Selected: {selected.size} label{selected.size === 1 ? "" : "s"}</span>
      <div className="acts">
        <button className="ghost sm" disabled={scanning} onClick={onClear}>Clear Files</button>
        <button className="sm" disabled={scanning || busy || selected.size === 0} onClick={()=>onScanSelected(selectedFiles)}>Scan Selected ({selected.size})</button>
      </div>
    </div>
  </div>;
}
