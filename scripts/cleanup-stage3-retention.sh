#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$-" == *x* ]]; then
  echo "Refusing to run with shell tracing enabled." >&2
  exit 2
fi

DEPLOY_ROOT="${DEPLOY_ROOT:-/home/mun/apps/craft72-max-app}"
ENVIRONMENT_FILE="${ENVIRONMENT_FILE:-${DEPLOY_ROOT}/shared/.env}"
STATE_DIRECTORY="${DEPLOY_ROOT}/shared/retention"
LOCK_FILE="${STATE_DIRECTORY}/cleanup.lock"
LAST_RUN_FILE="${STATE_DIRECTORY}/last-success.epoch"

[[ "${DEPLOY_ROOT}" =~ ^/[A-Za-z0-9._/-]+$ ]] && [[ "${DEPLOY_ROOT}" != *..* ]] || {
  echo "DEPLOY_ROOT is invalid." >&2
  exit 2
}
[[ -f "${ENVIRONMENT_FILE}" && -O "${ENVIRONMENT_FILE}" ]] || {
  echo "The protected application environment is missing or has the wrong owner." >&2
  exit 2
}
command -v flock >/dev/null
command -v psql >/dev/null

umask 077
mkdir -p "${STATE_DIRECTORY}"
exec 9>"${LOCK_FILE}"
flock -n 9 || exit 0

set -a
# shellcheck disable=SC1090
if ! . "${ENVIRONMENT_FILE}" 2>/dev/null; then
  echo "The protected application environment could not be loaded." >&2
  exit 2
fi
set +a

: "${DATABASE_URL:?}"
: "${SUBMISSION_RETENTION_DAYS:?}"
: "${RETENTION_CLEANUP_INTERVAL_SECONDS:?}"
: "${LOG_RETENTION_DAYS:?}"
: "${BACKUP_RETENTION_DAYS:?}"

for value_name in \
  SUBMISSION_RETENTION_DAYS RETENTION_CLEANUP_INTERVAL_SECONDS LOG_RETENTION_DAYS BACKUP_RETENTION_DAYS; do
  value="${!value_name}"
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || {
    echo "${value_name} must be a positive integer." >&2
    exit 2
  }
done

((SUBMISSION_RETENTION_DAYS <= 1095)) || {
  echo "SUBMISSION_RETENTION_DAYS must not exceed the published 1095-day policy." >&2
  exit 2
}
((LOG_RETENTION_DAYS <= 90)) || {
  echo "LOG_RETENTION_DAYS must not exceed the published 90-day policy." >&2
  exit 2
}
((BACKUP_RETENTION_DAYS <= 30)) || {
  echo "BACKUP_RETENTION_DAYS must not exceed the published 30-day policy." >&2
  exit 2
}

now_epoch="$(date +%s)"
if [[ "${1:-}" != "--force" && -s "${LAST_RUN_FILE}" ]]; then
  last_epoch="$(<"${LAST_RUN_FILE}")"
  if [[ "${last_epoch}" =~ ^[0-9]+$ ]] &&
    ((now_epoch - last_epoch < RETENTION_CLEANUP_INTERVAL_SECONDS)); then
    exit 0
  fi
fi

echo "Applying the configured Stage 3 retention windows..."
PGDATABASE="${DATABASE_URL}" psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set="submission_days=${SUBMISSION_RETENTION_DAYS}" \
  --set="log_days=${LOG_RETENTION_DAYS}" <<'RETENTION_SQL'
BEGIN;
DELETE FROM lead_drafts WHERE expires_at <= clock_timestamp();
DELETE FROM sessions
 WHERE expires_at < clock_timestamp() - make_interval(days => :log_days);
DELETE FROM webhook_inbox
 WHERE received_at < clock_timestamp() - make_interval(days => :log_days);
DELETE FROM integration_outbox
 WHERE completed_at IS NOT NULL
   AND completed_at < clock_timestamp() - make_interval(days => :log_days);
DELETE FROM submissions
 WHERE created_at < clock_timestamp() - make_interval(days => :submission_days);
DELETE FROM max_users AS candidate
 WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.max_user_id = candidate.max_user_id)
   AND NOT EXISTS (SELECT 1 FROM lead_drafts WHERE lead_drafts.max_user_id = candidate.max_user_id)
   AND NOT EXISTS (SELECT 1 FROM submissions WHERE submissions.max_user_id = candidate.max_user_id)
   AND NOT EXISTS (SELECT 1 FROM documents WHERE documents.max_user_id = candidate.max_user_id);
COMMIT;
RETENTION_SQL

backup_directory="${DEPLOY_ROOT}/shared/backups/database"
if [[ -d "${backup_directory}" ]]; then
  find "${backup_directory}" -maxdepth 1 -type f -name 'craft72-*.dump' \
    -mmin "+$((BACKUP_RETENTION_DAYS * 24 * 60))" -delete
fi

printf '%s\n' "${now_epoch}" >"${LAST_RUN_FILE}.tmp"
mv -f -- "${LAST_RUN_FILE}.tmp" "${LAST_RUN_FILE}"
echo "Retention cleanup completed."
