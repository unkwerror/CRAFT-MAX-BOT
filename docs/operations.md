# Operations

All commands in this runbook are scoped to the CRAFT72 MAX application. Do not restart unrelated
PM2 processes, inspect another database, run `pm2 save`, or print `shared/.env`.

## Routine health and logs

```bash
curl -fsS https://craft72app.ru/health/live
curl -fsS https://craft72app.ru/health/ready
pm2 describe craft72-max-api
pm2 describe craft72-max-worker
pm2 logs craft72-max-api --lines 100 --nostream
pm2 logs craft72-max-worker --lines 100 --nostream
```

Liveness proves that the HTTP process is running; readiness additionally proves its required
dependencies. PM2 must report a nonzero online PID for the worker. Neither health endpoint may
contain configuration or personal data. Application logging redacts authorization, cookies and
request bodies; the worker records event/action identifiers and error classes, not webhook payloads
or message text. Treat every log as confidential anyway: phone numbers, email addresses, form text,
signed MAX data, tokens and material links must never be added to ad-hoc logs.

A worker PID is necessary but does not prove functional readiness. Also check that PM2 restart
counters stay stable, the worker remains online beyond `min_uptime`, and a controlled webhook test
moves from inbox to a terminal outbox result. Use only an approved test chat when the production MAX
subscription is active.

The PM2 ecosystem writes only this application's API and worker output to `shared/logs/api.log`,
`shared/logs/api-error.log`, `shared/logs/worker.log` and `shared/logs/worker-error.log`. The supplied
logrotate rule also covers `retention.log`; it rotates daily, compresses old files and caps them at
90 days. If `LOG_RETENTION_DAYS` is reduced below 90, update the rule's `rotate` and `maxage` values
to the same or smaller number, run `logrotate --debug`, then install it.

Check the MAX control-plane state without printing the token or secret:

```bash
/home/mun/apps/craft72-max-app/current/scripts/max-webhook-subscription.sh status
```

The expected public webhook response without `X-Max-Bot-Api-Secret` is 401. Do not use an actual
secret in `curl`, shell history or an incident transcript. Webhook registration is an explicit
Stage 8 action and is not performed by routine Stage 4 deployment.

## Recovery after a host restart

The shared PM2 dump belongs to multiple applications and intentionally does not contain CRAFT72.
Do not run `pm2 save` to add it. Until the dedicated Stage 8 boot unit is reviewed and installed,
recover only these two processes after a host restart:

```bash
CRAFT72_DEPLOY_ROOT=/home/mun/apps/craft72-max-app \
CRAFT72_ENV_FILE=/home/mun/apps/craft72-max-app/shared/.env \
pm2 startOrReload /home/mun/apps/craft72-max-app/current/deploy/ecosystem.config.cjs \
  --only craft72-max-api,craft72-max-worker --update-env
curl -fsS http://127.0.0.1:4100/health/ready
pm2 describe craft72-max-worker
```

Stage 8 must install a separate scoped systemd recovery unit (or an isolated PM2 instance) that
runs the same allow-listed start command after PostgreSQL and networking are available. It must not
resurrect, save or restart unrelated applications.

## MAX API TLS trust

The worker starts Node with `NODE_USE_SYSTEM_CA=1`. Verify its system-CA path after deployment and
after every OS or trust-store update, without sending a bot token:

```bash
NODE_USE_SYSTEM_CA=1 node --input-type=module -e '
const response = await fetch("https://platform-api2.max.ru/me", {
  redirect: "error",
  signal: AbortSignal.timeout(10000),
});
await response.body?.cancel();
console.log(`MAX TLS trust OK (HTTP ${response.status})`);
'
```

A TLS error is an incident and blocks MAX delivery. Do not use `curl -k` or
`NODE_TLS_REJECT_UNAUTHORIZED=0`. If Russian Trusted Root CA must be reinstalled, use only the
official Gosuslugi/Ministry source and verify the SHA-256 fingerprint before changing the system
store, following the reviewed [deployment procedure](deployment.md).

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
last-success marker, so the frequent cron entry does not shorten the configured interval. Database
deletion runs in one transaction and removes Stage 4 child data before eligible dialogs. It:

- removes expired drafts and stale sessions;
- removes only terminal (`completed` or `dead_letter`) MAX outbox actions at
  `LOG_RETENTION_DAYS`, using their terminal/update timestamp;
- removes bot inquiries at `SUBMISSION_RETENTION_DAYS`, never above 1095 days;
- removes only terminal (`processed` or `dead_letter`) webhook records at
  `LOG_RETENTION_DAYS`, never above 90 days;
- removes old dialog metadata that has no inquiry, outbox or webhook children;
- never removes `pending`, `retry` or `processing` webhook/outbox work;
- removes applications at `SUBMISSION_RETENTION_DAYS`, with dependent rows;
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

Edit `shared/.env` as `mun`, retain mode `600`, then reload only the CRAFT72 API and worker:

```bash
CRAFT72_DEPLOY_ROOT=/home/mun/apps/craft72-max-app \
CRAFT72_ENV_FILE=/home/mun/apps/craft72-max-app/shared/.env \
pm2 startOrReload /home/mun/apps/craft72-max-app/current/deploy/ecosystem.config.cjs \
  --only craft72-max-api,craft72-max-worker --update-env
```

Check API readiness and the worker PID immediately. A webhook-secret rotation also requires an
approved MAX subscription update; coordinate it so the API and subscription do not expect different
secrets. Never paste secrets into command arguments, PM2 ecosystem files, Nginx files, Git commits
or support messages.
