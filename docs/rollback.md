# Rollback

Stage 5–6 forward migrations are expand-only. Application rollback changes the immutable release
pointer and only the named CRAFT72 API/worker processes; it intentionally leaves compatible forward
migrations applied. Do not run a down migration as part of a routine application rollback.

## Application rollback

Identify the current release and its recorded predecessor:

```bash
deploy_root=/home/mun/apps/craft72-max-app
current_target=$(readlink "$deploy_root/current")
current_id=${current_target#releases/}
test "$current_target" = "releases/$current_id"
test -s "$deploy_root/shared/deploy-state/$current_id.previous"
```

Acquire the same lock as deployment, run the release's guarded rollback helper, and always release
the lock:

If the MAX subscription is registered and the target release does not contain the Stage 4 webhook,
first run `current/scripts/max-webhook-subscription.sh unregister` under an approved change. MAX may
retry deliveries already in flight, so keep the Stage 4 endpoint available until its inbox has been
drained or account for those retries in the incident plan. A Stage 4-to-Stage 4 rollback keeps the
subscription registered.

```bash
mkdir "$deploy_root/.deploy-lock"
trap 'rmdir "$deploy_root/.deploy-lock"' EXIT
bash "$deploy_root/current/deploy/rollback-stage3.sh" "$deploy_root" "$current_id"
curl -fsS http://127.0.0.1:4100/health/ready
pm2 describe craft72-max-api
if grep -Fq craft72-max-worker "$deploy_root/current/deploy/ecosystem.config.cjs"; then
  pm2 describe craft72-max-worker
fi
curl -fsS https://craft72app.ru/release-id.txt
curl -fsS https://craft72app.ru/health/ready
```

The helper refuses an unexpected pointer or a missing predecessor, atomically changes only
`current`, and reloads only `craft72-max-api` and `craft72-max-worker`. If the predecessor is a
Stage 3 release without the worker, it reloads only the API and removes only the CRAFT72 worker. If
the predecessor predates the API, it removes both named CRAFT72 processes. It does not modify the
env, Nginx, database, backups or unrelated PM2 apps. The `rollback-stage3.sh` filename is retained
for compatibility with existing immutable releases; its Stage 4 behavior is process-aware.

A rollback to Stage 4 leaves the private upload directory and new tables intact but disables the
new upload/scan routes and Tracker loop. Do not delete quarantine files, run the Stage 5/6 down SQL
or flip Tracker write flags during an incident rollback. Record pending scan/outbox counts and return
to a fixed Stage 5/6 release before accepting new file submissions. Because Stage 6 deploys with
Tracker dry-run, routine rollback has no external Tracker objects to undo.

## Database restore (emergency only)

A restore discards current database state and requires an approved outage. Prefer an application
rollback because expand-only migrations remain compatible. Before restoring:

1. confirm the backup's release, age, checksum and `pg_restore --list` output;
2. create and verify a fresh emergency backup;
3. stop only `craft72-max-api` and `craft72-max-worker`, then prevent form and webhook traffic at
   Nginx;
4. restore first into an isolated database and run migration/readiness checks;
5. record which post-backup applications will be lost.

For an approved in-place restore, keep the database URL out of the command line:

```bash
set +x
set -a
. /home/mun/apps/craft72-max-app/shared/.env 2>/dev/null
set +a
pattern='^postgres(ql)?://([A-Za-z_][A-Za-z0-9_-]*):([A-Za-z0-9._~-]+)@127[.]0[.]0[.]1:5432/([A-Za-z_][A-Za-z0-9_-]*)$'
[[ "$DATABASE_URL" =~ $pattern ]]
export PGHOST=127.0.0.1 PGPORT=5432
export PGUSER="${BASH_REMATCH[2]}" PGPASSWORD="${BASH_REMATCH[3]}" PGDATABASE="${BASH_REMATCH[4]}"
unset MAX_BOT_TOKEN MAX_WEBHOOK_SECRET TRACKER_TOKEN
backup=/home/mun/apps/craft72-max-app/shared/backups/database/craft72-RELEASE.dump
test -r "$backup"
pg_restore --list "$backup" >/dev/null
pm2 stop craft72-max-api craft72-max-worker
pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges "$backup"
cd /home/mun/apps/craft72-max-app/current/api
NODE_ENV=production node run-migrations.mjs
CRAFT72_DEPLOY_ROOT=/home/mun/apps/craft72-max-app \
CRAFT72_ENV_FILE=/home/mun/apps/craft72-max-app/shared/.env \
pm2 startOrReload ../deploy/ecosystem.config.cjs \
  --only craft72-max-api,craft72-max-worker --update-env
unset DATABASE_URL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
curl -fsS http://127.0.0.1:4100/health/ready
worker_pid=$(pm2 pid craft72-max-worker 2>/dev/null)
[[ "$worker_pid" =~ ^[1-9][0-9]*$ ]]
```

Then restore public traffic and verify the Mini App authentication, draft, verified contact and
owner-scoped submission paths. Verify a webhook fixture is accepted exactly once and its outbound
action reaches a terminal state before restoring public webhook traffic. Preserve both the
failed-state backup and restore audit record for the approved retention period.

## Nginx rollback

The Stage 4 Nginx files are snippets merged into the existing Certbot TLS block. The installed
`craft72app.ru-stage3.conf` name is retained as a compatibility path even though its content includes
the Stage 4 webhook route. To reverse the change, restore the single backed-up virtual-host file,
remove only the two CRAFT72 snippet files, then run `sudo nginx -t` before
`sudo systemctl reload nginx`. Never replace Certbot certificate files or modify another virtual
host.
