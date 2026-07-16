# CRAFT72 MAX App

TypeScript monorepo for the CRAFT72 MAX bot, Mini App, API and durable integration worker.

## Current scope

Stages 5 and 6 add secure project-file intake and a durable Yandex Tracker integration to the MAX
bot/Mini App pipeline. Files are streamed to private quarantine, checked by extension, MIME,
signature and ClamAV, and can be attached to a submission only after a clean verdict. The worker
prepares the idempotent `PART → CRM → DOCS` chain through a transactional outbox.

Tracker remains fail-closed in production dry-run until an accessible test queue, field taxonomy
and assignee are approved. HTTP mutations require both `TRACKER_DRY_RUN=false` and the independent
`TRACKER_PRODUCTION_WRITES_APPROVED=true` gate. Production MAX webhook registration also remains an
explicit Stage 8 operation rather than part of deployment.

Workspace layout:

```text
apps/
  api/          Fastify API, signed MAX runtime and private file intake
  miniapp/      React/Vite MAX Mini App and browser preview
  worker/       MAX and Yandex Tracker durable workers
packages/
  config/       Validated server configuration
  contracts/    Shared Zod API contracts
  database/     Drizzle schema and migrations
data/cases/     Curated case catalog
docs/           Architecture and operations notes
```

## Prerequisites

- Node.js `22.22.1` (Node `>=22.13 <25` is supported)
- pnpm `11.13.0` through Corepack

```bash
corepack enable
corepack prepare pnpm@11.13.0 --activate
pnpm install --frozen-lockfile
pnpm run check
```

Copy `.env.example` only as a local starting point. Replace placeholders outside Git and keep all
production credentials only in the server-side secret file with mode `600`.

## Quality commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm db:check
pnpm test
pnpm build
```

Database migrations are generated from `packages/database/src/schema.ts`; `db:check` also detects
schema drift against a temporary migration copy. The regular test command skips destructive
database checks unless both `DATABASE_URL` and `MIGRATION_TEST_ALLOW_DESTRUCTIVE=true` are
present. Point them only at an isolated database whose name ends in `_test` to verify the initial
migration in both directions. Deployment is performed explicitly with the repository deployment
script; no GitHub Actions workflow is used.

See [architecture](docs/architecture.md), [deployment](docs/deployment.md),
[rollback](docs/rollback.md), and [operations](docs/operations.md).
