# Infrastructure

Everything in this directory is real and runnable, with one exception — the
Cloudflare blueprint — which is labelled as such.

| Path | What it is |
|---|---|
| `docker/Dockerfile` | Production image: compiles native modules in a builder stage, ships a slim runtime. Single artifact for both API and worker. |
| `docker/docker-compose.yml` | Two services (API + worker) on one volume, one published port. |
| `systemd/cra-api.service` | Unit file for the API process on a bare VM. |
| `systemd/cra-worker.service` | Unit file for the worker process. |
| `backup.sh` | Nightly SQLite online backup + storage snapshot, with an integrity check and 14-day retention. |
| `Caddyfile` | TLS-terminating reverse proxy with automatic certificates. |
| `cloudflare/` | **Planned** Workers/D1/R2/Queues bindings — not deployed. Read its README. |

## Quickest production path

```bash
cd infra/docker
export SESSION_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
export APP_URL="https://cra.example.com"
docker compose up -d
docker compose logs -f api
```

Then:

- Create the admin account (add its address to `ADMIN_EMAILS` before signup).
- Point the GitHub App's webhook at `https://cra.example.com/api/v1/integrations/github/webhook`.
- Point Dodo's webhook at `https://cra.example.com/api/v1/billing/webhooks/dodo`.
- Install `backup.sh` and verify one restore before you need one.

Full walkthrough, including bare-metal and the ordering of integrations:
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).
