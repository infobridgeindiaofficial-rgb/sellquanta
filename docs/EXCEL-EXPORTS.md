# SellQuanta branded Excel exports

All Excel HTTP downloads use `server/excelStyle.mjs::writeBrandedWorkbook`.
Existing SheetJS builders and financial report calculations remain authoritative.
ExcelJS 4.4 writes presentation only and loads lazily when an export is requested.
The database, backups and existing exports are never changed by this utility.

Every worksheet has Calibri typography, charcoal branding, green headers,
white/light-green row banding, INR numeric formats, fitted column widths,
borders, a row-6 filter and frozen first six rows, totals and a branded print footer.
Rows 1-5 hold brand, report/sheet name, period, UTC generation timestamp and summary.
Table headers are on row 6; actual records start on row 7. Filter ranges exclude
totals and footer cells, including when no records exist. Identifiers and literal
strings beginning with `=` stay strings. No business formulas are introduced.

Report summary totals come from existing `report.totals`, including distinct order
counts; summing product-level order counts would double-count multi-product orders.
Warehouse and master exports represent all saved records/current snapshots.
Purchase history and Reports show the selected inclusive UTC reporting period.

## Import templates

Purchase, Warehouse and Product Master templates use the same row-6 headers, with
no totals/footer cells below the input table. The print footer remains branded.
Users enter data from row 7. `importHeaderRow` recognizes the explicit SellQuanta
template preamble; legacy row-1 templates continue to work. Original column names
and sheet names are unchanged. Formula rejection and the 2000 purchase-row limit
remain in force, and validation errors refer to actual Excel row numbers.

## Future downloads

Build typed records with existing business logic, then call the shared writer.
Pass `reportName`, `period`, `summary` and authoritative `totalsBySheet` where
applicable, or `template: true` for a parser-compatible input template.
Do not write downloadable Excel files directly with `XLSX.write`.

## Verification

`tools/excel-branding.test.mjs` reopens generated OOXML using ExcelJS and SheetJS,
checks all five Sales & Returns sheets, empty periods, literal identifiers,
currency/bands/freeze panes/filters/footers, distinct-order totals, every export
route and all five reporting periods. It round-trips branded and legacy purchase
templates with 400 rows, checks formula rejection and read-only template previews.
Existing HTTP tests independently reconcile export records against isolated data.

## Final export audit (12 October 2026)

| Download route | Worksheets / coverage |
| --- | --- |
| `GET /api/reports/export` | Sales, Returns, Marketplace Summary, Agent Summary, Product Summary; daily, weekly, monthly, yearly and custom periods |
| `GET /api/purchases/history-export` | Purchase History; all five period modes |
| `GET /api/purchases/import-template` | Purchases; original nine required columns |
| `POST /api/purchases/error-report` | Errors; original purchase columns plus Excel Row and Error |
| `GET /api/products/export-backup` | WAREHOUSE; original saved data columns |
| `GET /api/products/import-template` | WAREHOUSE; original import columns |
| `GET /api/product-master/export-backup` | AMAZON, FLIPKART, MEESHO; original mapping data columns |
| `GET /api/product-master/template` | PRODUCT_MASTER; each of the three marketplace scopes |

No other active XLSX download was found in the server, frontend API client or
Electron code. Historical files already stored in exports/backups are not rewritten.
Database recovery backups are JSON copies made by `store.mjs`; their format and
contents are unchanged. XLSX stock/master backups are export-only inventories,
not database restoration files.

The final audit fixes missing awaits for Product Master backup and Purchase History
downloads so writer failures return JSON through existing route handlers and leave
the backend healthy. It adds explicit template/backup/error-report titles, bold
summary rows and a two-line title height. Business data builders remain unchanged.

Six focused tests cover every route, 18 sample workbooks / 40 worksheets, legacy
and branded template parsing, 400-row purchase uploads, empty periods and simulated
writer failures. All 18 audit samples opened in Microsoft Excel 2010 without a
repair prompt; native views confirm branding, headers, filters, INR amounts and
the read-only backup/template layouts. The approved populated five-sheet example
was also visually verified earlier in Excel 2010.

Dependencies: this feature branch is based on Purchase Management (PR #3), which
is based on Reports (PR #2) and Agent Wallet date filters (PR #1). No merge or
release is part of this audit.
