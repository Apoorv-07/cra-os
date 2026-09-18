# CRA Compliance Scan — GitHub Action

Scan a repository for **EU Cyber Resilience Act** readiness: build a CycloneDX
SBOM, match every component against OSV, GitHub Advisory, CISA KEV and EPSS,
score readiness across 35 controls, and fail the build on severity thresholds.

Needs an [CRA Compliance OS](https://cra.example.com) account and an API key
with the `scan` scope. Free tier includes credits to try it.

---

## Quick start

```yaml
name: CRA readiness

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  cra:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: CRA Compliance Scan
        id: cra
        uses: cra-compliance-os/cra-action@v1
        with:
          api-url: https://api.cracompliance.dev
          api-key: ${{ secrets.CRA_API_KEY }}
          fail-on: high
          fail-on-kev: 'true'

      - name: Upload SBOM
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: sbom
          path: ${{ steps.cra.outputs.sbom-path }}
```

The job exits non-zero when a finding at or above `fail-on` exists, when a
**known-exploited** (CISA KEV) vulnerability is present and `fail-on-kev` is
`true`, or when the readiness score drops below `min-readiness`.

---

## Inputs

| Input | Default | Description |
|---|---|---|
| `api-url` | `https://api.cracompliance.dev` | Base URL of your CRA Compliance OS deployment |
| `api-key` | *required* | Organisation API key with the `scan` scope. **Store it as a repository secret.** |
| `repository` | current repo | Repository in `owner/name` form |
| `path` | `.` | Subdirectory to scan |
| `fail-on` | `critical` | Fail when a finding at or above this severity exists: `critical`, `high`, `medium`, `low`, `none` |
| `fail-on-kev` | `true` | Always fail when a CISA KEV (known exploited) vulnerability is present |
| `min-readiness` | `0` | Fail when the readiness score is below this value (0–100). `0` disables |
| `upload-sbom` | `true` | Upload the generated CycloneDX SBOM as a workflow artifact |
| `comment-pr` | `false` | Post a summary comment on pull requests (needs `pull-requests: write`) |
| `github-token` | `${{ github.token }}` | Token used to write PR comments |
| `timeout` | `240` | Seconds to wait for the scan |

## Outputs

| Output | Description |
|---|---|
| `scan-id` | Identifier of the scan |
| `readiness-score` | CRA readiness score, 0–100 |
| `component-count` | Components discovered |
| `critical-count` / `high-count` | Findings at those severities |
| `known-exploited-count` | Findings in the CISA KEV catalogue |
| `sbom-url` / `sbom-path` | Generated CycloneDX SBOM |
| `dashboard-url` | Link to the scan in the dashboard |

Use them in later steps:

```yaml
- name: Gate the merge
  run: |
    echo "Readiness ${{ steps.cra.outputs.readiness-score }}"
    echo "Known exploited: ${{ steps.cra.outputs.known-exploited-count }}"
```

---

## Pull request comments

```yaml
- uses: cra-compliance-os/cra-action@v1
  with:
    api-key: ${{ secrets.CRA_API_KEY }}
    comment-pr: 'true'
permissions:
  contents: read
  pull-requests: write
```

The comment carries the score, the counts by severity, the known-exploited
list and the short list of what would move the score most.

---

## What it sends

The action builds a deterministic `.tar.gz` of the working tree — excluding
`.git`, `node_modules`, build output and other noise — and uploads it to
`POST /api/v1/ci/scan` along with the repository name, ref and commit sha.

**Your code is never executed.** The service reads manifests and lockfiles,
resolves components, matches advisories and returns the result. The archive is
size-capped and deleted after processing.

Supported ecosystems: **npm** (`package-lock.json`, `yarn.lock`,
`pnpm-lock.yaml`), **Python** (`requirements*.txt`, `poetry.lock`,
`pyproject.toml`), **Go** (`go.mod`, `go.sum`), **Rust** (`Cargo.lock`,
`Cargo.toml`), **Java** (`pom.xml`, Gradle coordinates), **PHP**
(`composer.lock`), **.NET** (`packages.lock.json`, `.csproj`), **Ruby**
(`Gemfile.lock`), and Dockerfile base images.

## Failure semantics

A CI action that fails with "undefined" is worse than no action, so:

- Every network call retries with backoff and reports the status code it got.
- If the API cannot be reached, the job **fails** — it does not report a clean
  scan.
- If credits run out, the job fails with `insufficient_credits` and the price of
  what was attempted. A failed scan is never charged.
- An unchanged repository is not charged (the resolved inventory is
  fingerprinted), so running on every push costs nothing when nothing changed.

## Building

```bash
node action/build.mjs     # bundles src/index.js → action/dist/index.js
```

The bundle is committed; CI verifies it is not stale. The action uses **Node 20
built-ins only** — no dependencies, so there is no install step and no supply
chain to audit.
