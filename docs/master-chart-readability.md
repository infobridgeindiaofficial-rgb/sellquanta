# Master Chart consistency and readability

UI-only changes:
- masterChartHybrid.css: scoped host sidebar dimensions, colours, hover/active state, typography, icon sizing; host surfaces and control tokens; readable matrix, chart, pivot, drawer and presentation text. Mobile icon rail and horizontal matrix scrolling remain in place.
- masterChartHybridCharts.jsx: treemap text uses dark foreground on lighter existing palette fills; chart data and geometry unchanged.
- master-chart-hybrid.test.mjs: regression checks against original sidebar CSS and essential text/status colour contrast (minimum 4.5:1).

Validation: 27 focused tests passed, including filtering, section/repeated-click scrolling, drawer, pivot, nine presentation slides and real 13-sheet export. Production frontend build passed with the existing bundle-size warning. Live saved-state smoke check rendered 10 views with zero runtime errors and retained the confirmed ₹53.10 charge. All 15 protected baseline hashes matched, including business data, selectors, financial helpers, server/export and standalone preview.

Limitation: browser tool returned no connected browser, so viewport/zoom side-by-side comparison and pixel-level responsive/overflow inspection could not be performed. CSS dimensions and states were compared automatically; no pixel-perfect claim is made.
