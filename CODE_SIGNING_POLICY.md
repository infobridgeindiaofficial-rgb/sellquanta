# Code Signing Policy

## Current status

SellQuanta Windows installers are currently **not code-signed**.
The project has **not** yet been approved by, and is not currently signed through, SignPath or any other code-signing service.
Windows SmartScreen may therefore warn when the installer is run.

## Planned policy

The project intends to apply for free code signing for open-source projects (for example via the SignPath Foundation).
If and when signing is approved, this document will be updated, and the following rules will apply:

- Only binaries built by the public GitHub Actions workflow from this repository's source code will be signed.
- Signing will happen only for releases built from the `main` branch or from release tags.
- No locally built or modified binaries will be signed.
- Signing credentials will never be stored in this repository.

## Roles

| Role | Who |
|---|---|
| Committers and reviewers | Maintainers of the [infobridgeindiaofficial-rgb/sellquanta](https://github.com/infobridgeindiaofficial-rgb/sellquanta) repository |
| Approvers (release signing requests) | Repository owner (InfoBridge India) |

All maintainers are expected to use multi-factor authentication on their GitHub accounts.

## Privacy

SellQuanta does not transfer any information to networked systems unless specifically requested by the user or the person installing or operating it.
It stores business data only on the local computer. The optional Ollama integration communicates only with the Ollama server URL configured by the user (by default the local machine, `127.0.0.1`).
