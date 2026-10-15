# Approved Option C integration

Open **http://127.0.0.1:5173/** and select **Master Chart**. The approved standalone reference remains available at http://127.0.0.1:5188/ and was not edited by this integration.

## Design and typography

The live workspace uses the approved Option C structure: its dark sidebar and executive header, light workspace, compact filter toolbar, ten-card KPI arrangement, nine-chart overview canvas, analytical product matrix, insight cards, right-side investigation drawer, Pivot Analytics Studio and executive presentation styling. The original icon paths and chart styles were copied from the approved preview, rather than replaced with a new design.

Typography inherits SellQuanta's existing font family. The heading/body/table/control hierarchy follows the application: 26px main heading, 19px section heading, 15px panel heading, 14px body, 13px table cells and 13.5px controls. KPI values use the existing 23px / 32px / 16px unavailable-value hierarchy. The sidebar uses the application's 232px desktop width to accommodate the existing navigation text sizes. All styling is scoped to Master Chart; the original app shell resumes on Back to SellQuanta.

The primary ten KPI cards retain the approved arrangement. The remaining previous KPIs—gross units, net units, RTO and cancellations—remain visible in a compact supplementary strip. Existing detailed analyses remain available beneath the approved views: time grains and alternative chart types, product rankings/comparison and warehouse movement, entity/product/order analysis, current whole-agent wallets, classified returns/review records and financial reconciliation. Presentation retains nine slides, including the previous company and agent sections, in the approved presentation skin.

## Real-data integration

- The existing `buildMasterChart`, fact selectors, financial formulas, original stock-cost refund reversals, wallet rules, Banking reconciliation and pivot calculations were not changed.
- `masterChartHybridModel.js` adapts existing facts to the approved visuals. Financial values stay in integer cents, use the existing aggregate selectors and are formatted only for display.
- No fictional dataset, generators, prototype CSV export or sample fallback is imported into the live feature. Missing inputs show Not Available. Empty periods contain no substitute records.
- Donut contribution requires known nonnegative net sales; otherwise it reports unavailable rather than inventing slices. Treemap area represents positive known profit; losses and unavailable estimates remain in the matrix.
- The approved waterfall styling displays original stock cost and the existing explicitly labelled estimate bridge. The bridge is a derived reconciliation, not a claim about itemized fees.
- Shared warehouse stock is not allocated to a company/marketplace/agent. When supported, matrix rows label it as current shared stock and totals count each warehouse product once. Unknown stock stays unavailable.
- Saved transaction/charge months are selectable, including charge-only periods. Charge amounts use saved expense dates, while all-time Banking due remains explicitly cumulative.
- Chart/entity selections cross-filter the workspace and open the investigation drawer. Back/Clear selections preserve the reporting dates. Matrix selections can be applied as filters from the drawer.
- The drawer retains all supporting saved records, nested Back/Close navigation and original financial details; longer lists have View all controls.
- Pivot Studio retains two row levels, configurable columns/metrics, search, sorting, collapse/expand, conditional formatting, correct weighted totals and the same export selection contract.
- Every live export control calls the existing `/api/master-chart/export` endpoint and downloads the actual 13-sheet XLSX workbook. No backend or export implementation was modified.

## Changed files

- `client/src/MasterChart.jsx`: entry point for the integrated interface.
- `client/src/MasterChartHybrid.jsx`: approved workspace shell, filters, view composition, cross-filter state, presentation and existing Excel action.
- `client/src/masterChartHybridModel.js`: display adapters over verified fact/aggregate selectors.
- `client/src/masterChartHybridCharts.jsx`: approved chart and icon components, with real-data missing/negative-value handling.
- `client/src/masterChartHybridPanels.jsx`: KPI cards, product matrix, insight cards, pivot studio and investigation drawer.
- `client/src/masterChartHybrid.css`: scoped approved stylesheet and existing SellQuanta typography sizes.
- `client/src/App.jsx`: conditional Master Chart shell and return-to-workspace callback only.
- `client/src/main.jsx`: stylesheet import.
- `tools/master-chart-ui.test.mjs`: preserved interaction coverage adapted to the approved layout, plus matrix/drawer/pivot/export and missing-value coverage.
- `tools/master-chart-hybrid.test.mjs`: adapter reconciliation, stock/identity handling, waterfall and CSS/data isolation checks.
- This handoff document. Temporary verification evidence is under `tmp/release-prep/`.

## Verification

- **52 focused and regression tests passed, zero failures.** Includes existing Dashboard, Banking, receipt reversal, refunds/return-charge profit, financial estimates, return-analysis period matching, Master Chart calculations and Excel checks.
- Frontend production build passed using `npm.cmd --prefix client run build -- --configLoader runner`. The existing non-fatal large-chunk advisory remains.
- Live backend data reconciled against Dashboard gross/net sales, refund amounts, unit quantities, estimated profit, estimated settlement and original stock cost; Banking all-time balance and receipt totals; Agent Wallet due/credits/outstanding balances.
- A live-state DOM smoke check rendered all ten sections with zero runtime errors. The existing 5,310-cent charge was included for its valid reporting period.
- The live Excel endpoint returned HTTP 200 and a valid workbook with all 13 sheets, using the current filter/pivot contract.
- Hash checks confirmed the original financial selectors, Banking/wallet helpers, export backend, business database and approved preview files were unchanged.
- Prototype-data import scans and scoped-CSS checks passed. The existing Dashboard still renders before/after entering Master Chart and Back to SellQuanta restores the original shell.

## Remaining limits

The existing data-attribution limits remain: unsupported receipt allocations and shared-stock ownership are not guessed. Missing estimates remain unavailable. Desktop pixel-level comparison and native fullscreen behavior could not be inspected because no browser is connected to the automation tools; layout structure, approved styles, DOM interactions, SVG geometry and live data were checked.

No data reset or edit, commit, push, deployment, installer, dependency installation or financial-formula change was performed.
