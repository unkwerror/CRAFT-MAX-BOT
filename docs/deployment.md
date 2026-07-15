# Deployment

Deployment is explicit: this repository intentionally has no GitHub Actions workflow. The Mini App
is built locally from the committed lock file and copied to an immutable release directory:

```bash
./scripts/deploy-miniapp.sh
```

The script uploads only `apps/miniapp/dist`, verifies a SHA-256 manifest, then atomically changes
`/home/mun/apps/craft72-max-app/current`. It requires a clean worktree and a working HTTPS virtual
host, checks the exact public release marker and restores the previous symlink on failure. It never
reads, copies or prints the production `.env`. A different marker URL can be provided when needed:

```bash
HEALTHCHECK_URL=https://preview.example.ru/release-id.txt ./scripts/deploy-miniapp.sh
```

Before the first public deployment, confirm an independent Nginx server block, DNS propagation and
trusted TLS for `craft72app.ru`. Backend stages additionally require an unused loopback port, a
dedicated PostgreSQL database and role, and separate process names. Builds use
`pnpm install --frozen-lockfile`; production credentials remain only in the server-side secret file
with mode `600`.

The first server setup installs `deploy/nginx/craft72app.ru.conf` as a dedicated virtual host. Nginx
receives read/traverse ACLs only for the CRAFT72 static release path; the private `shared/.env`
retains owner-only mode `600`. Certbot then adds and renews the HTTPS stanza. These one-time steps
require sudo, while subsequent static releases use only the unprivileged deployment script.
