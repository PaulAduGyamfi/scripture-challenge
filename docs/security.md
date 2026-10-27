# Security

What protects the supply chain and the repo, the known dependency advisories, and what we're doing
about each. Last checked **2026-10-27** with `npm audit --omit=dev` against `package-lock.json`.

## The rule: never run `npm audit fix --force`

npm's only suggested fix for most of the advisories below is `npm audit fix --force`, which would
**replace `whatsapp-web.js` 1.34.7 with the older 1.34.2**. That's a downgrade of the library the whole
bot depends on, and it's untested with this code. Never run it (AGENTS.md Never 1). Plain `npm audit fix`
or a targeted `npm update <package>` is fine in a PR that runs every check.

## What runs automatically

| Check | Where | Fails the build? |
|---|---|---|
| `npm audit --omit=dev --audit-level=high` | CI `security` job, every push and PR | **No**, report only (`continue-on-error`), because of the known advisories below. The counts appear in the job summary |
| gitleaks 8.30.1 (binary checksum verified) on the PR's commits, or the pushed commits | CI `security` job | **Yes**, on any finding (shown redacted) |
| GitHub secret scanning and push protection | GitHub, on every push | Push protection blocks pushes containing known token formats |
| Dependabot version updates (`.github/dependabot.yml`) | GitHub, weekly | No. It opens PRs: one grouped PR for minor and patch dev dependencies, one each for runtime dependencies and majors, and updates for the SHA-pinned actions |

Not on yet (settings only the maintainer can change, in Settings → Code security):
**Dependabot alerts** and **Dependabot security updates**. TODO(owner): turn both on.

## Current advisories (production dependencies)

11 entries, all high, 0 critical (down from 12; `ip-address` is fixed). Most are one problem: `whatsapp-web.js` 1.34.7 (the latest
release) pins `puppeteer` 24.38.0 exactly, and the vulnerable packages sit under puppeteer.

| Package | Severity | Direct? | Advisory | Path | Fix npm offers |
|---|---|---|---|---|---|
| `extract-zip` 2.0.1 | high | no | GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3 (symlink path traversal and arbitrary file write while unpacking) | puppeteer → @puppeteer/browsers | `--force` only |
| `basic-ftp` 5.3.1 | high | no | GHSA-c475-qrg2-pj4r (CPU denial of service parsing FTP directory listings) | puppeteer → @puppeteer/browsers → proxy-agent → pac-proxy-agent → get-uri | `--force` only |
| `get-uri`, `pac-proxy-agent`, `proxy-agent` | high | no | via `basic-ftp` | as above | `--force` only |
| `@puppeteer/browsers`, `puppeteer`, `puppeteer-core` | high | no | via `extract-zip`, `proxy-agent`, `chromium-bidi` | whatsapp-web.js → puppeteer | `--force` only |
| `whatsapp-web.js` 1.34.7 | high | **yes** | via `puppeteer` | n/a | `--force` (the downgrade above) |
| `chromium-bidi` 14.0.0 | high | no | via its own `zod` 3.25.76 (GHSA-mrhx-c7xc-m3w5) | puppeteer → chromium-bidi | `--force` only |
| `zod` 3.25.76 (under chromium-bidi) | high | no | GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections) | puppeteer → chromium-bidi | `--force` only. Our own copy is fixed: 4.6.7 since 2026-10-27 |

Fixed by Dependabot updates on 2026-10-27: `ip-address` 10.7.2 → 10.7.5 (GHSA-rxp7-6hxx-x8q5, #23) and
`vite` 8.3.2 → 8.3.5 (six dev-only advisories, #24). A full `npm audit` now reports the same 11 as the
production one.

## Are they reachable in our use?

Checked by reading the installed packages:

- **`extract-zip`, `proxy-agent` and everything under it** (`pac-proxy-agent`, `get-uri`, `basic-ftp`,
  `ip-address`) are used only by `@puppeteer/browsers` to download and unpack browsers
  (`unpackArchive`, `downloadFile`).
  - **At runtime: not reachable.** whatsapp-web.js calls `puppeteer.launch`, which starts the Chrome
    that's already installed. It downloads nothing, and we configure no proxy or PAC file.
  - **At install: reachable on the server.** puppeteer's `postinstall` (`node install.mjs`) downloads
    Chrome during `npm ci`. CI skips this (`PUPPETEER_SKIP_DOWNLOAD`), but `scripts/deploy.sh` doesn't,
    so on the server it runs during every deploy, as root. Exploiting it would still mean tampering
    with the Chrome download.
- **`chromium-bidi` (and its `zod` 3): not reachable.** puppeteer loads it only for the WebDriver BiDi
  protocol, which it uses by default for Firefox. Chrome uses CDP.
- **Top-level `zod`: fixed.** Upgraded from 4.6.5 to 4.6.7, which includes the fix. It validates `state.json`,
  sheet rows and short AI JSON replies, and is also what the Anthropic SDK uses. Only the copy under
  `chromium-bidi` is still affected, and that one isn't reachable (above).

## Harmless lockfile churn in Dependabot PRs

Dependabot's npm PRs (e.g. #20, #22) also remove `"dev": true` from about 20 lockfile entries:
TypeScript 7's prebuilt platform binaries (`@typescript/typescript-<platform>`). That's expected
and harmless:

- `typescript` is our dev dependency, but it's also an optional peer dependency of `cosmiconfig`,
  which reaches production through whatsapp-web.js → puppeteer → cosmiconfig (`npm explain typescript`).
  Because of that shared link, npm versions disagree on whether its binaries count as dev-only.
  Our local npm (10.9.8) marks them `dev`, and Dependabot's doesn't.
- Nothing we run depends on the flag. `deploy.sh` runs a full `npm ci`, not `--omit=dev`, and
  none of these packages has advisories, so `npm audit --omit=dev` reports the same either way.

So review a Dependabot PR on its real change (the package and version it bumps). These lines can be ignored.

## Plan

| Advisory | Plan | Status |
|---|---|---|
| puppeteer chain (10 entries) | Wait for a whatsapp-web.js release on puppeteer ≥25.13; Dependabot will open the PR. Until then it's install-time only (above). Optionally, test an npm `overrides` entry forcing a fixed puppeteer, in its own PR with a real WhatsApp check | TODO(owner): decide whether to try the override |
| install-time exposure on the server | Consider installing Chrome once on the server and setting `PUPPETEER_SKIP_DOWNLOAD=true` in `deploy.sh` (only the maintainer edits `deploy.sh`) | TODO(owner) |
| `ip-address` | Updated to 10.7.5 (Dependabot #23) | **Done** (2026-10-27) |
| top-level `zod` | Upgraded to 4.6.7. The copy under chromium-bidi stays until puppeteer updates | **Done** (2026-10-27) |
| `vite` (dev only) | Updated to 8.3.5 (Dependabot #24) | **Done** (2026-10-27) |
| `@anthropic-ai/sdk` 0.131.0 → 1.3.0 (Dependabot #21) | Not an advisory, but a major version whose only listed breaking change is a new API version (2026-10-21). The tests mock the SDK, so make one real call before the next deploy (`aiReadGuess` and `celebrate`) | TODO(owner) |

When an entry is fixed, update the table above and the date at the top. Once production `npm audit`
reports no high advisories, the `security` job's audit step can stop being report-only.
