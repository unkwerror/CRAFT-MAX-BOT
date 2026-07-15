# Deployment

Production deployment is intentionally out of scope for Stage 1.

Before deployment, complete the read-only server preflight and confirm an unused loopback port,
isolated application directory, dedicated PostgreSQL database and role, separate process names,
an independent Nginx server block, DNS propagation and trusted TLS for `craft72app.ru`.

No production command may load secrets from Git or reuse the previously disclosed MAX token.
Builds must use the committed lock file with `pnpm install --frozen-lockfile`.
