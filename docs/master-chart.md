# SellQuanta Master Chart

Master Chart is a read-only business intelligence workspace. The sidebar opens it independently of Dashboard, Banking, Warehouse, Product Master, Agents & Wallet, Refunds, Purchases and Return Charges. No transaction writer, migration, new dependency or installer was added.

## Implemented phases

1. **Data audit, metric definitions, navigation and filters.** The data selector creates new analytical facts from live and archived sales/refunds plus confirmed return charges. Global presets cover Today, Yesterday, Last 7 Days, This Month, Last Month, This Year and custom dates. Marketplace, company, agent and product/SKU filters intersect; Reset Filters restores the current month. Metric tooltips document the calculation basis.
2. **Overview, sales and products.** Fourteen KPIs, equal-length prior-period comparisons when both periods contain sales, daily/weekly/monthly/yearly trends, gross/net and sales/profit comparisons, product rankings, product comparison and current warehouse availability. Zero recorded sales with current stock is explicitly contextualized to the selected period, never a demand forecast.
3. **Marketplace, company, agent and returns.** Entity comparisons, revenue contribution, company/marketplace/product and entity/product/order groupings, current whole-agent wallet obligations and classified return analysis. Unknown ownership stays unattributed. Review records remain visible.
4. **Financial, pivot and visualizations.** A derived financial waterfall, cumulative Banking reconciliation, period purchase totals and a two-level pivot builder with configurable columns/values, sorting, search, collapsible groups, conditional formatting and independently recalculated subtotals/grand totals. Lightweight SVG visuals implement line, area, bar, stacked bar, donut, heatmap, proportional treemap, waterfall, scatter and comparison charts.
5. **Interaction, insights, presentation and Excel.** Chart/table cross-filters, breadcrumb Back, Clear selections (retains date range), transaction drill-down, deterministic supported insights, nine-slide presentation with keyboard navigation and browser fullscreen when available, plus themed 13-sheet Excel export. Export has loading/error states and the workbook includes filters, calculation definitions, pivot settings and review records.

## Data audit and definitions

- **Sales/refunds:** `dashboardRecords` from `server/financialSnapshot.mjs` deduplicates sale/refund copies and preserves the existing refund quantity cap. Master Chart includes saved Month Close archives in its own read-only source view. No existing Dashboard selector was changed.
- **Dates:** `saleDay` and `refundDay` preserve the existing local-calendar behavior. Charges use the saved expense date, not import time or the linked sale date. Weekly buckets start Monday. Return percentages may exceed 100% when returns relate to earlier sales. Missing dates appear in Needs Review, not a guessed financial period.
- **Invoice sales:** Gross = saved sale invoice amounts. Net = gross minus saved refund amounts, all refund classifications. Orders are distinct company + marketplace + normalized order IDs, with a sale-ID fallback for missing order IDs. AOV = gross / distinct orders.
- **Financial estimates:** `saleFinancials` reuses captured per-unit values or the existing unique company/marketplace/Product Master mapping. Quantity is applied once; refunded quantities reverse the corresponding original estimate. Confirmed extra charges reduce estimated profit once. Missing monetary inputs propagate Not Available. Profit margin = estimated net profit / positive net invoice revenue.
- **Stock cost:** `saleStockCents` and `refundStockCents` reuse original saved unit stock costs. Refund selling prices never substitute for original stock cost. Returned cost is not described as permanent loss.
- **Classification:** Customer Return, RTO, Cancelled and unclassified quantities remain separate. Customer Return % = aggregate Customer Return units / aggregate gross sold units. Percentage subtotals and grand totals are calculated from numerators/denominators, not averaged. Refund amounts include all classifications.
- **Charge attribution:** Confirmed charges are deduplicated by saved ID and duplicate key. Attribution requires marketplace/order agreement, available SKU/product/code validation and a unique product/company/agent combination. Unmatched confirmed charges remain in unscoped financial totals and in Needs Review; narrower entity filters do not invent allocation. Unconfirmed/invalid records are review-only.
- **Banking:** `bankingSummary` and `bankNetReceipts` preserve current receipt version, deduplication, tombstone and reversal policies. Final Settlement Due = all-time estimated settlement − all-time net bank receipts − all-time confirmed return charges. Date filters do not turn that cumulative balance into a period balance. Period Bank Received uses receipt dates; it is not presented as sales-period allocation.
- **Wallets:** `agentWalletTotals` reuses the current wallet ledger and latest-reset exclusions, including original-stock-cost refund reversal logic. Wallet due, credits and outstanding amounts are explicitly whole-agent cumulative balances independent of report dates.
- **Purchases:** Saved purchase totals are independently reported, never subtracted again from invoice revenue or product profit. Scoped purchase amounts are unavailable without reliable ownership/product links.
- **Inventory:** Current stock and current cost-based value use saved warehouse data. Company, marketplace and agent stock allocation is unsupported without ownership records.
- **Waterfall:** Gross sales − saved refunds − net original stock cost + a labelled unitemized estimate bridge − confirmed extra charges = saved/mapped estimated net profit. The bridge is a derived reconciliation, not an invented fee/tax breakdown. If any required input is missing, the chart is unavailable.

## Files

- `client/src/MasterChart.jsx`: workspace orchestration, filters, navigation, presentation and export action.
- `client/src/masterChartData.js`: metric definitions, analytical facts, scope filters, aggregates, inventory/cumulative summaries and deterministic insights.
- `client/src/masterChartPivot.js`: pivot grouping and correct totals.
- `client/src/masterChartCharts.jsx`: dependency-free accessible SVG visuals and chart-data drill-down controls.
- `client/src/masterChartPanels.jsx`: intelligence views, comparison tables, pivot controls and supporting-record dialog.
- `client/src/masterChart.css`: scoped theme, responsive layouts and presentation styling.
- `client/src/App.jsx`, `client/src/main.jsx`: minimal sidebar/workspace and stylesheet integration.
- `server/masterChartExport.mjs`: sanitized read-only export selection and themed workbook, registered by two lines in `server/index.mjs`.
- `tools/master-chart-data.test.mjs`, `tools/master-chart-ui.test.mjs`, `tools/master-chart-export.test.mjs`, `tools/fixtures/master-chart.mjs`: synthetic financial, UI, export and integrity coverage.

## Unsupported metrics and practical limits

- No guessed company/agent/product allocations of bank cash, settlement due or shared warehouse stock. Clear incompatible dimensions to view supported all-time Banking figures and whole-agent wallets.
- No itemized taxes/fees where only net profit estimates are saved; no predictions, permanent-loss assertions, inventory ownership assumptions or fabricated previous periods.
- Legacy financial estimates can use current unique mappings; they are estimates, not a replacement for captured historical values. The drill-down labels captured sale provenance.
- The treemap uses proportional strips; charts provide accessible text/data controls. No heavy charting dependency was installed.
- Native fullscreen depends on browser support; the full-window presentation overlay still works if fullscreen permission is unavailable. Presentation slides contain the same analysis views and can scroll for detailed records.
- Very large Excel exports ask for a narrower period rather than silently truncating records. The pivot builder supports up to two row levels and one column dimension, with one selected value metric at a time.
- DOM tests verify render/interaction and SVG geometry, not pixel-level desktop screenshots. Visual review on a connected desktop browser remains a manual follow-up.

## Verification

Final result: **45 focused and regression tests passed, zero failures**, including 18 new Master Chart tests. Frontend production build passed. A live-state DOM smoke check rendered all ten intelligence views with zero runtime errors, confirmed the existing 5,310-cent charge was included, and verified all new localhost modules returned HTTP 200.

Focused tests cover financial formulas, all 16 combinations of dimensions, sale/refund/charge deduplication, original-cost refund reversal, wallet resets, bank reversal and cumulative reconciliation, missing inputs, product mapping ambiguity, grouping reconciliation, entity name collisions, pivot totals, date presets, prior comparisons, data immutability, all intelligence views, chart types, drill-down, cross-filter Back, presentation navigation, export styling, selection validation and safe strings. Existing Dashboard, Banking, reversal, refund/charge profit and estimation tests are included in the regression run.

The local frontend build uses `npm.cmd --prefix client run build -- --configLoader runner` because the sandbox's esbuild config bundler cannot traverse parent directories. The existing large-chunk advisory is non-fatal.

The verified project backend was reloaded with `SELLQUANTA_SKIP_STARTUP_WRITES=1` so the new read-only export route can be tested without startup housekeeping. A live export returned HTTP 200 with all 13 sheets. Before/after business database SHA-256: `9FF3F432EC47B7DCF5F48DD36572B2F155F37BC0632887FABF06A0352742A922`.

No reset, business data edit, commit, push, deployment or release installer was performed.
