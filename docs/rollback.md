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

For a static Mini App rollback, select a previous directory under
`/home/mun/apps/craft72-max-app/releases` and atomically repoint only the application's `current`
symlink. Never delete or overwrite the shared `.env` during a release switch.
