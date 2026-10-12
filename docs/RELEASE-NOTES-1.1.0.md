SellQuanta 1.1.0 — release candidate, not published

Includes Agent Wallet date filters, read-only Sales & Returns Reports, Purchase Management and read-only Warehouse, consistent branded Excel exports, and Banking settlement reconciliation.

Adds Settings with Windows desktop update checks, authenticated release metadata, verified full-installer downloads, explicit download/install confirmation and a verified pre-update data backup. Existing v1.0.2 customers require a manual installer upgrade once; v1.0.2 has no updater.

Core features work without Ollama. Settings detects installation, running state and installed vision-model support, provides an official two-step setup guide, and tests the local connection. Starting Ollama requires explicit consent. SellQuanta never installs Ollama or downloads a model automatically.

Application identity and the existing %APPDATA%\SellQuanta Data database/backups/exports location are retained. Electron settings remain in %APPDATA%\SellQuanta. No bundled customer data or sample banking settlements.

This candidate installer is unsigned: no valid Windows code-signing certificate is available. Metadata authentication is not Windows Authenticode signing. Fresh installation, actual v1.0.2 installer upgrade, auto-update installation, SmartScreen behavior and uninstall/reinstall data preservation still require a disposable Windows test machine before production approval.
