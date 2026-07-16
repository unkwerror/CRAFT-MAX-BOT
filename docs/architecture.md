# Architecture

The product is split into four isolated workspace applications/libraries:

1. `apps/miniapp` is the mobile-first MAX Mini App client.
2. `apps/api` validates MAX identity, owns REST endpoints and durably accepts webhooks.
3. `apps/worker` drains PostgreSQL outbox operations without delaying webhook responses.
4. Shared packages define Zod contracts, validated configuration and the PostgreSQL schema.

PostgreSQL is the system of record for users, sessions, drafts, submissions, consent evidence,
webhook deduplication, bot dialogs, inquiries and outbound MAX actions. The browser never receives
MAX or Tracker credentials.

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

Stage 3 authentication, contacts, drafts and submissions remain in production. Outside MAX, the
Mini App retains a deterministic local preview without server authentication. Stage 4 adds only the
bot, webhook and MAX delivery path. Streaming file storage starts in Stage 5; Yandex Tracker field
discovery, mapping and synchronization start in Stage 6. The existing integration tables do not
authorize or imply Tracker traffic before that stage.
