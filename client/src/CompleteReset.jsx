import React, { useRef, useState } from "react";
import { api } from "./api";

export default function CompleteReset({ onComplete }) {
  const [phase, setPhase] = useState("closed");
  const [confirmation, setConfirmation] = useState("");
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const cancel = () => { setPhase("closed"); setConfirmation(""); setPrepared(null); setError(""); };
  const prepare = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      setPrepared(await api.prepareBusinessReset());
      setConfirmation(""); setPhase("confirm");
    } catch (e) { setError(e.message); }
    finally { pending.current = false; setBusy(false); }
  };
  const reset = async () => {
    if (pending.current || !prepared || confirmation !== "RESET") return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await api.completeBusinessReset(prepared.token, confirmation);
      cancel();
      onComplete(result);
    } catch (e) {
      setPrepared(null); setConfirmation(""); setPhase("review");
      setError(`Could not confirm the reset result: ${e.message}. If the connection was interrupted, refresh SellQuanta before retrying.`);
    } finally { pending.current = false; setBusy(false); }
  };
  return <details className="card">
    <summary className="strong">Danger Zone</summary>
    <h3>Complete Reset / Start New Business</h3>
    <p className="muted">Removes all current business data and returns SellQuanta to first-time setup. This cannot be undone without a backup.</p>
    {phase === "closed" && <button className="danger" onClick={() => { setError(""); setPhase("review"); }}>Complete Reset</button>}
    {phase === "review" && <section role="dialog" aria-label="Review Complete Reset">
      <h3>Step 1: Review what will be removed</h3>
      <p>All companies (including archived companies), agents and marketplace accounts, warehouse products and images, stock history, Product Master mappings, sales and order IDs, wallet transactions, refunds, Month Close archives, correction/undo history and business settings will be removed from the active database.</p>
      <p>A full JSON backup must be written and verified before anything is reset. Existing safety backups and saved Excel reports are kept as inactive files. SellQuanta's features remain available.</p>
      <div className="inline">
        <button className="ghost" disabled={busy} onClick={cancel}>Cancel</button>
        <button className="danger" disabled={busy} onClick={prepare}>{busy ? "Preparing confirmation…" : "Continue to Confirmation"}</button>
      </div>
    </section>}
    {phase === "confirm" && <section role="dialog" aria-label="Confirm Complete Reset">
      <h3>Step 2: Confirm permanent removal</h3>
      <p>The current business will be replaced with an empty database. A verified full backup will be preserved under <code>backups/business-reset/</code>.</p>
      <p className="muted">{prepared.counts.companies || 0} companies · {prepared.counts.products || 0} warehouse products · {prepared.counts.productMaster || 0} mappings · {(prepared.counts.todaySales || 0) + (prepared.counts.salesHistory || 0)} active/history sales</p>
      <label>Type RESET to confirm<input aria-label="Type RESET to confirm" value={confirmation} disabled={busy} autoComplete="off" spellCheck={false} onChange={e => setConfirmation(e.target.value)} /></label>
      <div className="inline" style={{marginTop:12}}>
        <button className="ghost" disabled={busy} onClick={cancel}>Cancel</button>
        <button className="danger" disabled={busy || confirmation !== "RESET"} onClick={reset}>{busy ? "Backing up and resetting…" : "Reset Everything & Start New Business"}</button>
      </div>
    </section>}
    {error && <p className="reason" role="alert">{error}</p>}
  </details>;
}
