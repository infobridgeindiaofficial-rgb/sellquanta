# Banking Phase 3: verified imports and saved history

## Current behavior

The latest user instruction supersedes the earlier global legacy-reconciliation
save gate. The withdrawn Flipkart amount is not a required receipt, inferred
match, seeded record, or condition for enabling imports. Existing receipts remain
untouched. Duplicate and possible-overlap checks still run on every selected row.

The scanner, Ollama advice, marketplace corrections and Exclude behavior are
unchanged. Scan totals remain separate from saved receipt totals. After a
reconciled scan, the user explicitly checks the verification/approval checkbox
and clicks Confirm & Save. Only the currently confirmed Amazon, Flipkart and
Meesho credits are submitted. Excluded, unconfirmed, debit and duplicate rows are
not submitted. Changing a classification or selecting a new file clears approval.
Successful saving refreshes receipt history; source documents are not saved.

Unreconciled extraction cannot be approved for saving. An expired scan must be
scanned again. Current in-memory previews expire after 30 minutes; ten previews
are retained per local server. Refreshing or restarting the server loses only
unsaved previews. Saved receipts, import audit and duplicate keys persist in JSON.

## Authoritative source and duplicate checks

The preview endpoint issues an opaque scan token. The import endpoint accepts
that token, original row ID, selected marketplace, classification source and
explicit approval. It retrieves original transaction fields from its server-held
preview. Client-submitted dates, amounts, narrations or references are rejected.
Ollama suggestions never supply approval. Adopting one requires user confirmation
of the classification followed by verification and Confirm & Save.

Duplicate protection uses normalized reference, transaction date and credit cents,
independent of marketplace corrections. Original account/date/reference/narration
fingerprints are also checked. When references are missing, a conservative
account/narration fallback is used. Same-date/amount legacy entries with an
unusable reference are blocked as possible overlaps rather than assumed distinct.
Repeated selections in one request and repeated statement uploads are skipped.
Previously recorded fingerprints, including retained deleted records, remain
protected. An identical request ID and payload replays its persistent result;
reusing that ID with different selections fails.

## Storage and safety

Imports append to the existing `bankSettlements` collection. No legacy receipt is
deleted, overwritten, linked by guessed equality, or converted into transactions.
Each new receipt preserves narration, reference, value date, credit/debit/balance,
source locations and original transaction cells, hashed account identity,
classification source, import batch and timestamps. No full account header or
original PDF is stored in an imported transaction.

Additive `bankingAudit`, `bankingRequests` and `bankingImportBatches` entries provide
receipt snapshots, immutable import records and request replay protection. There
is no schema migration or version bump. All unrelated collections and metadata
are retained exactly as JSON values. Existing create/audit/request records are
preserved, even if written by older Banking implementations.

A verified byte-exact backup of the real local database was created before
implementing writes at:
`backups/manual/banking-phase3-before-writes-2026-10-14T10-32-37-756Z.json`.
It is excluded from Git. Every actual import also creates and reads back a new
byte-exact backup before committing. Failure to write or verify the backup aborts
the import.

The existing JSON store supports atomic file replacement, not database ACID
transactions. Banking commits synchronously under an exclusive import lock,
checks that the original file is unchanged before replacement, writes and fsyncs
a unique temporary file, verifies it, then renames it atomically. Failures before
replacement leave the original file unchanged. Another process that ignores this
lock is outside the single-server concurrency guarantee; detected concurrent
changes abort instead of being overwritten. A retry after a lost response uses
the same request ID and cannot create duplicate receipts.

Dashboard calculation code is unchanged. Once users intentionally import receipts,
the existing Dashboard reader can naturally include those additional stored
receipts after refresh. It does not receive guessed allocations or changes to
sales, warehouse, Product Master, agent wallets or existing bank receipt records.

## Receipt history

The history table reads actual latest saved receipt records and displays Date,
Marketplace, Bank Reference / UTR, Received Amount, Entry Source and Status. Month
(including All months), Date Range and marketplace filters apply to history and
its separate Amazon/Flipkart/Meesho saved totals. Retained deleted records remain
visible with their status but are excluded from totals. Legacy records without
proof of manual or statement source are honestly labeled Legacy / Unknown.
Imported receipts expose their audit action and timestamp through Audit history.

The earlier read-only evidence-comparison helper does not resolve provenance by
amount alone and does not perform writes. It is not a global blocker in the
latest requested verified-import workflow.

## Validation

- Full default npm suite: 143 tests passed; local frontend build passed. The
  existing large-bundle warning remains.
- Isolated persistence and HTTP tests cover explicit approval, original-field
  tampering, invalid classifications, debit/excluded rejection, duplicate imports,
  request replay, preserved legacy records, stored provenance/audit, verified
  backups, atomic failures, concurrent changes and restart persistence.
- A real React-component/isolated-HTTP test verifies the approval checkbox,
  double-click protection, excluded and unconfirmed rows, successful saving,
  month/range/marketplace history filtering, saved totals and remount persistence.
- Real August and September statements were rechecked through the current local
  API and rendered UI with rule-only verification. No real import was performed:
  Confirm & Save stayed disabled until explicit user approval. The actual database
  remained byte-identical. Earlier local Ollama advice checks remain valid because
  the detection and AI modules were not changed in this phase.
- No visual browser verification was performed. Native/browser automation was
  unavailable. No deployment, GitHub push, production access or private document
  upload was performed.

## Files in this phase

- `server/bankReceiptImport.mjs`: append-only persistence and verified backups.
- `server/bankStatementRoutes.mjs`, `server/index.mjs`: history and authoritative
  preview/import routes, local writer registration.
- `server/bankReconciliation.mjs`: latest saved history and read-only evidence
  comparison, without the withdrawn receipt assumption.
- `client/src/Banking.jsx`, `client/src/bankPreview.js`, `client/src/api.js`:
  verification/save interaction, scan-token metadata, saved history/filter/totals.
- `tools/bank-receipt-import.test.mjs`, `tools/bank-reconciliation.test.mjs`,
  `tools/banking-ui.test.mjs`: persistence, safeguards and UI tests.
- `docs/BANKING_PHASE3.md`: current workflow and verification record.
