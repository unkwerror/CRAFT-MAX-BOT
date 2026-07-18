# Deployment

Stage 6 is deployed manually; the repository intentionally has no GitHub Actions workflow. The
deployment unit contains the built Mini App, portable production API and worker packages, reviewed
database migrations and process-management helpers. A release is immutable after it is placed
under `/home/mun/apps/craft72-max-app/releases`.

## One-time server preparation

Use the unprivileged `mun` account for application files and PM2. Use sudo only for PostgreSQL,
Nginx and logrotate setup. Do not run `pm2 save`: the existing PM2 applications are outside this
project and must not be changed.

Create the stable application directories:

```bash
install -d -m 750 /home/mun/apps/craft72-max-app/{releases,shared}
install -d -m 700 /home/mun/apps/craft72-max-app/shared/{backups/database,deploy-state,logs,retention,uploads}
umask 077
test -e /home/mun/apps/craft72-max-app/shared/.env || touch /home/mun/apps/craft72-max-app/shared/.env
chmod 600 /home/mun/apps/craft72-max-app/shared/.env
```

Create a dedicated PostgreSQL database and login role. Enter the generated password interactively;
do not put it in shell history. Grant this role no access to unrelated databases. Put the resulting
PostgreSQL URL only in `shared/.env` and keep the file owned by `mun` with mode `600`.

The protected production env must cover every key in `.env.example`. In addition to the existing
MAX/database settings, Stage 5–6 uses these reviewed values (secrets remain unique server values):

```dotenv
PUBLIC_BASE_URL=https://craft72app.ru
PRIVACY_POLICY_URL=https://craft72app.ru/privacy.html
CONSENT_VERSION=miniapp-2026-07-16-stage5
API_HOST=127.0.0.1
API_PORT=4100
MAX_BOT_PUBLIC_NAME=se13560957_bot
MAX_MANAGER_PROFILE_URL=https://max.ru/u/<COPIED_MANAGER_PROFILE_TOKEN>
MAX_MANAGER_USER_ID=61096226
MAX_MANAGER_PHONE=+79220063645
ADMIN_MAX_USER_IDS=61096226
ADMIN_SESSION_TTL_SECONDS=28800
SUBMISSION_RETENTION_DAYS=1095
LOG_RETENTION_DAYS=90
BACKUP_RETENTION_DAYS=30
RETENTION_CLEANUP_INTERVAL_SECONDS=21600
API_RATE_LIMIT_MAX=120
API_IP_RATE_LIMIT_MAX=1200
API_RATE_LIMIT_WINDOW_SECONDS=60
MAX_API_TIMEOUT_MS=10000
BOT_WORKER_POLL_INTERVAL_MS=500
BOT_WORKER_LEASE_SECONDS=60
BOT_WORKER_MAX_ATTEMPTS=8
BOT_RETRY_BASE_MS=1000
BOT_RETRY_MAX_MS=300000
UPLOAD_MAX_BYTES=52428800
UPLOAD_STAGING_TTL_SECONDS=86400
UPLOAD_STORAGE_PATH=/home/mun/apps/craft72-max-app/shared/uploads
UPLOAD_DOWNLOAD_TTL_SECONDS=900
UPLOAD_LEASE_SECONDS=900
UPLOAD_MAX_ACTIVE_PER_USER=5
UPLOAD_MAX_STAGED_BYTES_PER_USER=262144000
UPLOAD_MAX_FILES_PER_USER=100
UPLOAD_MAX_TOTAL_BYTES_PER_USER=1073741824
CLAMAV_SOCKET_PATH=/run/clamav/clamd.ctl
CLAMAV_SCAN_TIMEOUT_MS=120000
FILE_SCAN_POLL_INTERVAL_MS=1000
FILE_SCAN_LEASE_SECONDS=180
FILE_SCAN_MAX_ATTEMPTS=8
FILE_SCAN_RETRY_BASE_MS=5000
FILE_SCAN_RETRY_MAX_MS=300000
TRACKER_DRY_RUN=true
TRACKER_PRODUCTION_WRITES_APPROVED=false
TRACKER_ASSIGNEE=
TRACKER_API_TIMEOUT_MS=10000
TRACKER_WORKER_POLL_INTERVAL_MS=1000
TRACKER_WORKER_LEASE_SECONDS=90
TRACKER_WORKER_MAX_ATTEMPTS=8
TRACKER_RETRY_BASE_MS=1000
TRACKER_RETRY_MAX_MS=300000
```

The same file contains `DATABASE_URL`, `MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET`, `TRACKER_TOKEN`,
`TRACKER_ORG_ID` and a random `UPLOAD_SIGNING_SECRET` of at least 32 URL-safe characters. None of
those values belong in `VITE_*`, a release archive, Git or deployment logs. Keep mode `600`.

`ADMIN_MAX_USER_IDS` is a comma-separated allowlist of signed MAX user IDs. Production startup
fails when it is empty; changing it takes effect for every admin request, including existing
sessions. Do not expose a separate browser token: the API issues a hashed server session through a
`Secure`, `HttpOnly`, `SameSite=Strict` cookie with the bounded `ADMIN_SESSION_TTL_SECONDS` TTL.
The deployment script validates this allowlist before building or applying migrations, so a missing,
duplicated or malformed administrator ID cannot leave the new services unable to start.
Apply `0005_admin_foundation.sql` before exposing the admin routes, and verify the migration backup
before activation; its development rollback refuses to discard any admin-managed data.

`MAX_MANAGER_PROFILE_URL` must be the exact personal link copied from the manager's MAX profile;
it cannot be derived from the numeric user ID. The Mini App prefers this HTTPS link, then uses the
configured phone as a fallback. MAX Bridge does not support `max://user/<id>` as a Mini App
navigation URL.

### Install and verify ClamAV

Install only the required antivirus packages; do not perform a broad package upgrade or reboot as
part of application deployment:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends clamav-daemon clamav-freshclam
sudo sed -i -E \
  -e 's/^LocalSocketGroup .*/LocalSocketGroup mun/' \
  -e 's/^LocalSocketMode .*/LocalSocketMode 660/' \
  -e 's/^StreamMaxLength .*/StreamMaxLength 60M/' \
  -e 's/^MaxScanSize .*/MaxScanSize 100M/' \
  -e 's/^MaxFileSize .*/MaxFileSize 60M/' \
  -e 's/^MaxFiles .*/MaxFiles 10000/' \
  -e 's/^EnableVersionCommand .*/EnableVersionCommand true/' \
  /etc/clamav/clamd.conf
grep -q '^AlertExceedsMax ' /etc/clamav/clamd.conf && \
  sudo sed -i -E 's/^AlertExceedsMax .*/AlertExceedsMax yes/' /etc/clamav/clamd.conf || \
  printf '%s\n' 'AlertExceedsMax yes' | sudo tee -a /etc/clamav/clamd.conf >/dev/null
sudo freshclam
sudo systemctl enable --now clamav-freshclam clamav-daemon
sudo systemctl is-active --quiet clamav-daemon
sudo systemctl is-active --quiet clamav-freshclam
test -S /run/clamav/clamd.ctl
clamconf -n | grep -E '^(LocalSocket|LocalSocketGroup|LocalSocketMode|StreamMaxLength|MaxScanSize|MaxFileSize|MaxFiles|AlertExceedsMax|EnableVersionCommand)'
printf 'PING\n' | nc -U -w 5 /run/clamav/clamd.ctl | grep -Fx PONG
```

If `mun` cannot connect to the socket, review `LocalSocketGroup` and `LocalSocketMode` in the
distribution's `clamd.conf`; grant only the minimum group permission and restart only
`clamav-daemon`. Never make the upload directory public and never replace a failed scan with an
automatic clean verdict. `/health/ready` reports `antivirus:error` and deployment fails closed while
the daemon or its signatures are unavailable.

If the official CDN returns 403, do not use an unofficial signature mirror or repeatedly bypass the
cool-down. Provision an approved proxy/private mirror with Cisco's supported `cvdupdate` workflow,
verify current official CVD files, and keep deployment blocked until both update service and daemon
are healthy. See the [official private-mirror procedure](https://docs.clamav.net/appendix/CvdPrivateMirror.html).

`MAX_BOT_PUBLIC_NAME` is the public MAX bot username returned by `GET /me`, not the Mini App URL or
`PUBLIC_BASE_URL`. Keep it in the protected env with the rest of the validated runtime
configuration, even though the username itself is public.

### Verify the MAX API trust chain

The worker launcher sets `NODE_USE_SYSTEM_CA=1`, so the host system trust store must trust Russian
Trusted Root CA before the worker can call `platform-api2.max.ru`. Download the root certificate
only through the official [Gosuslugi certificate page](https://www.gosuslugi.ru/crt) or an official
Ministry of Digital Development publication. Do not use a mirror, `curl -k`, or an instruction that
disables TLS verification.

Before installation, inspect the certificate and compare its SHA-256 fingerprint with the reviewed
value. The currently approved root fingerprint is
`D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`.
If the official source announces a replacement, stop and update this runbook through a reviewed
change instead of accepting a different fingerprint ad hoc.

```bash
certificate=/path/to/russian_trusted_root_ca.cer
x509_format=()
if ! openssl x509 -in "$certificate" -noout >/dev/null 2>&1; then
  x509_format=(-inform DER)
fi
umask 077
normalized=$(mktemp)
trap 'rm -f -- "$normalized"' EXIT
openssl x509 "${x509_format[@]}" -in "$certificate" -out "$normalized"
openssl x509 -in "$normalized" -noout -subject -issuer -dates -fingerprint -sha256
expected='D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31'
actual=$(openssl x509 -in "$normalized" -noout -fingerprint -sha256 |
  sed 's/^sha256 Fingerprint=//')
test "$actual" = "$expected"
sudo install -m 644 -o root -g root "$normalized" \
  /usr/local/share/ca-certificates/russian-trusted-root-ca.crt
sudo update-ca-certificates
```

The production host is expected to be provisioned already; verification is still mandatory before
a Stage 4 deploy and after any OS/CA-store change. Test Node's actual TLS path without a bot token:

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

Any HTTP status proves that TLS hostname and chain verification completed; a TLS exception blocks
deployment. Never work around it with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### Merge the Nginx include

The active HTTPS virtual host is Certbot-managed. Do not replace it with a repository template.
First back up only that virtual-host file, then install the two snippets:

```bash
sudo install -m 644 deploy/nginx/craft72app.ru-security-headers.conf \
  /etc/nginx/snippets/craft72app.ru-security-headers.conf
sudo install -m 644 deploy/nginx/craft72app.ru.conf \
  /etc/nginx/snippets/craft72app.ru-stage3.conf
```

Inside the existing `listen 443 ssl` block for `craft72app.ru`, remove the old application
`location` sections and add:

```nginx
include /etc/nginx/snippets/craft72app.ru-stage3.conf;
```

Keep Certbot's certificate directives and HTTP-to-HTTPS redirect unchanged. Validate and reload only
after reviewing the merged output:

```bash
sudo nginx -T | less
sudo nginx -t
sudo systemctl reload nginx
```

Installing this Stage 4 snippet before deployment is mandatory. The previously installed Stage 3
snippet has no webhook proxy; if it remains active, the deployment's unauthenticated webhook probe
will not return 401 and the guarded release switch will roll back. Confirm the rendered config
contains `location = /webhooks/max` before running the deployment script.

The include proxies the exact `/api/`, `/files/` and `/health/` prefixes and the exact
`POST /webhooks/max` endpoint to `127.0.0.1:4100`. Other `/webhooks/` paths return 404, and the MAX
request body is capped at 256 KiB. Upload bodies alone are capped at 50 MiB and streamed with proxy
request buffering disabled; download response buffering and temporary files are also disabled, and
temporary download capabilities are excluded from access logs. It keeps
the static release root, blocks release-internal
directories and permits the official MAX bridge script from `https://st.max.ru` in its CSP.
`privacy.html`, `terms.html` and release markers are never cached, portfolio images have a bounded
seven-day cache, and Vite's content-hashed assets are immutable.

Install the application-specific logrotate example after confirming `LOG_RETENTION_DAYS=90`:

```bash
sudo install -m 644 deploy/logrotate/craft72-max-api /etc/logrotate.d/craft72-max-api
sudo logrotate --debug /etc/logrotate.d/craft72-max-api
sudo grep -F '/home/mun/apps/craft72-max-app/shared/logs/worker.log' \
  /etc/logrotate.d/craft72-max-api
```

Replace the prior Stage 3 logrotate file before deployment; it does not cover the new worker output.

## Deploy a release

From a clean, committed local checkout, run:

```bash
./scripts/deploy-miniapp.sh
```

The script performs the following guarded sequence:

1. refuses a dirty worktree or shell tracing;
2. reads only the explicitly allow-listed public build values from the protected server env,
   validates the published privacy and terms documents, and maps only public values to `VITE_*`;
3. installs the committed lockfile, builds the Mini App, API and worker, then creates portable
   production packages for both server processes;
4. rejects destructive forward SQL, creates a checksummed immutable archive and acquires a
   server-side deployment lock;
5. creates a custom-format PostgreSQL backup, applies all pending Drizzle migrations before the
   switch, and never runs a down migration during deployment;
6. atomically changes only the `current` symlink and runs PM2 `startOrReload --only
craft72-max-api,craft72-max-worker --update-env` without `pm2 save`;
7. checks database and ClamAV readiness plus the worker PID, then the public API, exact release marker
   and the protected webhook boundary. A failure restores the previous pointer and reloads or
   removes only the two CRAFT72 processes.

The `activate-stage3.sh`, `rollback-stage3.sh`, `cleanup-stage3-retention.sh` and installed Nginx
snippet names are retained for compatibility with existing immutable releases. Their current
behavior is Stage 4-aware.

Host, port and root can be overridden without editing the script:

```bash
DEPLOY_HOST=example DEPLOY_PORT=2222 DEPLOY_ROOT=/home/mun/apps/craft72-max-app \
  ./scripts/deploy-miniapp.sh
```

`StrictHostKeyChecking=yes` and key-based batch SSH are required. The script neither accepts nor
prints an SSH password, sudo password, bot token, OAuth token or database password.

## Post-deployment acceptance

```bash
curl -fsS https://craft72app.ru/release-id.txt
curl -fsS https://craft72app.ru/health/live
curl -fsS https://craft72app.ru/health/ready
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  --data '{"update_type":"acceptance_probe","timestamp":1}' \
  https://craft72app.ru/webhooks/max)" = 401
ssh -p 2222 mun@109.174.15.132 'pm2 describe craft72-max-api'
ssh -p 2222 mun@109.174.15.132 'pm2 describe craft72-max-worker'
```

Verify the Mini App from MAX as well as in a normal browser. The MAX path must display the approved
policy before its first server request, authenticate signed init data, persist a server draft,
verify the shared contact and return only the signed-in user's submission. Exercise `/start`, each
open-app route, a regular text inquiry and a duplicate webhook fixture; the duplicate must not
create a second inquiry or outbound action.

Upload one harmless file from an approved test account and verify the UI transitions through
`pending/scanning` to `clean`; submit it and confirm it remains owner-scoped. Also try a mismatched
extension/signature and a file over 50 MiB: both must be rejected without a document row usable by a
submission. Do not use production customer files for acceptance.

Tracker acceptance for this release is deliberately read-only. Confirm worker logs contain a
deduplicated `tracker_dry_run_preview` with a payload hash after the approved test submission, while
the corresponding outbox rows remain pending and no Tracker issue is created. Do not switch either
production-write flag until an accessible test queue, assignee and taxonomy mapping are approved.

The release deployment intentionally does not change the MAX control plane. Inspect the current
subscription with the release helper:

```bash
/home/mun/apps/craft72-max-app/current/scripts/max-webhook-subscription.sh status
```

Run its `register` action only during the explicitly approved Stage 8 production activation, after
the HTTPS endpoint and both processes pass acceptance. Keep `unregister` for an approved incident or
retirement procedure. The helper reads the protected env itself and does not print credentials.

Stage 5 file storage is active. Stage 6 planning is active only in dry-run; external Tracker writes
remain a separate production activation decision.
