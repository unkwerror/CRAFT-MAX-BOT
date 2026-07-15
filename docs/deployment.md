# Deployment

Stage 3 is deployed manually; the repository intentionally has no GitHub Actions workflow. The
deployment unit contains the built Mini App, the portable production API package, reviewed database
migrations and process-management helpers. A release is immutable after it is placed under
`/home/mun/apps/craft72-max-app/releases`.

## One-time server preparation

Use the unprivileged `mun` account for application files and PM2. Use sudo only for PostgreSQL,
Nginx and logrotate setup. Do not run `pm2 save`: the existing PM2 applications are outside this
project and must not be changed.

Create the stable application directories:

```bash
install -d -m 750 /home/mun/apps/craft72-max-app/{releases,shared}
install -d -m 700 /home/mun/apps/craft72-max-app/shared/{backups/database,deploy-state,logs,retention}
umask 077
test -e /home/mun/apps/craft72-max-app/shared/.env || touch /home/mun/apps/craft72-max-app/shared/.env
chmod 600 /home/mun/apps/craft72-max-app/shared/.env
```

Create a dedicated PostgreSQL database and login role. Enter the generated password interactively;
do not put it in shell history. Grant this role no access to unrelated databases. Put the resulting
PostgreSQL URL only in `shared/.env` and keep the file owned by `mun` with mode `600`.

The production env must include the Stage 3 runtime settings and these public build settings:

```dotenv
PUBLIC_BASE_URL=https://craft72app.ru
PRIVACY_POLICY_URL=https://craft72app.ru/privacy.html
CONSENT_VERSION=miniapp-2026-07-15
API_HOST=127.0.0.1
API_PORT=4100
SUBMISSION_RETENTION_DAYS=1095
LOG_RETENTION_DAYS=90
BACKUP_RETENTION_DAYS=30
RETENTION_CLEANUP_INTERVAL_SECONDS=21600
```

The same protected file contains `DATABASE_URL`, MAX credentials and other server-only values. None
of those values belong in `VITE_*`, a release archive, Git or deployment logs.

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

The include proxies the exact `/api/` and `/health/` prefixes to `127.0.0.1:4100`, keeps the static
release root, blocks release-internal directories and permits the official MAX bridge script from
`https://st.max.ru` in its CSP. `privacy.html` and release markers are never cached, portfolio
images have a bounded seven-day cache, and Vite's content-hashed assets are immutable.

Install the application-specific logrotate example after confirming `LOG_RETENTION_DAYS=90`:

```bash
sudo install -m 644 deploy/logrotate/craft72-max-api /etc/logrotate.d/craft72-max-api
sudo logrotate --debug /etc/logrotate.d/craft72-max-api
```

## Deploy a release

From a clean, committed local checkout, run:

```bash
./scripts/deploy-miniapp.sh
```

The script performs the following guarded sequence:

1. refuses a dirty worktree or shell tracing;
2. reads only `PRIVACY_POLICY_URL` and `CONSENT_VERSION` from the protected server env, validates
   `public/privacy.html`, and maps them to `VITE_PRIVACY_POLICY_URL` and
   `VITE_CONSENT_VERSION` for the Mini App build;
3. installs the committed lockfile, builds API dependencies and creates a portable production API;
4. rejects destructive forward SQL, creates a checksummed immutable archive and acquires a
   server-side deployment lock;
5. creates a custom-format PostgreSQL backup, applies all pending Drizzle migrations before the
   switch, and never runs a down migration during deployment;
6. atomically changes only the `current` symlink and runs PM2 `startOrReload --only
craft72-max-api --update-env` without `pm2 save`;
7. checks loopback readiness, then the public API and exact public release marker. A failure restores
   the previous pointer and reloads or removes only `craft72-max-api`.

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
ssh -p 2222 mun@109.174.15.132 'pm2 describe craft72-max-api'
```

Verify the Mini App from MAX as well as in a normal browser. The MAX path must display the approved
policy before its first server request, authenticate signed init data, persist a server draft,
verify the shared contact and return only the signed-in user's submission.
