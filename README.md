# SellQuanta

SellQuanta is an open-source Windows desktop application for managing e-commerce orders, inventory, product mappings, refunds and agent wallets.

It runs entirely on your own computer. There is no cloud account and no telemetry: business data is stored in a local JSON database on the PC where SellQuanta is installed.

> **Status:** early-stage project. Windows installers built from this repository are currently **unsigned** (see [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)), so Windows SmartScreen may show a warning.

## Download

The Windows installer is published on the [Releases page](https://github.com/infobridgeindiaofficial-rgb/sellquanta/releases) and at [infobridgeindia.online/sellquanta/download](https://infobridgeindia.online/sellquanta/download). Each release is built by the `Release` GitHub Actions workflow from this repository's source code.

## Features

- **Warehouse** – products, warehouse product codes, cost price, opening stock, stock adjustments and low-stock levels.
- **Product Master** – map marketplace SKUs (Amazon, Flipkart, Meesho) to warehouse products per company, with Excel import/export.
- **Daily Sales** – record sales manually or scan shipping-label / invoice PDFs. A text-layer parser reads supported layouts; an optional local [Ollama](https://ollama.com) vision model can help with labels the parser cannot read. Quantities and amounts are checked before saving.
- **Refunds** – refund a sale within the refund window, returning stock and adjusting the agent wallet.
- **Agents & Wallet** – companies, agents and marketplace accounts, payments, wallet reset and payment history.
- **Excel / Close Day / Month Close** – daily Excel exports, month-close archives and full backups.

Label layouts change over time. Scanning results must always be reviewed before saving; compatibility with any particular marketplace document format is not guaranteed.

## Requirements

- Windows 10 or 11 (64-bit) for the desktop app
- [Node.js](https://nodejs.org) 24 LTS and npm (for building from source)
- Optional: [Ollama](https://ollama.com) with a vision model (default `qwen2.5vl:3b`) for AI-assisted label scanning. SellQuanta never downloads models itself.

## Build from source

```powershell
git clone https://github.com/infobridgeindiaofficial-rgb/sellquanta.git
cd sellquanta
npm ci
npm --prefix client ci

# run the automated tests
npm test

# run in development (browser UI on http://127.0.0.1:5173, API on 127.0.0.1:8787)
npm run dev

# run the desktop app from source
npm --prefix client run build
npm run desktop

# build the Windows installer (output in release/)
npm run desktop:build
```

## Where data is stored

| Mode | Data folder |
|---|---|
| Installed desktop app | `%APPDATA%\SellQuanta Data` |
| Running from source | `data/`, `backups/`, `exports/` inside the project folder (ignored by git) |

Uninstalling or updating the app does not delete the data folder. Keep your own backups.

Never commit real business data, shipping labels, invoices or exports to this repository. Tests use synthetic data only (`client/src/test-fixtures/` and `tools/fixtures/`).

## Optional Ollama configuration

Copy `.env.example` to `.env` to override defaults:

```
PORT=8787
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5vl:3b
```

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)

## License

[MIT](LICENSE). Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Amazon, Flipkart and Meesho are trademarks of their respective owners; SellQuanta is not affiliated with or endorsed by them.
