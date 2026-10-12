# Sales & Returns Reports

Reports replaces the closing page. It never closes days/months or changes saved transactions. The existing Data Backup card and Danger Zone remain last, unchanged.

Daily uses the chosen UTC date; Weekly uses Monday–Sunday around the chosen date. Monthly and Yearly use full calendar periods. Custom ranges include both endpoints. Saved dates take precedence; legacy timestamps fall back to UTC.

Total Sales and Units Sold are gross sale amounts/units. Orders group order lines by account (or agent), marketplace, date and order ID. Returns Count counts saved refund records; Returned Units is shown separately. Return Amount sums refundAmount; Net Sales = Total Sales − Return Amount. Refunds count on refundDate, including refunds for earlier-period sales. Negative period net sales are valid. No refund is inferred again from a ledger reversal or sale status. Undone/cancelled sales that the existing workflow removed do not count. Only actual saved refund/partial-return records count; no records are invented.

Live sales, daily salesHistory and prior monthCloseArchive.sales are combined by record ID. Live copies take precedence. Saved refund records are similarly deduplicated. Unknown marketplace rows appear as extra rows so totals still reconcile. Records without any usable date are excluded with a visible warning.

Excel export is GET /api/reports/export with mode/date/month/year/from/to parameters. It generates five worksheets in memory: Sales, Returns, Marketplace Summary, Agent Summary, Product Summary. It performs no database writes and creates no export files on the PC. Existing backups/exports remain untouched. Removed POST /api/close-day and POST /api/month-close return 404; existing archived data is retained in the schema. Agent wallet resets and business-reset safety APIs remain unchanged.

Tests: tools/reports.test.mjs, reports-http.test.mjs, reports-ui.test.mjs, download-feedback-ui.test.mjs plus the existing wallet/backup/reset suites. Component tests use the existing jsdom development dependency.
