# Operations

All commands in this runbook are scoped to the CRAFT72 MAX application. Do not restart unrelated
PM2 processes, inspect another database, run `pm2 save`, or print `shared/.env`.

## Routine health and logs

```bash
curl -fsS https://craft72app.ru/health/live
curl -fsS https://craft72app.ru/health/ready
pm2 describe craft72-max-api
pm2 logs craft72-max-api --lines 100 --nostream
```

Liveness proves that the HTTP process is running; readiness additionally proves its required
dependencies. Neither endpoint may contain configuration or personal data. Application logging
redacts authorization, cookies and request bodies. Treat every log as confidential anyway: phone
numbers, email addresses, form text, signed MAX data, tokens and material links must never be added
to ad-hoc logs.

The PM2 ecosystem writes only this application's files to `shared/logs/api.log` and
`shared/logs/api-error.log`. The supplied logrotate rule rotates daily, compresses old files and
caps them at 90 days. If `LOG_RETENTION_DAYS` is reduced below 90, update the rule's `rotate` and
`maxage` values to the same or smaller number, run `logrotate --debug`, then install it.

## Database backups

Every deployment creates `shared/backups/database/craft72-<release>.dump` before migrations. Create
an additional backup before an operational database change without exposing the connection URL on
the process command line:

```bash
set +x
set -a
. /home/mun/apps/craft72-max-app/shared/.env 2>/dev/null
set +a
pattern='^postgres(ql)?://([A-Za-z_][A-Za-z0-9_-]*):([A-Za-z0-9._~-]+)@127[.]0[.]0[.]1:5432/([A-Za-z_][A-Za-z0-9_-]*)$'
[[ "$DATABASE_URL" =~ $pattern ]]
export PGHOST=127.0.0.1 PGPORT=5432
export PGUSER="${BASH_REMATCH[2]}" PGPASSWORD="${BASH_REMATCH[3]}" PGDATABASE="${BASH_REMATCH[4]}"
unset DATABASE_URL MAX_BOT_TOKEN MAX_WEBHOOK_SECRET TRACKER_TOKEN
umask 077
backup=/home/mun/apps/craft72-max-app/shared/backups/database/craft72-manual-$(date -u +%Y%m%dT%H%M%SZ).dump
pg_dump --format=custom --compress=6 --file="$backup"
test -s "$backup"
chmod 600 "$backup"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
```

Backups stay on the application server for at most `BACKUP_RETENTION_DAYS` (policy maximum: 30).
Copy an encrypted backup to the approved off-host storage, restrict access to designated operators,
and test a restore into an isolated database at least quarterly. A backup is not considered valid
until `pg_restore --list` succeeds and a test restore passes readiness checks.

## Retention cleanup

Run the immutable release helper at least hourly from the `mun` crontab:

```cron
17 * * * * /home/mun/apps/craft72-max-app/current/scripts/cleanup-stage3-retention.sh >>/home/mun/apps/craft72-max-app/shared/logs/retention.log 2>&1
```

The helper has its own non-blocking lock and uses `RETENTION_CLEANUP_INTERVAL_SECONDS` plus a
last-success marker, so the frequent cron entry does not shorten the configured interval. It:

- removes expired drafts and stale sessions;
- removes webhook/security records at `LOG_RETENTION_DAYS`, never above 90 days;
- removes applications at `SUBMISSION_RETENTION_DAYS`, never above 1095 days, with dependent rows;
- removes unreferenced MAX user rows and backup files at `BACKUP_RETENTION_DAYS`, never above 30 days.

Test configuration and execute once after installation:

```bash
/home/mun/apps/craft72-max-app/current/scripts/cleanup-stage3-retention.sh --force
```

An invalid or policy-exceeding setting makes cleanup fail closed. Alert on a missing recent
`shared/retention/last-success.epoch`, database errors, a failed backup or readiness failures.

## Release and backup retention

Keep at least the current and two previous immutable application releases. After a successful
backup and restore test, list candidates without following symlinks:

```bash
readlink /home/mun/apps/craft72-max-app/current
find /home/mun/apps/craft72-max-app/releases -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
```

Delete a release only after confirming it is neither `current` nor the previous target recorded in
`shared/deploy-state`. Release cleanup never deletes `shared`, database backups or the production
env. Use a documented change ticket for manual deletion.

## Secret rotation

Edit `shared/.env` as `mun`, retain mode `600`, then reload only the API:

```bash
CRAFT72_DEPLOY_ROOT=/home/mun/apps/craft72-max-app \
CRAFT72_ENV_FILE=/home/mun/apps/craft72-max-app/shared/.env \
pm2 startOrReload /home/mun/apps/craft72-max-app/current/deploy/ecosystem.config.cjs \
  --only craft72-max-api --update-env
```

Check readiness immediately. Never paste secrets into command arguments, PM2 ecosystem files,
Nginx files, Git commits or support messages.
