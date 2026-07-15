# Rollback

Rollback is designed and exercised during staging, before production activation. It must affect
only the CRAFT72 MAX application and include:

- a previous immutable release;
- a backup of the dedicated database;
- a release pointer or container-version switch;
- targeted restart of only the API and worker;
- backup of only the new Nginx configuration;
- removal of only this application's MAX webhook;
- checks of `/health/live`, `/health/ready` and Mini App startup after rollback.

Stage 1 performs no server mutation, so its rollback is a Git revert of repository-only changes.
