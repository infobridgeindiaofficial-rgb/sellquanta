# Banking statement scanner — local Phase 2

**Current saving/history behavior:** see [Banking Phase 3](BANKING_PHASE3.md).
The Phase 2 blocked-save and detection-only notes below describe the earlier
workflow; explicit verified saving is now implemented under the Phase 3 rules.

The Banking sidebar opens a local verification preview for PDF text, CSV and XLSX.
Scanning, classification and row approval never save receipts. No migrations,
receipt overwrites, allocation changes, or changes to Dashboard calculations are
included. Manual receipt saving remains disabled as well.

## Save gate and legacy reconciliation

The current project has a legacy `bankSettlements` record with date, marketplace,
amountCents and reference, but no original narration, account hash or import
fingerprint. Dashboard Bank Received already reads this collection, deduplicates
receipt IDs/versions, and applies its existing receipt/explicit-allocation rules.
Those calculations are untouched. The prior `BANKING.md` describes historical
routes that are absent from the current server; it is not proof of a live writer.

Confirm & Save is disabled. `POST /api/banking/statement/import` always returns
409 and `saved: 0`, even for an explicit confirmation. There is intentionally no
write implementation until the legacy receipt and original source statements
can be reconciled without double-counting. New persistence, timestamped import
batches and durable receipt provenance are deferred behind this gate; preview
rows already carry the original source cells, sources, classification provenance
and fingerprint needed for that work. No new receipt database is created.

The supplied August/September statements now pass extraction reconciliation,
but neither has an exact date/reference/amount match for the existing legacy
receipt. Its provenance remains unresolved. Before enabling imports, reconcile
that existing receipt against its own source evidence, decide how
to record those links without replacing originals, and test idempotent atomic
imports against concurrent/repeated requests. An ambiguous legacy overlap must
remain blocked rather than being treated as a new receipt.

## Parsing and limitations

- PDF.js extracts text/coordinates from every PDF page in the browser. The local
  backend assigns cells by the explicit header coordinates. Supported table
  headers include Date/Transaction Date, Narration/Particulars/Description,
  optional Value Date and Reference/UTR, Debit/Withdrawal, Credit/Deposit and
  Balance. Separate debit and credit columns are required. Unsupported headers,
  broken rows and extraction failures are reported instead of guessed.
- The observed IOB Date(Value Date)/Particulars/Ref-Cheque/Transaction Type/
  Debit(Rs)/Credit(Rs)/Balance(Rs) format has a dedicated adapter. Balance cells
  anchor transaction bands, including both narration lines and the parenthesized
  value date. Column boundaries account for centered headers and right-aligned
  amounts. Continuation pages reuse the header layout. Cover account labels and
  separate value cells are read only to produce the private account hash.
- CSV/XLSX use the already-installed local `xlsx` library, preserving empty debit
  and credit cells and quoted multiline narration. XLSX sheets are processed with
  their row and sheet identifiers. Excel numeric dates and Indian DD/MM/YYYY or
  DD-MMM-YY dates are validated as real calendar dates.
- Continuations append only to an existing transaction, preserve original cells
  and narration line breaks, and retain every source line. Both chronological
  directions are supported. Opening/closing balance metadata and repeated table
  headers are tracked separately. Unexpected non-empty rows generate issues.
- Monetary amounts use integer cents, validated Indian/international comma
  groupings and at most two decimal places. No debit can become a receipt.
- Image-only pages produce OCR-required warnings. OCR, password entry, unlabeled
  amount/direction tables, other unsupported merged/split headers and unverified bank-specific
  narration variants are not guessed or supported as successful scans.
- Scan limits: 15 MB files, 300 PDF pages, 50,000 text items per page, 20,000
  spreadsheet rows. The local JSON request has the application's existing 35 MB
  cap. Extremely large files should be split into smaller statements.
- Source totals, when explicitly present in their table cells, are compared to
  deduplicated extracted credits/debits/count. Running balances are checked in
  either direction. A scan is marked reconciled only with a matching source
  count and credit total and no extraction warnings. For the observed IOB format,
  count is derived independently from transaction-date blocks and checked against
  the balance-row anchors; it is explicitly labeled as not a printed bank count.
  The source's debit/credit footer totals must match. Missing footer totals mean
  unverified extraction, not success. Other IOB variants still need validation.

## Classification and Ollama

Only user-confirmed patterns are automatically labeled: `MEESHO TEC`, `MEESHO
PAY`, `MEESHO TEC-/CUST/ MEE`, `FLIPKART I`, and Amazon `IMPS/.../Amazon /HSBC`.
Other proposed variants remain reviewable until validated against real evidence.
`INTERNAL A-DAS` always requires review. Government/subsidy, explicitly personal
credits, bank charges and debits are excluded; unknown transfers require review.
Rule-confirmed means identified, not approved or saved.

Ollama uses the existing configured local model and a loopback-only URL. No model
is downloaded and no external service is used. Up to 40 uncertain narrations are
sent in batches of at most four, with a 45-second per-request timeout and two-minute
overall verification budget. Successful batches are retained if another fails.
Remaining rows stay in manual review. Cloud-suffixed models are rejected even
on a loopback URL. Long numeric identifiers are redacted before AI input. The
request follows Ollama's documented JSON-schema `format` mechanism:
https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx

Responses must match a strict key/type/enum/confidence/ID schema with
`reviewRequired: true`. Extra transaction fields, missing IDs, duplicates and
malformed JSON are rejected. AI cannot alter original dates/references/amounts/
balances or the rule classification. Suggestions are shown separately and require
explicit adoption followed by approval. Offline/invalid responses retain rules.

## Privacy and duplicate protection

All statement processing stays on this computer. No statement payloads are logged
or saved. PDF documents never leave the browser; extracted text is sent only to
the loopback backend. Full documents are never sent to Ollama. Original extracted
transactions live in transient memory; long numeric identifiers are masked in
rendered narration/reference/sheet text. Account identity is hashed with SHA-256;
the UI does not show the full account number. Files under `test-statements/`, all
PDFs, logs, business data and scratch files are excluded from Git.

Fingerprints use account identity where available, date, normalized reference,
credit cents and normalized narration. Within-statement repeats are preserved as
Duplicate rows but excluded from approved totals. Every new scan checks existing
persistent `bankSettlements.transactionFingerprint`, including deleted records,
and conservatively flags legacy date/amount/reference overlaps. This prevents
preview approval of duplicate candidates; durable imported fingerprints will not
exist until an authorized, reconciled import writer is implemented.

## Validation completed

- Synthetic August/September IOB-like CSV and XLSX tables: nine unique
  transactions, eight credits totaling INR 828.00 and one INR 7.00 debit.
  Meesho: 3 rule-confirmed, Flipkart: 1, Amazon: 1; review required: 1;
  Other / Excluded: 3. All start unapproved.
- Synthetic two-page PDF bytes passed through PDF.js: ten extracted rows,
  nine unique transactions, one repeated page-row duplicate, multiline narration
  and preserved source provenance; source count and credit totals reconciled.
- Parser/rule/AI failure, malformed JSON, remote URL rejection, legacy/persistent
  duplicate, explicit preview approval and disabled-save HTTP/UI tests passed.
- Full npm suite: 133 passing tests. Local frontend build passed (existing large
  bundle warning). A live local Ollama request returned a validated advisory
  suggestion while leaving the uncertain entry unapproved. Real database bytes
  were unchanged before/after preview testing and backend restart.
- The original PDFs were found in Downloads and read there, without copying them
  into this repository or writing their raw contents to disk. August: two pages,
  26 transactions; September: three pages, 63 transactions. Both passed independent
  count, source debit/credit footer-total and running-balance checks with zero
  parsing issues. Account identities were hashed and every value date preserved.
  Actual amounts, references, names and account numbers are omitted from reports.
- Rule classifications: August Amazon 1, Flipkart 1, Meesho 10, review 3, excluded
  11; September Amazon 1, Flipkart 2, Meesho 13, review 14, excluded 33. This is
  rule classification, not an assertion that unknown credits are settlements.
  Ollama supplied validated advisory suggestions for all 17 uncertain credits;
  none was automatically approved. An earlier large-batch request failed safely;
  the bounded batches fixed that reliability issue in the actual-file check.
- Fingerprints were stable across re-parsing. Simulated previously stored
  fingerprints in memory flagged every credit on re-upload. No actual receipt
  records were written to perform that check. The current localhost preview API
  returned both real-file results with all rows unapproved and saving disabled.
- `tools/verify-private-bank-statements.mjs` is an opt-in local verifier. It emits
  only aggregate counts and pass/fail checks, never raw narration, references,
  money values, names, account hashes or AI explanations. The ignored
  `tmp/release-prep/banking-real-statement-verification.json` records the safe
  runtime checks. `git check-ignore` confirmed the statement exclusion rules;
  neither original PDF was copied, uploaded externally, staged or committed.
- No visual browser verification was performed; browser access was unavailable.

The local API was restarted with `SELLQUANTA_SKIP_STARTUP_WRITES=1`, which skips
existing startup backup/migration housekeeping for this verification session.
Default application behavior is unchanged when the flag is absent. The app remains
available at http://127.0.0.1:5173/ with the API at http://127.0.0.1:8787/.

## Simplified detection-test view

The scanner accepts multiple statements and displays only confirmed marketplace
credits in its main six-column table: Date, Marketplace, Bank Narration,
Reference Number, Received Amount, Detection Status. Amazon, Flipkart and Meesho
cards show transaction counts and summed confirmed credits. These are transient
scan totals, independent of Dashboard Bank Received and stored receipt history.

Ambiguous credits stay in a separate Needs Review table with advisory Ollama
suggestions. Choosing or adopting a suggested marketplace does not include a
review row in confirmed totals until the user explicitly confirms its
classification. Correcting a marketplace on a confirmed row changes only the
preview classification and updates the marketplace cards. All rows remain
unapproved for import. Confirm & Save stays disabled.

Excluded, debit and duplicate rows are hidden from the main results but retained
in the original in-memory extracted rows. Fingerprints prevent double-counting
when the same statement is selected more than once in a combined scan. Manual
receipt entry and receipt-history sections are unchanged by this UI revision.

An opt-in real-file React DOM integration test uses both original Downloads
PDFs, the live loopback preview API and the real local Ollama engine. Combined
results are 28 confirmed credits (Amazon 2, Flipkart 3, Meesho 23), 17 review
credits and 44 hidden other transactions. Assertions compare every displayed
date, marketplace, masked narration, reference and amount with the actual scan
data and compare each card's amount with its confirmed-row sum. No real banking
values or narrations are printed or saved by this test. No mock scan response
is used in that opt-in test. Existing database bytes are compared before/after.

Run private UI verification only when authorized local files are present, by
setting `SELLQUANTA_VERIFY_PRIVATE_BANK_UI=1` and `SELLQUANTA_STATEMENT_FILES`
to a JSON array of two absolute local PDF paths, then running
`node --test tools/banking-ui.test.mjs`. Default automated tests use only synthetic
fixtures and do not read private files. This is DOM/content verification, not
visual browser verification; browser automation was unavailable.
