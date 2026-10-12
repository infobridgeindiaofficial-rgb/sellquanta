# Banking reconciliation

Banking is a separate manual bank-receipt ledger. Nothing is seeded. A new or old
database without Banking arrays displays zeros and an empty settlement history.
The illustrative Flipkart receipt is never saved by code or startup.

## Sales basis and dates

Total Sales uses the existing Reports gross `saleAmount` basis, rounded to INR
cents per sale. Current `todaySales`, `salesHistory` and all `monthCloseArchive`
sales are read through `reportRecords`, which deduplicates sale IDs with current
records taking precedence. Only Amazon, Flipkart and Meesho participate.

All saved sales qualify. The current application has no sales status field or
cancelled/pending sales status filter; Banking does not invent one. Undo removes
its batch from saved sales and therefore from this report. Refunded sales remain
gross sales, exactly as in Reports. Returns, partial refund records and refund
amounts are not subtracted from gross sales or counted as bank receipts. Banking
does not derive a net-sales or profit calculation or alter the refund rules.

Sales use a valid `sale.date`, falling back to UTC `sale.createdAt`. Receipts use
their manually entered `date` (Bank Received Date), not their creation timestamp.
All Time includes historical sales lacking a usable date; finite periods exclude
them and show the count. Dates are inclusive UTC calendar days. Weekly periods
are Monday–Sunday; Monthly supports month/year; custom ranges validate both ends.
Sales and receipts are separately filtered by their own dates: the system does
not allocate a payout to orders or assume same-period receipts settle same-period
sales. The interface and Excel report explain this timing limitation.

Difference is gross recorded sales minus bank received. It is a **reference
reconciliation difference**, not automatically profit, loss or an unpaid amount.
Marketplace fees, shipping, refunds, deductions and timing may explain it.

## Persistence and corrections

Three additive top-level JSON fields are written only after an explicit save:
`bankSettlements`, `bankingAudit`, `bankingRequests`. Existing records are never
restructured. Existing complete-file atomic saves and JSON backups preserve these
fields; older databases continue to work through empty-array fallbacks. No schema
version bump, new database, startup migration or automatic write is needed.

Amounts are positive integer cents with at most two entered decimal places,
limited to INR 9,999,999,999.99. Marketplace and real calendar dates are validated.
Optional references allow letters/numbers, spaces and `._/#:-` (200 characters);
notes allow plain text up to 2000 characters. Unsafe monetary totals fail visibly.

Each submission has an idempotency key and a payload fingerprint; replaying the
same request does not save again. Same-marketplace UTR/reference duplicates are
rejected ignoring letter case. Without a reference, identical marketplace/date/
amount receipts are rejected. Different references allow multiple same-day
receipts, including the same amount. For genuinely distinct identical receipts,
enter their actual unique bank references rather than guessing a reference.

Edits and deletion require UI confirmation and `confirm: true` in the API, plus
the current record version. Stale corrections return 409 rather than overwrite
another correction. Delete is a tombstone, excluded from receipt totals; before/
after snapshots and timestamps remain in the append-only audit trail. The audit
does not claim authenticated operator identity (the local app has no operator
login). Reusing a deleted reference for a corrected entry is allowed; the original
remains in audit history. No business sales, stock, purchase or wallet entries are
changed by any Banking operation.

## API and Excel

- `GET /api/banking`: summary and history, default All Time.
- `POST /api/banking/settlements`: record a receipt.
- `PUT /api/banking/settlements/:id`: confirmed correction.
- `DELETE /api/banking/settlements/:id`: confirmed soft deletion.
- `GET /api/banking/audit`: correction history.
- `GET /api/banking/export`: branded three-sheet Excel workbook.

Search and marketplace selection filter Settlement History only; dashboard and
marketplace cards remain combined for the selected period. The period filter
applies to both. Export mirrors this behavior and labels a filtered history.
Worksheets: Banking Summary, Marketplace Breakdown, Settlement History. Shared
`server/excelStyle.mjs` supplies the approved green/charcoal design, literal
references, numeric INR cells, filters, frozen headers, totals and branding.
No dependencies or business calculation code were changed.

## Validation

`tools/banking.test.mjs` uses only synthetic fixtures and an isolated HTTP server.
It covers all marketplaces, multiple receipts, gross refunded sales, archived
deduplication, UTC boundaries, invalid inputs, duplicates, request replay, stale
edits, confirmed deletion, audit snapshots, atomic save failure, restart, JSON
backup preservation, empty states and the three branded worksheets. Every
existing financial collection is compared before/after mutations. Production
database bytes are checked unchanged by testing.
