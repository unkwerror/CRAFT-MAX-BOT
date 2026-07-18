# Admin backend foundation

The admin API accepts `POST /api/admin/auth/password` only with fresh signed MAX `initData` whose
`start_param` is exactly `admin`. This proves that the login form was opened from the bot command,
but the MAX profile is not an authorization allowlist: access is granted by the password whose
scrypt verifier is stored in `ADMIN_PASSWORD_SCRYPT_HASH`. The signed profile is retained only as
the audit identity for the resulting session.

The login route is limited to five attempts per source IP in 15 minutes. A successful login stores
only an HMAC-SHA-256 digest of a random 32-byte session credential and returns the credential in the
`__Host-craft72-admin` cookie. The HMAC key is derived from the configured password verifier, so a
password rotation also invalidates every existing session. Neither password nor session credential
is included in JSON or browser storage. Mutating requests require the exact production `Origin`;
the cookie is `Secure`, `HttpOnly`, `SameSite=None`, `Partitioned`, host-only and bounded by
`ADMIN_SESSION_TTL_SECONDS`.

The initial API surface is:

- `GET /api/admin/users` — one cursor-paginated directory combining Mini App profiles and bot-only
  identities, deduplicated by MAX user ID. Bot-only rows have a null profile and the explicit
  neutral label `Пользователь MAX`;
- `GET /api/admin/submissions` and `GET /api/admin/submissions/:submissionId` — cursor-paginated
  application review, with filters for user, integration status and review status;
- `PATCH /api/admin/submissions/:submissionId` — changes only `reviewStatus` and `adminNote` with an
  `expectedUpdatedAt` optimistic lock. Submitted intake and integration outbox data are immutable;
- `POST /api/admin/submissions/:submissionId/contact-handoff` — queues a bot message in the
  administrator's latest active MAX dialog with the applicant's supported `max://user/<id>`
  profile mention; the queue write and audit entry are atomic;
- `/api/admin/cases` — list/create/update/delete managed portfolio cases with numeric versions;
- `/api/admin/content` — list/create/update/delete versioned drafts;
- `POST /api/admin/content/:key/publish` — atomically publishes the current expected draft version;
- `GET /api/cases` and `GET /api/content/:key` — public read models containing published data only;
- `GET /api/admin/session` and `POST /api/admin/logout` — session restore and revocation.

The Control UI follows every users/submissions cursor, so search and overview metrics include the
whole directory rather than only the first 100 rows. Published cases are likewise loaded through
all public cursor pages; a valid empty catalog stays empty instead of restoring demo objects.

The worker applies the published `bot-welcome` document to both `bot_started` and `/start`. Its
schema is `{ "text": "Ваше приветствие" }`, where `text` is 1–4000 characters after trimming. A
missing draft publication, wrong document kind, invalid payload or transient database failure falls
back to the built-in greeting without interrupting webhook processing. The admin content editor can
create, select, edit, publish and delete these versioned documents.

Every admin mutation writes an `admin_audit_log` row in the same database transaction. Audit
metadata contains identifiers, changed field names and version/state flags only; it deliberately
does not copy questionnaire answers, phones, emails, case text, content payloads or admin notes.
Case/content writes and submission review updates use optimistic versions so a stale browser cannot
silently overwrite another administrator's changes.

The `0005_admin_foundation` migration creates the hashed admin session store, audit log, case
catalog, versioned content documents and separate submission review fields. It does not change the
legal intake, consent evidence or Tracker synchronization status. Migration execution and backup
remain explicit deployment steps; no external production mutation is performed by the application
build or tests.

The idempotent `0006_seed_case_catalog` migration then imports the eight existing Mini App portfolio
objects without overwriting any ID that an administrator already manages.
