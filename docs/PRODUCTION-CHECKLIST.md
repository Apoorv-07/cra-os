# Production checklist

Work through this before real users. Every line is something that, if skipped,
will fail at the worst possible moment. Tick as you go.

---

## 0. Before you deploy anything

- [ ] `npm install` then `npm run typecheck && npm run lint && npm run test && npm run test:e2e` — all green.
- [ ] `npm run build` succeeds for both workspaces.
- [ ] `node_modules`, `data/`, `.env` are **not** in the git tree (`git status` is clean of them).
- [ ] No secret has ever been committed. If one has, rotate it — deleting the commit does not un-leak it.

## 1. Host and process

- [ ] Node 20+ on the host.
- [ ] Two processes configured: **API** and **worker** (`RUN_WORKER_IN_PROCESS=false`).
- [ ] Both restart on failure (systemd `Restart=always`, or Compose `restart: unless-stopped`).
- [ ] `DATABASE_PATH` and `STORAGE_DIR` point at a **persistent volume**, not the container filesystem.
- [ ] The volume is on a disk with enough room for growth (components + evidence per scan).
- [ ] Time on the host is NTP-synced — regulatory clocks depend on it.
- [ ] Timezone is UTC. The application stores UTC internally; this just keeps logs sane.

## 2. Secrets

- [ ] `SESSION_SECRET` — `openssl rand -hex 32`. Rotating signs everyone out.
- [ ] `ENCRYPTION_KEY` — `openssl rand -hex 32`. **Rotating makes stored GitHub tokens unreadable; revoke and reconnect integrations after any rotation.**
- [ ] Both injected as environment variables (or Docker/Compose secrets), never written into the image.
- [ ] A secret inventory exists somewhere you can find it at 2 a.m.

## 3. Security

- [ ] `NODE_ENV=production` — the app refuses to boot without the two secrets above.
- [ ] `APP_URL` and `WEB_URL` are `https://` and match the real domain.
- [ ] `TRUST_PROXY=true`, because there is a proxy in front.
- [ ] TLS terminates in front (Caddy/nginx/load balancer); HSTS is on only in production, which the app does automatically.
- [ ] Rate limits reviewed: `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_S`, plus the built-in auth bucket (10/min) and expensive-action bucket (20/min).
- [ ] `MAX_UPLOAD_BYTES` appropriate for your plan (default 25 MB).
- [ ] The host's firewall exposes only 80/443 and SSH.
- [ ] SSH is key-only.
- [ ] Backups encrypted at rest if they leave the host.

## 4. Database

- [ ] Migrations apply at boot — confirm the log line `database ready`.
- [ ] `npm run db:seed` has populated the control catalogue and pricing (check `GET /api/v1/billing/pricing`).
- [ ] `infra/backup.sh` installed on a nightly cron.
- [ ] **One restore has actually been performed.** An untested backup is not a backup.
- [ ] Backups are copied off the host (object storage, another provider, another region).
- [ ] Retention configured to match what you promise customers (`organizations.retention_days`).

## 5. Integrations, in order

- [ ] **GitHub App** created with Contents (read) and Metadata (read) only.
- [ ] Webhook URL set to `https://<domain>/api/v1/integrations/github/webhook`.
- [ ] `GITHUB_APP_WEBHOOK_SECRET` matches the value configured in GitHub (`openssl rand -hex 32`).
- [ ] `GITHUB_APP_PRIVATE_KEY` has real newlines, not literal `\n`, in whatever secret store you use.
- [ ] App installed on your own account and one push triggers a scan (watch the worker log).
- [ ] **Payments**: Dodo webhook at `https://<domain>/api/v1/billing/webhooks/dodo`, subscribed to `payment.succeeded`, `payment.failed`, `subscription.active`, `subscription.cancelled`, `refund.succeeded`.
- [ ] `DODO_WEBHOOK_SECRET` set — with a secret configured, **unverified webhooks are rejected**.
- [ ] One **live** end-to-end purchase completed and credits landed in the ledger.
- [ ] **Mail**: `MAIL_DRIVER=resend` with a verified sending domain; a magic link actually arrives.
- [ ] **AI** (optional): provider and key set, or explicitly `none`.

## 6. Observability

- [ ] `GET /health` is the load balancer's health check.
- [ ] `GET /api/v1/health/detailed` is polled somewhere and alerts on:
  - [ ] database errors,
  - [ ] **queue depth growing monotonically** (the worker has stopped),
  - [ ] storage errors.
- [ ] Logs are shipped off the host (they contain security events).
- [ ] An alert exists on 5xx rate.
- [ ] Someone is on the other end of those alerts.

## 7. Verification against the running system

Run these and read the output; do not assume.

- [ ] `./scripts/smoke.sh` passes against production (it creates an account — use a throwaway address).
- [ ] Sign up → connect repo → scan completes → SBOM downloads and validates as CycloneDX 1.6.
- [ ] Credit balance decreases after a scan and matches the ledger
      (`GET /organizations/:orgId/billing/integrity` → `consistent: true`).
- [ ] An Article 14 incident shows the 24 h early warning and 72 h notification deadlines, and that the 14-day final report clock only starts once a corrective measure is recorded.
- [ ] A report share link opens **in a private window without logging in**.
- [ ] A second organisation cannot see the first one's data (404/403 as appropriate).
- [ ] Deleting an organisation removes its data.
- [ ] `npm run test:e2e` passes against the production build on a staging copy.

## 8. Launch day

- [ ] Admin account exists and can reach `/app/admin`.
- [ ] `ADMIN_EMAILS` set before that account signed up.
- [ ] Pricing is what you intend to charge (`GET /api/v1/billing/pricing`) — these are admin-editable without a deploy, so check the live values, not the seed file.
- [ ] `PUBLIC_SIGNUP_CREDITS` set to the free tier you advertised (default 250).
- [ ] Status page or a documented way to say "we're down".
- [ ] Rollback plan: previous image tag and a database backup from before the deploy.
- [ ] You know how long a rollback takes, because you timed it.

## 9. First week

- [ ] Watch queue depth and 5xx daily.
- [ ] Watch the funnel at `GET /api/v1/admin/funnel`: signup → connect → scan → report → purchase.
- [ ] Review the DLQ (`GET /api/v1/admin/jobs/dead-letter`) daily; every entry is a bug or a hostile input.
- [ ] Review failed payments and failed webhook deliveries.
- [ ] Read the first ten support emails before building anything new.

## 10. Legal and trust (do not skip, do not overclaim)

- [ ] Privacy Policy, Terms, Security page, DPA and Subprocessor list published.
- [ ] The copy states plainly that reports are **engineering evidence, not legal advice** — the product already says this in generated documents; keep the marketing consistent with it.
- [ ] No certification claims (no "CRA certified", no "ISO 27001 certified") unless a real certificate exists.
- [ ] Data deletion path works and is documented.
- [ ] A security contact address is published.
