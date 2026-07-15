# CRAFT72 MAX App

TypeScript monorepo for the CRAFT72 MAX bot, Mini App, API and durable integration worker.

## Current scope

Stage 1 establishes repository boundaries and contracts only. It does not deploy services,
configure DNS/TLS, register a MAX webhook, or connect to production MAX and Yandex Tracker
credentials.

Workspace layout:

```text
apps/
  api/          Fastify API and MAX webhook runtime (Stage 3+)
  miniapp/      React/Vite MAX Mini App (Stage 2+)
  worker/       PostgreSQL outbox worker (Stage 4+)
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

Copy `.env.example` only as a local starting point. Replace placeholders outside Git. Never use
the previously disclosed MAX token; production requires a newly rotated token.

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
database checks unless both `DATABASE_URL` and
`MIGRATION_TEST_ALLOW_DESTRUCTIVE=true` are present; CI supplies an isolated `craft72_test`
PostgreSQL service and verifies the initial migration in both directions.

See [architecture](docs/architecture.md), [deployment](docs/deployment.md),
[rollback](docs/rollback.md), and [operations](docs/operations.md).
