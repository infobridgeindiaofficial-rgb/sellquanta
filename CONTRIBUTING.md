# Contributing to SellQuanta

Thanks for your interest in improving SellQuanta.

## Getting started

1. Fork the repository and create a branch from `main`.
2. Install dependencies: `npm ci` and `npm --prefix client ci` (Node.js 24 LTS).
3. Make your change and keep it focused on one topic.
4. Run `npm test` and `npm --prefix client run build` before opening a pull request.
5. Open a pull request describing what changed and why.

## Ground rules

- **No real data.** Never commit real customer names, addresses, phone numbers, e-mail addresses, GSTIN/PAN or other business identifiers, real marketplace order IDs or SKUs, shipping labels, invoices, Excel exports, databases (`stockpilot.json`), backups, scan diagnostics or screenshots containing private information. Use synthetic test data only.
- **No secrets.** Never commit `.env` files, tokens, passwords, certificates or private keys.
- Keep business-critical logic (stock, wallet, refunds, month close) covered by tests when you change it.
- Label parsers must never guess: when a value cannot be read confidently it must be left for the user to review.
- Code is contributed under the project's [MIT License](LICENSE).

## Reporting bugs

Open a GitHub issue with steps to reproduce, the SellQuanta version and your Windows version. Remove any personal or business data from logs and screenshots before attaching them.

Security issues must **not** be reported in public issues; see [SECURITY.md](SECURITY.md).
