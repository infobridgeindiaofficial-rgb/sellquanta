# Security Policy

## Supported versions

Only the latest release built from the `main` branch receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately through GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the issue, affected version, and steps to reproduce.

Do not include real customer or business data in the report. We will acknowledge the report as soon as possible and coordinate a fix and disclosure with you.

## Scope notes

- SellQuanta runs locally. Its API listens on `127.0.0.1` only and is not intended to be exposed to a network.
- Business data is stored unencrypted in the user's data folder (`%APPDATA%\SellQuanta Data` for the installed app). Protect the Windows account and keep backups.
- The optional Ollama integration talks only to the configured local Ollama URL (default `http://127.0.0.1:11434`).
