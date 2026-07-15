# Architecture

The product is split into four isolated workspace applications/libraries:

1. `apps/miniapp` is the mobile-first MAX Mini App client.
2. `apps/api` validates MAX identity, owns REST endpoints and durably accepts webhooks.
3. `apps/worker` drains PostgreSQL outbox operations without delaying webhook responses.
4. Shared packages define Zod contracts, validated configuration and the PostgreSQL schema.

PostgreSQL is the system of record for users, sessions, drafts, submissions, documents,
webhook deduplication and integration retries. The browser never receives MAX or Tracker
credentials. Files use private storage and only metadata belongs in PostgreSQL.

Stage 2 runs the Mini App against deterministic in-browser mocks. Trusted MAX authentication,
contact verification and server-owned drafts start in Stage 3; bot/webhook and durable outbox
processing follow in Stage 4. The browser bundle never embeds MAX or Tracker credentials.
