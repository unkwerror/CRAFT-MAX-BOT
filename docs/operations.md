# Operations

Operational procedures are completed alongside the running API and worker. The baseline rules are:

- redact tokens, phone numbers, email addresses, brief text and file links from logs;
- expose liveness and readiness without configuration or personal data;
- alert on failed outbox operations without dropping the accepted submission;
- back up only the dedicated database and test restoration;
- rotate secrets outside Git and keep the production secret file at mode `600`;
- restart and inspect only `craft72-max-api` and `craft72-max-worker`.

No production monitoring or process manager is configured during Stage 1.
