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
