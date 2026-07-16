# Architecture

The product is split into four isolated workspace applications/libraries:

1. `apps/miniapp` is the mobile-first MAX Mini App client.
2. `apps/api` validates MAX identity, owns REST endpoints and durably accepts webhooks.
3. `apps/worker` drains PostgreSQL outbox operations without delaying webhook responses.
4. Shared packages define Zod contracts, validated configuration and the PostgreSQL schema.

PostgreSQL is the system of record for users, sessions, drafts, submissions, consent evidence,
upload capabilities (hashes only), scan jobs, temporary access grants, webhook deduplication, bot
dialogs and both integration outboxes. The browser never receives MAX or Tracker credentials.

## Stage 4 event flow

1. MAX sends an update to the exact `POST /webhooks/max` route with the configured subscription
   secret.
2. The API compares the secret, validates the update and inserts its deterministic event key into
   `webhook_inbox` before returning success. A repeated delivery hits the same key and is
   acknowledged without creating a second event.
3. The worker claims one ready event with a lease and preserves ordering for a chat. In one database
   transaction it updates the dialog, stores a user inquiry when applicable, creates deterministic
   `max_bot_outbox` actions and marks the inbox event processed.
4. The worker sends a claimed action to MAX outside that transaction. Success stores the provider
   message identifier when MAX returns one; retryable failures use bounded exponential backoff, and
   permanent or exhausted failures become dead letters.

The webhook endpoint therefore does not wait for MAX API delivery, and a process restart can resume
database-backed work. Unique event and action keys make replay safe. Delivery to an external API is
still at least once across a crash at the network-success/database-commit boundary, so operators
must retain the outbox audit trail for its configured window.

## Stage 5 file flow

1. An authenticated owner sends only the name, declared MIME and size to `uploads/init`. The API
   stores a hash of a random upload capability and returns that one-purpose capability. The browser
   never reads a 50 MiB file into memory merely to calculate a digest.
2. Nginx and Fastify stream the body directly to a mode-`0600` quarantine file. The API enforces
   the 50 MiB boundary and computes its own size and SHA-256 while writing; it never buffers the
   whole file or trusts the browser facts.
3. A bounded validator checks filename, extension, declared MIME, magic signature and OOXML central
   directory safety. Raw ZIP, traversal entries, encrypted containers and zip bombs are rejected.
4. A leased scan job sends the private stream to ClamAV over its Unix socket. A fenced database
   verdict is committed before any physical cleanup. Infected content is tombstoned and removed;
   clean content stays under its opaque UUID outside the public release, so a stale worker cannot
   race a filesystem rename against the current lease holder.
5. Only clean, unexpired documents owned by the MAX user can be attached transactionally to a
   submission. Downloads use a short-lived HMAC grant whose database row stores only a hash.

## Stage 6 Tracker flow

Submission creation inserts an immutable pointer chain into `integration_outbox` in the same
transaction: PART, then CRM, then DOCS only when materials exist. The worker claims ready rows with
`FOR UPDATE SKIP LOCKED`, a lease token and fencing checks. Tracker's `unique` field and exact
conflict recovery make external creation idempotent across the network-success/database-commit
boundary. Retryable failures use bounded exponential backoff; permanent failures dead-letter the
remaining dependency chain.

Production currently runs read-only dry-run preview: it selects the next plan and hashes the exact
payload but neither claims rows nor calls Tracker. Mutations need both independent production flags.
The discovered fixed-list taxonomies and assignee remain intentionally unmapped until approved.
