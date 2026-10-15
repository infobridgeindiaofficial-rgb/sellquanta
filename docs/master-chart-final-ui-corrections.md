# Master Chart final UI and navigation corrections

Changed only the live Master Chart shell, its scoped styles and UI regression tests.

- Restored the Dashboard logo, SellQuanta name and Local Edition subtitle, including standard dimensions and typography.
- Kept one compact top Back to SellQuanta control; removed the workspace card and all sidebar bottom promotions/status content.
- Reduced the executive header to reporting dates, Refresh data, Present and Export Excel.
- Sidebar navigation now scrolls after React commits the selected view. Overview targets Executive command centre; other sections target their analytical heading and first chart/table after the repeated KPIs. Repeated clicks work. Native scrollIntoView handles nested scrolling ancestors without targeting the sibling sidebar; scroll margin leaves top clearance. The current content headers are not sticky. Reduced-motion preference disables smooth scrolling.
- Preserved charts, KPI dimensions, typography, filters, investigation, pivot, presentation and export logic.

Verification: 26 focused Master Chart tests passed; frontend production build passed (existing large-bundle warning). Live backend state rendered all 10 views with no runtime errors; the saved ₹53.10 charge remained included. Browser visual inspection was unavailable because the browser tool returned no connected apps or browsers. Protected business data, selectors, financial helpers, server/export logic and standalone preview hashes match the prior integration baseline.
