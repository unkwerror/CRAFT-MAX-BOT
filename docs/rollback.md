# Rollback

Stage 3 forward migrations are expand-only. Application rollback changes the immutable release
pointer and the named API process; it intentionally leaves compatible forward migrations applied.
Do not run a down migration as part of a routine application rollback.

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

```bash
mkdir "$deploy_root/.deploy-lock"
trap 'rmdir "$deploy_root/.deploy-lock"' EXIT
bash "$deploy_root/current/deploy/rollback-stage3.sh" "$deploy_root" "$current_id"
curl -fsS http://127.0.0.1:4100/health/ready
curl -fsS https://craft72app.ru/release-id.txt
curl -fsS https://craft72app.ru/health/ready
```

The helper refuses an unexpected pointer or a missing predecessor, atomically changes only
`current`, and reloads only `craft72-max-api`. If the predecessor predates the API, it removes only
that named PM2 process. It does not modify the env, Nginx, database, backups or unrelated PM2 apps.

## Database restore (emergency only)

A restore discards current database state and requires an approved outage. Prefer an application
rollback because expand-only migrations remain compatible. Before restoring:

1. confirm the backup's release, age, checksum and `pg_restore --list` output;
2. create and verify a fresh emergency backup;
3. stop only `craft72-max-api` and prevent form submission at Nginx;
4. restore first into an isolated database and run migration/readiness checks;
5. record which post-backup applications will be lost.

For an approved in-place restore, keep the database URL out of the command line:

```bash
set +x
set -a
. /home/mun/apps/craft72-max-app/shared/.env 2>/dev/null
set +a
backup=/home/mun/apps/craft72-max-app/shared/backups/database/craft72-RELEASE.dump
test -r "$backup"
pg_restore --list "$backup" >/dev/null
pm2 stop craft72-max-api
PGDATABASE="$DATABASE_URL" pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges "$backup"
cd /home/mun/apps/craft72-max-app/current/api
NODE_ENV=production node run-migrations.mjs
CRAFT72_DEPLOY_ROOT=/home/mun/apps/craft72-max-app \
CRAFT72_ENV_FILE=/home/mun/apps/craft72-max-app/shared/.env \
pm2 startOrReload ../deploy/ecosystem.config.cjs --only craft72-max-api --update-env
unset DATABASE_URL
curl -fsS http://127.0.0.1:4100/health/ready
```

Then restore public traffic and verify the Mini App authentication, draft, verified contact and
owner-scoped submission paths. Preserve both the failed-state backup and restore audit record for
the approved retention period.

## Nginx rollback

The Stage 3 Nginx files are snippets merged into the existing Certbot TLS block. To reverse the
change, restore the single backed-up virtual-host file, remove only the two CRAFT72 snippet files,
then run `sudo nginx -t` before `sudo systemctl reload nginx`. Never replace Certbot certificate
files or modify another virtual host.
