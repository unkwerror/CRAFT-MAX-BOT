#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$-" == *x* ]]; then
  echo "Refusing to roll back with shell tracing enabled." >&2
  exit 2
fi

DEPLOY_ROOT="${1:?DEPLOY_ROOT is required}"
FAILED_RELEASE_ID="${2:?FAILED_RELEASE_ID is required}"
CURRENT_LINK="${DEPLOY_ROOT}/current"
CURRENT_CANDIDATE="${DEPLOY_ROOT}/current.rollback.${FAILED_RELEASE_ID}"
ENVIRONMENT_FILE="${DEPLOY_ROOT}/shared/.env"
PREVIOUS_FILE="${DEPLOY_ROOT}/shared/deploy-state/${FAILED_RELEASE_ID}.previous"

[[ "${DEPLOY_ROOT}" =~ ^/[A-Za-z0-9._/-]+$ ]] && [[ "${DEPLOY_ROOT}" != *..* ]] || exit 2
[[ "${FAILED_RELEASE_ID}" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || exit 2
[[ -d "${DEPLOY_ROOT}/.deploy-lock" ]] || {
  echo "Deployment lock is not held." >&2
  exit 2
}
[[ -f "${PREVIOUS_FILE}" && -O "${PREVIOUS_FILE}" ]] || {
  echo "Rollback state is missing." >&2
  exit 2
}
[[ "$(readlink "${CURRENT_LINK}" 2>/dev/null)" == "releases/${FAILED_RELEASE_ID}" ]] || {
  echo "Refusing rollback: current no longer points to the failed release." >&2
  exit 2
}
rm -f -- "${CURRENT_CANDIDATE}"

previous_release="$(<"${PREVIOUS_FILE}")"
if [[ -n "${previous_release}" ]]; then
  [[ "${previous_release}" =~ ^releases/[A-Za-z0-9._-]+$ ]] || exit 2
  [[ -d "${DEPLOY_ROOT}/${previous_release}" ]] || {
    echo "Previous immutable release is missing." >&2
    exit 2
  }
  ln -s "${previous_release}" "${CURRENT_CANDIDATE}"
  mv -Tf "${CURRENT_CANDIDATE}" "${CURRENT_LINK}"

  if [[ -f "${CURRENT_LINK}/deploy/ecosystem.config.cjs" ]]; then
    CRAFT72_DEPLOY_ROOT="${DEPLOY_ROOT}" CRAFT72_ENV_FILE="${ENVIRONMENT_FILE}" \
      pm2 startOrReload "${CURRENT_LINK}/deploy/ecosystem.config.cjs" \
      --only craft72-max-api --update-env
  else
    pm2 delete craft72-max-api >/dev/null 2>&1 || true
  fi
else
  rm -f -- "${CURRENT_LINK}"
  pm2 delete craft72-max-api >/dev/null 2>&1 || true
fi

echo "Application pointer rolled back. Expand-only database migrations were intentionally retained."
