# Architecture

The product is split into four isolated workspace applications/libraries:

1. `apps/miniapp` is the mobile-first MAX Mini App client.
2. `apps/api` validates MAX identity, owns REST endpoints and durably accepts webhooks.
3. `apps/worker` drains PostgreSQL outbox operations without delaying webhook responses.
4. Shared packages define Zod contracts, validated configuration and the PostgreSQL schema.

PostgreSQL is the system of record for users, sessions, drafts, submissions, documents,
webhook deduplication and integration retries. The browser never receives MAX or Tracker
credentials. Files use private storage and only metadata belongs in PostgreSQL.

Stage 1 contains boundaries and contracts, not running services. Runtime implementation is added
incrementally in later stages of `CRAFT72_MAX_MINIAPP_CODEX_GUIDE.md`.
