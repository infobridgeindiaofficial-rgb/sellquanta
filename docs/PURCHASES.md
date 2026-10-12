# Purchase Management

Purchases is immediately above Warehouse. Warehouse remains read-only. Existing product-management, stock-adjustment and export APIs remain available; no existing sales, wallet, refund, mapping, Reports or backup calculation was replaced.

## Receive an invoice

Enter the UTC purchase date, supplier and invoice number. Add one or more product lines. Select an existing active product to populate its permanent code, name and current cost, or enter a new code/name. Enter whole positive quantities, costs with no more than two decimal places, and a non-negative whole low-stock threshold. Images are optional and resized to a small JPEG; existing images are retained when no new image is supplied. Confirm Receive Purchase.

Supplier/invoice numbers are unique across all dates, ignoring outer whitespace and case. Different suppliers can use the same invoice number. Use the supplier's full invoice reference (including financial-year prefix when relevant). One product code may occur only once in an invoice; combine its quantities. Archived product codes cannot be reused. Renaming a supplier keeps old names as aliases and never rewrites historical supplier snapshots.

## Excel

Download Excel Template from Bulk Purchase Import. Fill the Purchases worksheet's nine columns: Purchase Date, Supplier Name, Invoice Number, Warehouse Product Code, Product Name, Quantity, Unit Cost, Low Stock Alert, Notes. Dates must be YYYY-MM-DD text or native Excel dates. Input cells must contain values, not formulas. The header-only template cannot accidentally receive an example purchase.

Maximum upload: 8 MB and 2000 rows. Rows with the same supplier/invoice form one invoice and must share its date. Review product count, quantity, valid-row value and invoice count. Invalid rows prevent the entire import; download the error workbook, correct the source, and preview again. Validation is repeated against current database state during import. Every invoice, product, supplier, stock movement and request receipt is committed in one existing atomic JSON-file replacement. A failure before that replacement leaves persisted data untouched.

## Cost and stock reconciliation

The established method is **current stock × current product cost**, not FIFO or weighted-average costing. Receiving sets the product's current cost to the unit cost of the most recently committed receipt, even if its purchase date is historical. Bulk receipts apply in worksheet invoice/line order. This preserves the existing stock-adjustment cost method. Each purchase line independently retains its original integer-paise unit cost and total; existing sale cost snapshots and wallet ledger amounts remain unchanged. A supplier return decreases physical stock at the original purchase-line cost for return history and does not change current product cost, sales refunds or agent balances.

Eligible supplier-return quantity is the lesser of (original quantity minus prior purchase returns) and current physical stock. A return cannot predate its purchase, exceed that eligible quantity, target an archived product, or make stock negative. Original invoices and lines are never edited or deleted. No supplier payment/refund accounting is implied by a physical return.

Purchase History filters saved purchase dates in UTC, inclusive at both ends. Weeks are Monday–Sunday. Returned quantities/status in history reflect all returns against each selected original line, including returns made after the selected purchase period. Purchase Return History separately shows each return's own date and original cost.

## Persistence and compatibility

New collections: `suppliers`, `purchases`, `purchaseReturns`, `purchaseRequests`. They are read as empty on legacy files and are added only when the user saves a purchase, supplier or purchase return. There is **no startup migration and no rewrite of existing records**. Existing backup/reset mechanisms include the complete database automatically; reset still requires the existing explicit destructive confirmation. Retain a verified full database backup before updating the local app.

Receipts and returns require an unpredictable client request ID. Durable request receipts survive restart. Exact retries return the previous result without saving or adding stock; reuse with different details is rejected. Keep the same form/file after a network error and retry it. Invoice uniqueness is a second protection even if a new request ID is used. A completed import requires a new invoice reference to represent a genuinely new receipt.

API routes are under `/api/purchases`: GET collection, POST invoice, POST/PUT suppliers, POST returns, GET import-template, POST import-preview/import/error-report, GET history/history-export. They use the existing localhost-only Express listener. No LAN listener, tunnel, external data store or credential is added.

Tests use synthetic data or isolated copies with separate `SELLQUANTA_DATA_ROOT`. Never receive a test invoice or import into the user's actual database. Actual-app verification checks the deployed UI and read-only API; stock-changing synchronization is tested only on isolated data.
