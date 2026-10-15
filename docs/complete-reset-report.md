# Complete Reset / Start New Business — implementation report

Delivered 2026-09-23. **The real live business was NOT reset.** The feature is ready for the owner to use manually after review.

## Location and confirmation

Refresh StockPilot, open **Agents & Wallet**, scroll below the Ledger, and expand **Danger Zone**.

1. **Complete Reset** opens a review explaining which business records will be removed. No reset or backup happens at this stage.
2. **Continue to Confirmation** obtains a ten-minute, single-use server confirmation tied to the current database SHA-256. Type exactly **RESET** to enable **Reset Everything & Start New Business**.

Cancel makes no database changes. A busy guard prevents double-click submission. A changed database, expired token or repeated request requires fresh confirmation. No destructive request is automatically retried.

## Data cleared

The reset replaces the active database with StockPilot's existing fresh-install schema; it does not copy old fields into the new database.

These collections become empty arrays:

- `companies` — active and archived company records and names
- `agents`
- `accounts` — business-specific Amazon, Flipkart and Meesho accounts
- `products` — product IDs, codes, names, stock, cost, status and embedded images
- `productMaster`
- `todaySales`
- `salesHistory`
- `ledger` — sales, payments, wallet credits/settlements and adjustments
- `stockMovements` — opening stock, stock-in, adjustments, sale and refund movements
- `refunds`
- `monthCloseArchive` — nested sales, ledger, company summaries and snapshot references

The actual database also has `correctionLog` and `undoLog`; these fields and their nested old records are removed entirely. Any other legacy/custom business settings, collections, indexes or fields outside the fresh schema are also omitted.

`meta` is recreated as `{ version: 1, createdAt: <new timestamp>, lastBackupDate: null }`. Marketplace definitions remain in application code. No personal company names are seeded.

After success, the client replaces its business state, remounts the page components, rejects late old-business state responses, clears `sp_master_company`, `sp_master_marketplace` and legacy `sp_mode` preferences in local/session storage, refetches state, and opens first-company setup. Unrelated browser storage is preserved.

## External files

Inspection found:

- Product images are embedded data URLs in `stockpilot.json`; there is no active external image store.
- `exports/StockPilot-Daily-*.xlsx` contains saved Close Day reports. Other files in `exports/` are prior scan diagnostics/regression results.
- `backups/month-close/close_*.json` contains Month Close safety snapshots. The active database contains the actual archive data as well as the file references.
- `data/stockpilot-demo.json` is an unused legacy demo file. No current application path reads it or restores it at startup.
- Daily/manual/source backups and temporary test copies are outside the active database.

These passive files are preserved, not deleted. The new active database has no old snapshot references, and application history endpoints read the new database, not these directories. There is no directory deletion, export cleanup or automatic restore. Source, assets, fixtures, launcher, manual downloads and safety backups remain intact.

## Automatic full backup and atomic commit

The automatic backup is an exact byte-for-byte copy of the complete pre-reset `stockpilot.json`, including metadata, embedded product images, all collections, nested Month Close/correction/undo records, settings and references.

Location:

```text
backups/business-reset/stockpilot-before-reset-YYYYMMDD-HHMMSS-<UUID>.json
```

The timestamp uses UTC; the UUID prevents filename collisions. These backups are outside the daily-backup pruning pattern and are not deleted by reset.

Sequence:

1. Validate the confirmation and read/validate the current database. Require the SHA-256 to match the reviewed state.
2. Exclusively create a uniquely named backup temporary file, write all bytes, flush the file with `fsync`, close it, then read it back.
3. Verify exact byte equality, SHA-256 equality and valid JSON. Publish the backup by rename, then read and verify the published file again.
4. Create the fresh database in a separate, uniquely named temporary file beside the active database. Flush, read back and verify it.
5. Recheck that the original active database still matches the backed-up bytes.
6. Atomically rename the fresh temporary file over `stockpilot.json`. This is the only operation replacing active business data; no intermediate empty collections are saved.

The reset transaction is synchronous, matching StockPilot's existing single-process storage model. Requests cannot interleave during it. After the commit, no fallible filesystem operation is required for success. Published safety backups remain even if reset persistence fails. Cleanup touches only temporary files created by that reset attempt.

## Tests

Command: `node --test client/src/*.test.js tools/*.test.mjs`

**69 passed, 0 failed:** the existing 56 regression tests plus 13 new reset tests. Destructive tests ran exclusively against copied servers/databases in `tmp/complete-reset-test-*` and `tmp/reset-ui-server-*`.

Verified:

- Populated business reset removes all operational data, including unknown business fields, corrections, undo history and embedded images.
- The full pre-reset backup is byte-for-byte identical to the original copy.
- Injected backup write failure, temporary backup verification failure, published backup verification failure and final database rename failure leave original database bytes intact.
- A database change before/during backup is not overwritten.
- Expired/invalid confirmations are rejected; two simultaneous requests using one token produce one success and one 409 rejection, with one backup.
- Cancel, exact typed confirmation, frontend double-click prevention and no automatic retry.
- Old local/session preferences and React page state clear; late old-business reads cannot restore old names.
- The real App components and actual API, connected to a copied backend, reset a populated database and create **TEST NEW COMPANY** through the UI.
- **TEST NEW COMPANY appears in the Product Master selector and Agent selector.** No separate company-selector patch was necessary.
- The fresh UI creates a warehouse product, agent/accounts, Product Master mapping and manual sale. Dashboard, Refunds, Close Day and Month Close pages load. Both Excel backup exports work.
- Separate HTTP tests execute Close Day and Month Close successfully with the new business, including reuse of an old order ID after reset.
- Existing parser/scanning, Daily Sales selection, dynamic-company, export, Dashboard and Month Close regression tests pass.

UI verification used real React DOM components under JSDOM and a real isolated HTTP backend, not a manual click on the live browser's reset button.

Production build: `npm.cmd --prefix client run build` — **passed**. Only the existing large-chunk warning remains.

## Exact files changed

| File | Change |
|---|---|
| `server/completeReset.mjs` | New verified-backup/atomic-reset service with single-use confirmation |
| `server/index.mjs` | New prepare/reset endpoints; existing operation handlers unchanged |
| `server/store.mjs` | Exports the existing `emptyDb` factory; no change to its schema or normal storage behavior |
| `client/src/CompleteReset.jsx` | New collapsed Danger Zone and two-stage confirmation UI |
| `client/src/App.jsx` | Places the component under Agents & Wallet; clears old client state/preferences on confirmed success |
| `client/src/api.js` | Adds prepare/reset API calls |
| `tools/complete-reset.test.mjs` | New isolated backend, failure and fresh-start tests |
| `tools/complete-reset-ui.test.mjs` | New confirmation, stale-state and real-component/HTTP tests |
| `docs/complete-reset-report.md` | This report |

Generated build output: updated `client/dist/index.html`; replaced `client/dist/assets/index-CzIxlPHS.js` with `client/dist/assets/index-CtO0Wb9N.js`. CSS and PDF worker assets are unchanged.

No parser, detector, Ollama, label-segregator, sales-saving, stock-deduction, refund, wallet-calculation, Dashboard-calculation, Excel, Company Management, Close Day or Month Close business logic was changed.

Timestamped pre-edit source backup: `backups/complete-reset-source-20260923-112443/`.

## Live-data verification

SHA-256 before:

```text
D8A50C0B60D0B60998F96EB5EFB7D874B9813B5D6975A11CD0FB9BD5C16D721D
```

SHA-256 after:

```text
D8A50C0B60D0B60998F96EB5EFB7D874B9813B5D6975A11CD0FB9BD5C16D721D
```

The updated backend was loaded with a temporary read-only lock protecting live data from existing startup housekeeping. Only a read-only state request was made afterward; neither reset endpoint was called on the live backend.

The live database still contains 3 companies, 3 agents, 9 accounts, 25 products, 62 Product Master mappings, 5 current sales, 1 refund and 1 Month Close archive. **The real business was NOT reset. The owner must perform the final reset manually after reviewing this feature.**
