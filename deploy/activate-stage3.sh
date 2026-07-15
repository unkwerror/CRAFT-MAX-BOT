#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$-" == *x* ]]; then
  echo "Refusing to activate with shell tracing enabled." >&2
  exit 2
fi

DEPLOY_ROOT="${1:?DEPLOY_ROOT is required}"
RELEASE_ID="${2:?RELEASE_ID is required}"

[[ "${DEPLOY_ROOT}" =~ ^/[A-Za-z0-9._/-]+$ ]] &&
  [[ "${DEPLOY_ROOT}" != *..* ]] &&
  [[ "${DEPLOY_ROOT}" != *//* ]] || {
  echo "DEPLOY_ROOT is invalid." >&2
  exit 2
}
[[ "${RELEASE_ID}" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || {
  echo "RELEASE_ID is invalid." >&2
  exit 2
}

INCOMING_DIR="${DEPLOY_ROOT}/releases/.incoming-${RELEASE_ID}"
RELEASE_DIR="${DEPLOY_ROOT}/releases/${RELEASE_ID}"
CURRENT_LINK="${DEPLOY_ROOT}/current"
CURRENT_CANDIDATE="${DEPLOY_ROOT}/current.next.${RELEASE_ID}"
ENVIRONMENT_FILE="${DEPLOY_ROOT}/shared/.env"
STATE_DIRECTORY="${DEPLOY_ROOT}/shared/deploy-state"
PREVIOUS_FILE="${STATE_DIRECTORY}/${RELEASE_ID}.previous"
BACKUP_DIRECTORY="${DEPLOY_ROOT}/shared/backups/database"
LOG_DIRECTORY="${DEPLOY_ROOT}/shared/logs"
switched=false
previous_release=""

for command_name in curl node pg_dump pm2 readlink; do
  command -v "${command_name}" >/dev/null || {
    echo "Required server command is missing: ${command_name}." >&2
    exit 2
  }
done

[[ -d "${DEPLOY_ROOT}/.deploy-lock" ]] || {
  echo "Deployment lock is not held." >&2
  exit 2
}
[[ -d "${INCOMING_DIR}" && ! -e "${RELEASE_DIR}" ]] || {
  echo "Incoming release is missing or immutable release already exists." >&2
  exit 2
}
[[ -f "${ENVIRONMENT_FILE}" && -O "${ENVIRONMENT_FILE}" ]] || {
  echo "The protected application environment is missing or has the wrong owner." >&2
  exit 2
}

umask 077
mkdir -p "${STATE_DIRECTORY}" "${BACKUP_DIRECTORY}" "${LOG_DIRECTORY}"

if [[ -L "${CURRENT_LINK}" ]]; then
  previous_release="$(readlink "${CURRENT_LINK}")"
  [[ "${previous_release}" =~ ^releases/[A-Za-z0-9._-]+$ ]] || {
    echo "Current release pointer is outside the release directory." >&2
    exit 2
  }
fi
printf '%s\n' "${previous_release}" >"${PREVIOUS_FILE}.tmp"
mv -f -- "${PREVIOUS_FILE}.tmp" "${PREVIOUS_FILE}"

rollback_on_error() {
  local status=$?
  trap - ERR
  set +e

  if [[ "${switched}" == true ]]; then
    if [[ -n "${previous_release}" ]]; then
      ln -s "${previous_release}" "${CURRENT_CANDIDATE}"
      mv -Tf "${CURRENT_CANDIDATE}" "${CURRENT_LINK}"
      if [[ -f "${CURRENT_LINK}/deploy/ecosystem.config.cjs" ]]; then
        CRAFT72_DEPLOY_ROOT="${DEPLOY_ROOT}" CRAFT72_ENV_FILE="${ENVIRONMENT_FILE}" \
          pm2 startOrReload "${CURRENT_LINK}/deploy/ecosystem.config.cjs" \
          --only craft72-max-api --update-env >/dev/null
      else
        pm2 delete craft72-max-api >/dev/null 2>&1 || true
      fi
    else
      if [[ "$(readlink "${CURRENT_LINK}" 2>/dev/null)" == "releases/${RELEASE_ID}" ]]; then
        rm -f -- "${CURRENT_LINK}"
      fi
      pm2 delete craft72-max-api >/dev/null 2>&1 || true
    fi
  fi

  rm -f -- "${CURRENT_CANDIDATE}"

  echo "Stage 3 activation failed; the previous application pointer was restored." >&2
  exit "${status}"
}
trap rollback_on_error ERR

backup_file="${BACKUP_DIRECTORY}/craft72-${RELEASE_ID}.dump"
backup_temporary="${backup_file}.tmp"
echo "Creating the pre-migration database backup..."
if ! (
  set -a
  # shellcheck disable=SC1090
  . "${ENVIRONMENT_FILE}" 2>/dev/null
  set +a
  : "${DATABASE_URL:?}"
  PGDATABASE="${DATABASE_URL}" pg_dump --format=custom --compress=6 --file="${backup_temporary}"
) 2>/dev/null; then
  rm -f -- "${backup_temporary}"
  echo "The pre-migration database backup failed; connection details were suppressed." >&2
  false
fi
test -s "${backup_temporary}"
chmod 600 "${backup_temporary}"
mv -f -- "${backup_temporary}" "${backup_file}"

echo "Applying all pending reviewed migrations before the release switch..."
(
  cd "${INCOMING_DIR}/api"
  set -a
  # shellcheck disable=SC1090
  . "${ENVIRONMENT_FILE}" 2>/dev/null
  set +a
  : "${DATABASE_URL:?}"
  NODE_ENV=production node run-migrations.mjs
)

chmod -R go-rwx "${INCOMING_DIR}/api" "${INCOMING_DIR}/deploy" "${INCOMING_DIR}/scripts"
find "${INCOMING_DIR}" \
  \( -path "${INCOMING_DIR}/api" -o -path "${INCOMING_DIR}/deploy" -o -path "${INCOMING_DIR}/scripts" \) \
  -prune -o -type d -exec chmod 755 {} +
find "${INCOMING_DIR}" \
  \( -path "${INCOMING_DIR}/api" -o -path "${INCOMING_DIR}/deploy" -o -path "${INCOMING_DIR}/scripts" \) \
  -prune -o -type f -exec chmod 644 {} +
chmod 750 "${INCOMING_DIR}/deploy/start-api.sh" "${INCOMING_DIR}/deploy/activate-stage3.sh" \
  "${INCOMING_DIR}/deploy/rollback-stage3.sh" "${INCOMING_DIR}/scripts/cleanup-stage3-retention.sh"
chmod 751 "${INCOMING_DIR}"
mv "${INCOMING_DIR}" "${RELEASE_DIR}"

ln -s "releases/${RELEASE_ID}" "${CURRENT_CANDIDATE}"
mv -Tf "${CURRENT_CANDIDATE}" "${CURRENT_LINK}"
switched=true

echo "Starting or reloading only craft72-max-api..."
CRAFT72_DEPLOY_ROOT="${DEPLOY_ROOT}" CRAFT72_ENV_FILE="${ENVIRONMENT_FILE}" \
  pm2 startOrReload "${CURRENT_LINK}/deploy/ecosystem.config.cjs" \
  --only craft72-max-api --update-env

ready=false
for _attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  response="$(curl --fail --silent --show-error --max-time 5 \
    'http://127.0.0.1:4100/health/ready' || true)"
  if [[ "${response}" == *'"status":"ok"'* ]]; then
    ready=true
    break
  fi
  sleep 2
done
[[ "${ready}" == true ]] || false

trap - ERR
echo "Release ${RELEASE_ID} is ready on the loopback API endpoint."
