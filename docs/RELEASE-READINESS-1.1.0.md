# SellQuanta 1.1.0 release preparation — HOLD

Prepared locally on 12 October 2026. No production merge, release/tag, installer publication, website deployment or customer notification was performed. The working application on port 8787 and its business file were left unchanged. No disposable Windows VM or separate test PC is available; actual installation tests remain mandatory before production approval.

## Public version and dependency order

Current published release: **v1.0.2**, published 24 September 2026. Proposed unused version: **1.1.0** (features plus updater and optional AI setup). The exact public installer was downloaded, its published digest verified and its application source extracted without executing the installer.

Public v1.0.2: `SellQuanta-Setup-1.0.2.exe`, 115,262,272 bytes; SHA-256 `56cc96e19cc5a7073f088dfd6b576a3982c7ceef50be87cbb5df0290c0b22870`. Authenticode: **NotSigned**. A similarly named older local build has a different checksum and was not used as the release baseline.

All five feature PRs were open and unmerged at audit time. Each branch is an ancestor of the next; the local candidate starts from PR #5, so it contains all five without a production merge:

| Order | PR | Feature | Base / feature commit |
|---|---|---|---|
| 1 | [#1](https://github.com/infobridgeindiaofficial-rgb/sellquanta/pull/1) | Agent Wallet filters | main / 2155a8d |
| 2 | [#2](https://github.com/infobridgeindiaofficial-rgb/sellquanta/pull/2) | Reports | PR #1 / a42747e |
| 3 | [#3](https://github.com/infobridgeindiaofficial-rgb/sellquanta/pull/3) | Purchase Management, read-only Warehouse | PR #2 / f54511f |
| 4 | [#4](https://github.com/infobridgeindiaofficial-rgb/sellquanta/pull/4) | Unified Excel branding | PR #3 / cf7a1fe |
| 5 | [#5](https://github.com/infobridgeindiaofficial-rgb/sellquanta/pull/5) | Banking | PR #4 / fa6a5c2 |

Release work is on local branch `release/1.1.0-preparation`, not main. Recheck PR states and version availability immediately before any approved integration. For stacked PRs, merge #1 then retarget #2 to main, merge #2, and continue #3 → #4 → #5; validate each step and the final tree. Do not infer approval from an open PR or a local passing test.

## Installer, identity and existing-user compatibility

Windows x64 full NSIS installer; Electron 44.4.5, electron-builder 26.17.0 after compatible dependency updates. Per-user wizard with installation-folder choice and Desktop/Start shortcuts. Preserve `com.sellquanta.desktop`, `SellQuanta`, executable name and NSIS identity. Business data remains `%APPDATA%\SellQuanta Data` (data, backups, exports); Electron profile/settings/logs remain `%APPDATA%\SellQuanta`. Typical application installation is `%LOCALAPPDATA%\Programs\SellQuanta`.

The exact public v1.0.2 has no electron-updater dependency, updater code or update metadata. It cannot receive automatic updates. Customers need one **manual** NSIS upgrade using the official download page, with the app closed and an independent backup first. This PC's Windows uninstall registry and installed application package both report 1.0.2; that installation was not upgraded or uninstalled. Other customers' installation versions cannot be established without their devices; there is no customer telemetry inventory. After upgrading, the new updater supports future releases.

The candidate retains `deleteAppDataOnUninstall: false`, the existing uninstaller safety notice, verified copy-only legacy import and backend ownership/single-instance protections. It neither bundles customer databases nor changes financial formulas. The exact installed Windows upgrade behavior still needs testing.

No valid Windows code-signing certificate was found. The local candidate is **unsigned**. Ed25519 metadata authentication is a separate protection and is not Authenticode signing. Never label this installer signed or instruct users to disable Windows security.

## Update architecture and operational requirements

Generic HTTPS feed: `https://infobridgeindia.online/sellquanta-updates/`. Startup and six-hour checks, signed plain-text release notes, explicit download confirmation, explicit installation confirmation. Ordinary quit does not install. Offline/invalid feeds show an error plus the manual download link; core features remain available.

`latest.json` contains an Ed25519 signature covering version, exact release URL, size, SHA-256, SHA-512, release notes and date. `latest.yml` must match it exactly. Stable versions only; no downgrades or web installers. Full NSIS downloads avoid old blockmap assumptions. Digests are checked after downloading and again before installation. Preload exposes only guarded update IPC to the app's main localhost frame, with renderer Node access disabled. An explicit install stops only the app-owned engine, creates a verified JSON backup under `backups/updates`, then invokes the installer. Backup failure prevents installation and restores the engine; synchronous installer failure is surfaced and restores the engine. Actual Windows updater handoff must still be tested.

The public verification key is packaged. The private key stays outside the repository, encrypted with Windows CurrentUser DPAPI. No private key is committed or bundled. The local signing wrapper passes a decrypted key only to the metadata-generation child process and clears it afterward. Secure offline recovery of the signing key must be arranged; loss requires a manual trust-key migration. Do not regenerate the embedded public key inadvertently. No signing secret has been uploaded to GitHub.

`tools/prepareRelease.mjs` generates authenticated JSON, matching YAML, SHA-256 checksum, checksum JSON and notes for the exact final installer. It refuses unsigned metadata and overwriting existing output. Rebuilding or Authenticode-signing an installer changes its digest: regenerate all metadata afterward. The workflow is preparation-only with a read-only token and artifact upload; tags no longer publish automatically in this candidate. No remote workflow was run.

## Website and hosting

`infobridgeindia.online` is GitHub Pages from `infobridgeindiaofficial-rgb/InfobridgeIndia`, main/root, with Cloudflare in front and HTTPS enabled. Existing installers use GitHub Releases. Website changes are staged only in a separate local checkout and branch; the live download remains v1.0.2.

The staged page offers Standard and a guided two-step Ollama setup. Both use the same SellQuanta installer; Ollama comes only from its official site. The unpublished candidate download is disabled. Before approved publication, set the exact release URL, size, checksum and version, then verify both choices and external links. Privacy text discloses update metadata requests/IP connection information; no business-data uploads. Security text does not recommend disabling Defender or bypassing warnings.

Host the installer and optional blockmap on GitHub Releases, not in the Pages repository. Host only tiny `latest.json` and `latest.yml` feed files on Pages. GitHub documents a limit of 2 GiB per release asset with no total-release/bandwidth limit; normal service policies still apply. This candidate is approximately 122 MiB compressed and 393 MiB unpacked, excluding business data. Allow space for the old installation, downloaded installer, new extracted application and data backup during upgrades; at least 1 GB free application/cache space plus business-backup size is prudent.

After approval, upload the exact tested installer/checksum first, then matching native YAML and signed JSON; verify HTTPS responses, digests and source commit. Ensure Cloudflare does not cache inconsistent update-feed versions (scope cache handling to `/sellquanta-updates/*`), purge old feed copies and check from another network. Never point metadata at missing assets or publish an unrelated builder-generated feed. No paid hosting or Ollama bundle is required.

## Optional Ollama

Settings performs read-only installed/running/model checks and a connection test. An optional service-start button requires both a trusted local Settings origin and explicit confirmation; no automatic installation, model pull or startup spawn remains. All configured AI URLs and newly started service bindings are loopback-only. Existing running Ollama instances are not restarted or reinstalled.

Official Windows requirements include Windows 10 22H2 or newer, compatible GPU drivers when using a GPU and about 4 GB installation space. The starting model `qwen2.5vl:3b` is a separate 3.2 GB download; allow at least 12 GB free disk including working space. The 7B option is 6.0 GB. The 8 GB minimum / 16 GB preferred / 32 GB optional 7B RAM guidance is a conservative application recommendation, not a performance guarantee; available memory and GPU support matter. Model family requires Ollama 0.7.0 or later.

Setup: install Standard → open Settings → skip Ollama installation if already installed → otherwise choose its official installer → explicitly start it if needed → choose whether to manually run `ollama pull qwen2.5vl:3b` → Test Connection → review a non-sensitive sample label before saving. Ollama's own installer may start its service with the user's installation consent. SellQuanta does not execute the model-pull command.

## Validation evidence and remaining blockers

| Check | Result |
|---|---|
| Complete app test suite | 145 passed, zero failed/skipped |
| Frontend production build | Passed; existing large-bundle advisory remains |
| Runtime production npm audit | Zero advisories |
| Client npm audit | Zero advisories |
| Build/dev dependency audit | Eight moderate advisories remain; review before release, no forced major downgrade applied |
| Windows NSIS build | Passed locally; unsigned |
| Metadata/package integrity | Passed for actual final installer |
| Real NSIS updater check/download | Passed with isolated loopback fixture transport, no installer execution or quit handler |
| Packaged Electron Node backend | Healthy without Ollama; real 5-sheet Reports and 3-sheet Banking downloads passed |
| Live isolated preview / exports / backup | HTTP 200; fixture records unchanged |
| Exact public backend → new backend | Fourteen synthetic collections preserved; not an installer upgrade |
| Ollama running vision model | Synthetic image decoded correct order, SKU, quantity 2 and INR 249.50; no sale saved |
| Ollama unavailable | Backend healthy, AI unreachable, no service started |
| Staged website tests | Two focused tests passed; full site baseline 967/975 passed, same eight failures before/after changes |
| Browser visual inspection | Not completed: computer-use approval timed out and in-app browser unavailable |
| Production safety | Port 8787 owner unchanged; business file byte-for-byte unchanged |

The website's eight pre-existing failures are in GST print, module-access guard (two), public Terms/Privacy (two), generated route/asset validation and sales dashboard (two). No unrelated website features were changed to conceal them.

**Release remains on HOLD** until a disposable Windows environment tests: fresh install without Ollama; manual upgrade from the verified public v1.0.2 installer with populated synthetic history/settings/images/backups; a real future-version auto-update over trusted HTTPS through download/confirmation/close/install/relaunch; cancellation/offline/tampered feed; uninstall/reinstall; backup and restoration; Defender/SmartScreen behavior. Also complete browser/responsive visual inspection, review remaining build advisories, resolve or explicitly assess pre-existing website failures, and verify the deployed feed only after publication is approved. None of these installer tests may run against the working business installation.

## Rollback and exact approval boundary

Keep the verified v1.0.2 installer, candidate source commit, all checksums and independent backups. Before each real update test record database hash, all collection counts, stock/wallet/banking totals and settings; reconcile after upgrade/relaunch and restore a fixture backup to a separate path. The updater's pre-update snapshot is additional protection, not a replacement for independent backups.

If a release is defective, stop offering it in the feed and website. Prefer a higher-version fix/revert (for example 1.1.1) that retains the compatible data schema; automatic downgrade is rejected. Never silently restore an old backup over records entered after upgrading. Any manual downgrade must first preserve current data separately and verify schema compatibility on the disposable machine. Production data restoration needs specific user approval and reconciliation.

After blockers are resolved, obtain explicit approval for: pushing the prepared branches; integrating PRs #1–#5 and release changes into main in order; configuring signing/key recovery or CI secrets; tagging and publishing the exact installer/metadata; updating the live website and its scoped cache rules; and any customer notification. No paid purchase, release or notification is authorized by preparation alone.

Sources: [Electron Builder v26 auto-update](https://www.electron.build/v26/docs/features/auto-update/), [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [Ollama Windows](https://docs.ollama.com/windows), [vision-model tags](https://ollama.com/library/qwen2.5vl/tags), [SheetJS installation](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), [PDF.js advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j).
