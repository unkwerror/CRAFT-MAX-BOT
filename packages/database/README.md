# Database package

`src/schema.ts` is the source of truth for the isolated CRAFT72 PostgreSQL schema. Generated SQL,
Drizzle metadata and the reviewed initial rollback are committed together.

```bash
pnpm --filter @craft72/database db:generate
pnpm --filter @craft72/database db:check
pnpm --filter @craft72/database db:migrate
```

`db:check` validates migration metadata and generates against a temporary copy to detect drift
without changing the working tree. The initial `down` migration refuses to run unless its exact
timestamp and SHA-256 hash are the only entry in the Drizzle ledger. It is intended for an
isolated test or staging database after backup, not as a routine production rollback.

Staged documents belong to a MAX user before a submission exists. Attaching one to a submission
must be a single conditional update that verifies the owner, `submission_id is null`,
`deleted_at is null`, `staged_expires_at > now()` and the required scan state. The composite
foreign key then prevents cross-owner attachment at the database boundary.
