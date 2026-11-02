# Deploy

Push to `main` → `.github/workflows/deploy.yml` on the wefaber self-hosted runner → `bun install --frozen-lockfile`,
`bun run verify`, `bun run build`, `deploy/mydefense.sh <sha>`.

`mydefense.sh` is blue/green. The idle slot (`/home/hermes/apps/mydefense/{blue,green}`, ports 5191/5192) gets the
release, runs migrations and the idempotent Eternum seed against the shared database, starts as `mydefense@<slot>`
and must answer `/ready`. Then Nginx is pointed at it through `/etc/nginx/snippets/mydefense-active.conf`, and the
**public domain** `https://defense.eternum.lat` must answer `/ready` and `/`. If the domain fails, the script flips
back by itself. The previous slot keeps running: `deploy/mydefense.sh --rollback` flips back without rebuilding.

Migrations run while the previous slot still serves the same SQLite file: keep them expand/contract.

## One-time setup on the VPS

`mydefense.sh` runs a read-only preflight before it touches anything: it lists every item below that is missing (the
numbers match) and exits 1, so a first deploy on a bare VPS fails with the checklist instead of a systemd error.

1. Ports 5191/5192 free: `ss -ltn | grep -E ':519[12]'`.
2. `mkdir -p /home/hermes/apps/mydefense /home/hermes/data/mydefense /home/hermes/deploy/state/mydefense`
3. `~/deploy/env/mydefense.env` (secrets live here, never in the repo). Needs the four `MYDEFENSE_GITHUB_*` /
   `MYDEFENSE_PUBLIC_URL` variables together, plus `DEEPSEEK_API_KEY` for grading. `MYDEFENSE_PUBLIC_URL` is
   `https://defense.eternum.lat`; the GitHub OAuth callback is `https://defense.eternum.lat/auth/github/callback`.
4. `sudo cp deploy/mydefense@.service /etc/systemd/system/ && sudo systemctl daemon-reload`
5. Nginx: `deploy/nginx/defense.eternum.lat.conf` into `sites-available` + symlink, DNS for `defense.eternum.lat`, TLS
   like the other vhosts, and an initial `snippets/mydefense-active.conf` containing `set $mydefense_port 5191;`.
6. sudoers for the runner user, passwordless and limited to: `systemctl start|stop|status` on `mydefense@*`,
   `systemctl reload nginx`, `nginx -t`, and `tee /etc/nginx/snippets/mydefense-active.conf`.
7. Hourly backup: `sqlite3 /home/hermes/data/mydefense/mydefense.db "VACUUM INTO '/home/hermes/data/mydefense/backups/$(date +%F-%H).db'"`
   (cron/systemd timer). Uploaded materials live in `/home/hermes/data/mydefense/files`.

## Known gaps

- The scripts were written without access to the VPS. `mydefense.sh` is syntax-checked (`bash -n`) only; the first
  run on the VPS is the real test.
- `MYDEFENSE_ADMINS` (ADR 0003) is not built yet, so it has no effect in the env file.
