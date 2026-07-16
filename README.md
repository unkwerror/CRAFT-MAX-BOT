# CRAFT72 MAX App

TypeScript monorepo for the CRAFT72 MAX bot, Mini App, API and durable integration worker.

## Current scope

Stage 4 adds the MAX bot and authenticated webhook pipeline to the Stage 3 Mini App and API. The
API durably deduplicates updates before acknowledging them; a separate worker handles `/start`,
`bot_started`, `bot_stopped`, messages and callbacks, stores inquiries, and delivers deduplicated
queued responses through the MAX API with bounded retries. A normal browser keeps a deterministic
local preview, while credentials remain server-side and never enter the browser bundle.

File upload and private storage are Stage 5. Yandex Tracker discovery and synchronization are
strictly Stage 6; the Stage 4 worker does not send submissions to Tracker. Production MAX webhook
registration remains an explicit Stage 8 operation rather than part of the deployment script.

Workspace layout:

```text
apps/
  api/          Fastify API and signed MAX runtime (Stage 3+)
  miniapp/      React/Vite MAX Mini App and browser preview
  worker/       MAX webhook inbox/outbox worker (Stage 4+)
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
