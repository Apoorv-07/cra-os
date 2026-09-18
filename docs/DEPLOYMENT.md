# CRA Compliance OS — deployment runbook

Everything needed to take this from a clone to a running production system, in
the order you need it. Assumes a Linux host with Node 20+ and no prior
knowledge of the architecture.

---

## 1. What runs

| Piece | What it is | Command |
|---|---|---|
| **API** | Hono HTTP service. Serves `/api/v1/*`, `/health`, and the built frontend from `/` in production. | `npm run start` (in `apps/api`) |
| **Worker** | Background job runner: scans, SBOM generation, advisory sync, credit expiry. | `npm run worker` (in `apps/api`) |
| **Web** | Vite/React SPA. Built to static files that the API serves. | `npm run build` (in `apps/web`) |

In production the API serves the built frontend from one port, so there is one
origin, one cookie domain and no CORS. In development the two run separately
(web 5173 → API 8787) and Vite proxies `/api`.

There are two long-running processes in production: **the API and the worker**.
If the worker is not running, scans queue and never complete.

---

## 2. First-time setup

```bash
git clone <repo> && cd cra-compliance-os
npm install

cp .env.example .env
# then, at minimum:
openssl rand -hex 32   # → SESSION_SECRET
openssl rand -hex 32   # → ENCRYPTION_KEY

npm run db:migrate     # creates data/cra.db and applies migrations
npm run build          # builds the frontend into apps/web/dist
```

Then start both processes:

```bash
npm run start          # API on :8787
npm run worker         # worker, in a second process
```

Open `http://localhost:8787`. The first account you create is a normal user;
add its address to `ADMIN_EMAILS` before signup to get the admin console.

---

## 3. Database

SQLite (better-sqlite3), one file at `DATABASE_PATH` (default `data/cra.db`),
plus a `STORAGE_DIR` for artefacts.

- **Migrations** run automatically on boot and via `npm run db:migrate`. They
  are forward-only and additive; nothing is dropped or rewritten.
- **Backups**: the database is a single file, but copying it mid-write is not
  safe. Use SQLite's own backup API or stop the process first:
  ```bash
  sqlite3 data/cra.db ".backup '/backups/cra-$(date +%F).db'"
  ```
  Back up `data/storage` alongside it — evidence artefacts are referenced by
  checksum from the database.
- **WAL mode** is on. Do not copy `cra.db` without its `-wal`/`-shm` files
  while running; use the backup command above.

### Seeding

`npm run db:seed` creates the pricing catalogue, usage rules and the CRA
control catalogue. It is idempotent and safe to re-run: plans and packs are
matched by key, **prices an admin has changed are never overwritten**, and
catalogue copy is refreshed.

---

## 4. Environment

Full reference: [`.env.example`](../.env.example). The short version:

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` refuses to boot without `SESSION_SECRET` and `ENCRYPTION_KEY`. |
| `DATABASE_PATH` | Use a persistent volume in production. |
| `RUN_WORKER_IN_PROCESS` | `false` in production — run the worker separately so a deploy does not interrupt a long scan. |
| `PAYMENT_PROVIDER` | `manual` (no payments, credits granted by admin) or `dodo`. |
| `TRUST_PROXY` | Keep `true` behind any proxy or load balancer. |

Secrets are validated lazily, so a deployment without payments or AI works
without those keys; the moment a feature is used, it fails with a readable
message rather than a stack trace.

---

## 5. Production deployment

### Single node (smallest viable)

```bash
NODE_ENV=production \
RUN_WORKER_IN_PROCESS=false \
DATABASE_PATH=/var/lib/cra/cra.db \
APP_URL=https://cra.example.com \
WEB_URL=https://cra.example.com \
SESSION_SECRET=… ENCRYPTION_KEY=… \
node apps/api/dist/index.js

# second process
NODE_ENV=production DATABASE_PATH=/var/lib/cra/cra.db node apps/api/dist/worker-entry.js
```

Put both behind systemd (or a process manager) with `Restart=always`.

### After the first production deploy

- Replace the placeholder domain in `apps/web/public/sitemap.xml` and in
  `robots.txt` (if you add a `Sitemap:` line) with the real one, then submit the
  sitemap to Search Console. The guides at `/guides/*` are the SEO surface; they
  do nothing for you until a crawler can find them.
- Confirm `/robots.txt` is served and that `/app` is disallowed in it.

### Containers

The app needs no build-time secrets and no root. Mount two volumes:
`/var/lib/cra` (database) and `/var/lib/cra/storage` (artefacts). Expose one
port. Run two containers from the same image, one with `node dist/index.js`
and one with `node dist/worker-entry.js`.

### Cloudflare (the cost-scalable path)

The architecture is designed to run on Workers + D1 + R2 + Queues: the queue
interface (`src/jobs/queue.ts`) and storage interface (`src/core/storage.ts`)
are already abstracted behind that shape. Porting requires replacing the SQLite
and filesystem adapters with D1 and R2 and scheduling the worker on Queues.
**Do not attempt this until a single-node deployment is stable** — correctness
first, cost second.

---

## 6. Health checks

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness. Returns `{ status: 'ok' }`. |
| `GET /api/v1/health/detailed` | Database latency, table count, storage state, queue depth. |
| `GET /api/v1/admin/health` | Admin-only operational view. |

Point your load balancer at `/health`. Alert on the detailed endpoint when
queue depth grows monotonically — that means the worker has stopped.

---

## 7. Integrations, in the order you need them

1. **GitHub App** — create it, set the webhook URL to
   `https://<domain>/api/v1/integrations/github/webhook`, generate a webhook
   secret with `openssl rand -hex 32`, and set `GITHUB_APP_ID`,
   `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`.
   Without these, repositories can still be connected by uploading a source
   archive.
2. **Dodo Payments** — create a webhook at
   `https://<domain>/api/v1/billing/webhooks/dodo` subscribed to
   `payment.succeeded`, `payment.failed`, `subscription.active`,
   `subscription.cancelled`, `refund.succeeded`. Set `DODO_API_KEY`,
   `DODO_WEBHOOK_SECRET`, `DODO_ENV=live`. Webhook verification is mandatory
   whenever a secret is configured.
3. **Mail (Resend)** — required for magic links and invitations. Without it,
   set `MAIL_DRIVER=console` and read links from the server log.
4. **AI (optional)** — set `AI_PROVIDER` and the matching key. The product
   works fully with `AI_PROVIDER=none`; AI only improves drafting and
   classification.

---

## 8. Tests and checks

```bash
npm run typecheck          # both workspaces
npm run lint               # eslint, zero warnings allowed
npm run test               # unit + integration (269 tests)
npm run test:e2e           # full journey, including failure states (17 tests)
npm run build              # frontend + API
```

In CI, run them in that order: typecheck, lint, test, build. The e2e suite
takes ~15 seconds because it runs a real scan.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| Scans stay "queued" | The worker is not running. Start it, or set `RUN_WORKER_IN_PROCESS=true`. |
| `insufficient_credits` (402) on every action | `BILLING_ENABLED` is on and the balance is empty. Grant credits from the admin console. |
| Upload rejected as "not a valid gzip archive" | The file must be a `.tar.gz`. Create with `tar -czf repo.tar.gz .` |
| GitHub connect fails | Check `GITHUB_APP_PRIVATE_KEY` newlines and that the App is installed on the account. |
| Webhook 401s | The `DODO_WEBHOOK_SECRET` or `GITHUB_APP_WEBHOOK_SECRET` does not match the provider's. |
| 403 "organization in this request does not match" | The client sent an `X-Organization-Id` header that disagrees with the URL. This is deliberate. |
| Share link returns 404 | It was revoked, or it expired. Re-share from the report. |

---

## 10. Security notes for operators

- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- CSRF protection applies to state-changing requests from browsers.
- Rate limits are per IP, with a stricter bucket on authentication endpoints.
- Uploaded archives are validated by magic bytes, size-capped, extracted with
  per-file and total byte limits, and **never executed**.
- Secrets at rest (GitHub tokens) are encrypted with `ENCRYPTION_KEY`.
- Public share links expose the report and its evidence only — never billing,
  settings or raw vulnerability detail.
