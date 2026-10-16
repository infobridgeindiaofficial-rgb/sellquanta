# Reconciliation feature checklist — before ports

Base: published v1.1.1, commit 76b6b49487247e1d726050da61d6613e6e4ea591.
Original main checkout remains untouched. This worktree is reconcile/v1.1.1-safety.
Version stays 1.1.1; no publish, push, tag, merge or installation is authorized.

## Gate 1: retain released features

| Released feature | Required disposition |
|---|---|
| Settings + updater + preload/IPC | Keep; retain origin checks, consent and update event handling |
| Signed metadata, installer integrity, pre-update backup | Keep trust key and verification; retain backup/install ordering |
| Optional local AI | Keep consent-based Ollama startup; never restore automatic startup |
| Transactional purchases | Keep suppliers, invoices/lines, purchase returns, idempotency and stock effects |
| Read-only Warehouse | Keep purchase-driven inventory controls |
| Banking ledger/reconciliation | Keep v1.1.1 endpoints, reversal/audit logic and calculations |
| Sales & Returns reports | Keep v1.1.1 reports and multi-sheet branded exports |
| Wallet period filters | Keep v1.1.1 walletPeriod and cumulative/date scope labels |
| Excel branding | Keep excelStyle/ExcelJS and released export behavior |
| Installer/release safeguards | Preserve identity, retained AppData, signature policy and workflow |

## Gate 2: reviewed safety fixes first

| Fix | Port approach |
|---|---|
| Verified manual backup, absolute path, size/hash | Adapt store functions; preserve raw JSON, optional/unknown fields, no source writes |
| Backup copy/download and Save dialog | Add read-only endpoint/UI without replacing released Reports; add only scoped Electron download behavior |
| Data/path validation | Preserve root resolution and import semantics; fail closed for malformed data; synthetic-only restore tests |
| Taskbar identity/icons | Explicit packaged AppUserModel details; no changes to existing desktop shortcuts or installed application |
| Packaging/runtime closure | Derive graph from reconciled server imports; do not copy old 12-module whitelist |

## Gate 3: current-main-only features — conditional ports

| Current-main feature | Compatibility gate |
|---|---|
| Master Chart and 13-sheet export | Read-only integration; retain released financial/report definitions; reconcile selectors before enabling |
| Product-wise Return Analysis | Read-only; keep classification/date semantics; no change to released summaries |
| Manual Sale Date | New manual entries only; central date readers must preserve legacy/report UTC semantics |
| Financial snapshots | Capture new entries, never backfill live data; preserve released purchase/banking/refund formulas |
| Bank statement scanner | Additive UI/routes to released Banking; adapt import persistence/audit and duplicate rules, do not replace ledger |
| Return Charges Ledger | Evaluate separately as financial data source; no implicit changes to settlement/profit |
| Current Dashboard additions | Evaluate independently; never replace released Dashboard wholesale |

No blanket file replacement, merge or cherry-pick. Each compatibility gate needs focused tests plus baseline-suite validation. Unproven ports remain blocked rather than enabled with different business semantics.

## Verification required

Baseline tests; safety regressions; full final suite; frontend build; runtime dependency closure; packaged EXE backend on synthetic data; backup/restore/restart; updater trust and data backup; native shell configuration tests. Actual installer execution and GUI taskbar verification remain separate from automated configuration evidence and are not authorized here.

## Port results and compatibility findings

- Released baseline: 145/145 tests passed before ports.
- Safety fixes ported in place in store/index, released BackupCard and Electron shell; no replacement of updater/preload/Settings. Packaging remains the v1.1.1 file configuration; the reconciled backend still imports no client source.
- Product-wise Return Analysis ported read-only at the end of released Dashboard, controlled by the existing monthly filter. Unknown legacy refund classifications remain Unclassified. No Return Charges transaction module was added.
- Manual Sale Date ported for new manual entries only. Saved Sales now exposes the actual date. Released report/banking readers already prefer saved date; Dashboard adds precedence only for the explicit new manual marker. Old records and scanner selection logic remain unchanged. Main's separate read-only history selector is retained for date regression coverage; the released open-sales list/Undo behavior remains intact.
- Financial snapshots ported as new-sale metadata only. Missing values stay null. Released stock deductions, ledger/refund/payment formulas and report totals are not replaced. Product Master estimate editing and main's full financial calculation system were not ported.
- Master Chart is NOT enabled: its Financial Position uses estimated settlement less receipts and return charges, whereas released Banking uses gross sales less receipts. A synthetic sale of 100, captured estimate 80, receipt 30 and charge 10 produces released difference 70 versus main's estimated due 40. These measures cannot both be labelled the same Banking reconciliation. Main also changes refund cost basis and purchase interpretation. A reviewed financial/metric adapter is required before enabling the chart or its export.
- Statement scanner is NOT enabled: main import/reversal persistence uses different duplicate-key, reversal and bankingRequests/audit semantics. Released Banking supports versioned corrections/deletes and its own idempotency fingerprints. Replacing the released Banking component or importing main's persistence would bypass those guarantees. A scanner-to-released-ledger adapter with atomic batch/idempotency tests is required.
- Neither blocked port was silently substituted or removed from the original checkout. All original work remains there unchanged. Reconciliation is partial and NOT READY until these compatibility gates are resolved.
