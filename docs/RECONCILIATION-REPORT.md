# SellQuanta 1.1.2 candidate — 16 October 2026

Verdict: **NOT READY FOR RELEASE**. Local code/build verification is complete. Native Windows acceptance and feature parity gates remain open. Nothing was pushed, uploaded, published, installed or uninstalled.

## Candidate and version reconciliation

The original checkout remains on main at ced9ce9, version 1.0.2, with its existing uncommitted safety fixes intact. The published 1.1.1 release was checked live on GitHub; its source is 76b6b49487247e1d726050da61d6613e6e4ea591. Version 1.1.2 is the proposed next version; no existing release was overwritten.

The prepared source is `tmp/release-candidate-1.1.2`. It copies the existing reconciliation worktree inside this workspace, then completes the safety changes here. The separate reconciliation worktree was read only. This avoids overwriting either existing source tree. Do not release the old main checkout as a newer version.

Reviewable source patch against released 1.1.1: `tmp/release-prep/candidate-1.1.2.patch`. Exact changed-file inventory: `tmp/release-prep/candidate-changed-files.txt`. Full source inventory and installer checksum: `tmp/release-prep/candidate-source-manifest.json`. The patch contains source/tests/docs only; no production records, secrets, installers or dependencies. No commit was made. Proposed commit: `Prepare 1.1.2 verified backups and desktop safety`.

## Findings and fixes

- Manual backup was stored under the installed application's AppData root; the relative success message concealed its actual location. Backup creation now verifies JSON and exact bytes, returns an absolute path, byte count and SHA-256, and uses collision-resistant filenames. Unverified responses cannot produce a success message. A scoped download endpoint and native Save-dialog configuration offer a chosen backup-copy location. Automatic backup retention remains 30 daily snapshots, with manual backups retained.
- Invalid databases fail closed rather than being normalized into an empty business. Unknown fields are retained. Isolated restore/import verifies copies and refuses existing targets.
- The old checkout is behind the published application. The candidate retains released updater/preload/trust, purchases, Banking and reporting modules rather than replacing them with older implementations.
- Backend runtime dependency closure is explicit in packaging. Isolated copied-server tests now include the client modules required by the Master Chart export.
- Master Chart uses released gross-sales-minus-active-receipts Banking semantics, excludes deleted receipts, and labels the result Reference Difference. It does not subtract charges again or label this result unpaid settlement. Missing estimates remain unavailable. Monetary validation rejects invalid amounts and overflow. Its export now uses the released branded Excel writer.
- The obsolete Agents & Wallet outer-sidebar item is removed. Business Setup remains accessible through Settings for company/agent/account configuration and historical records. Wallet Reset action/handler is removed from the UI; historical baseline calculations and stored records are retained. Close Day and Month Close were not restored.
- Packaged taskbar identity and icon are configured explicitly. This verifies configuration, not actual Windows taskbar rendering.

## Executed verification

| Check | Result |
|---|---|
| Original working checkout full suite | 245 passed, 0 failed |
| Reconciled candidate full suite | 167 passed, 0 failed |
| Candidate frontend production build | Passed; existing large-chunk warning |
| Windows NSIS and unpacked build | Passed; publishing explicitly disabled |
| Packaged backend using Electron's embedded Node | Passed; built UI served, no Vite/external Node required |
| Packaged manual backup and download | Verified exact bytes, path, size, hash |
| Synthetic two-run persistence | Passed; raw database unchanged |
| Synthetic isolated restore | Passed; existing destination refused |
| Pre-update backup and updater trust regressions | Passed; installer never executed |
| Excel exports | Reports 5 sheets, Banking 3 sheets, Master Chart 13 sheets |
| Port conflict handling | Mocked shell tests refuse unrelated/unowned services without killing them |
| Native Save dialog and taskbar details | Mocked shell configuration checks passed |
| Installed taskbar, native dialog, desktop/Start Menu icons | Not visually verified |
| Actual installer upgrade/uninstall/reinstall | Not executed; requires a disposable Windows environment |

Logs: `tmp/release-prep/original-checkout-tests.log`, `candidate-tests-final.log`, `candidate-client-build.log`, `candidate-windows-build.log`. Packaged verification evidence: `tmp/release-prep/candidate-final-verification.json`; rerunnable check: `tmp/release-prep/verify-final-candidate.mjs`.

## Data and backup evidence

Development data remains at `C:\Users\moham\Desktop\StockPilot-Fresh\data\stockpilot.json`. Packaged applications default to `%APPDATA%\SellQuanta Data`; explicit `SELLQUANTA_DATA_ROOT` overrides it. Installer/uninstaller retain that external directory. Both production database hashes still match the protected audit originals. No test restoration touched live data.

Previously created full production backup was reverified on disk:

`C:\Users\moham\AppData\Roaming\SellQuanta Data\backups\manual\stockpilot-manual-20261016-031206-b2966fcf-0da3-42ca-be95-569e3e218713.json`

Size: 330,992 bytes. SHA-256: `2f52193ee3fc628e8e000b0a43178d09526abd260af3b7be4eee007a0a9a1727`.

New packaged-backend backup/restore tests used only synthetic records. Their exact backup path and hash are recorded in `candidate-final-verification.json`.

Missing settlement/profit estimates are preserved as unavailable where captured or uniquely mapped numeric values are absent. No financial estimates were invented and no historic records were backfilled for this release preparation.

## Local installer and remaining gates

Installer: `C:\Users\moham\Desktop\StockPilot-Fresh\tmp\release-prep\candidate-build\SellQuanta-Setup-1.1.2.exe`.

Size: 127,777,976 bytes. SHA-256: `d3415281af37b48ccdef6b628bbf365ede99835680f5a22c64086eef14f0c79e`. Authenticode status: NotSigned. This local candidate is not approved for distribution. Existing updater verification policies were retained; no 1.1.2 metadata was signed or published.

Remaining gates:

1. Verify actual taskbar/shortcut icons and Save-dialog behavior on Windows. Native desktop interaction is unavailable in this session, so automated configuration evidence cannot close this gate.
2. Verify upgrade, uninstall/reinstall and update-install data retention on a disposable Windows machine/profile, preserving real business data.
3. Resolve remaining source parity: the older main checkout contains a statement scanner, Return Charges entry/ledger and Product Master estimate-editing features absent from the released 1.1.1 base. This candidate preserves existing JSON and can read saved charges for analytics, but does not port those transaction-writing workflows. Their duplicate, reversal, audit and financial contracts need reconciliation before claiming that all existing UI/features are retained. The original checkout and its 245 passing tests remain intact.

No publication approval is requested while these gates remain open. The user explicitly requires approval before any final push, artifact upload or GitHub publication.
