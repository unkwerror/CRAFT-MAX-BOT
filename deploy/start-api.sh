#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$-" == *x* ]]; then
  echo "Refusing to start with shell tracing enabled." >&2
  exit 2
fi

DEPLOY_ROOT="${CRAFT72_DEPLOY_ROOT:-/home/mun/apps/craft72-max-app}"
ENVIRONMENT_FILE="${CRAFT72_ENV_FILE:-${DEPLOY_ROOT}/shared/.env}"
API_ENTRYPOINT="${CRAFT72_API_ENTRYPOINT:?CRAFT72_API_ENTRYPOINT is required}"

[[ -f "${ENVIRONMENT_FILE}" && -O "${ENVIRONMENT_FILE}" ]] || {
  echo "The protected application environment is missing or has the wrong owner." >&2
  exit 2
}
[[ -f "${API_ENTRYPOINT}" ]] || {
  echo "The API entrypoint is missing." >&2
  exit 2
}

umask 077
set -a
# shellcheck disable=SC1090
if ! . "${ENVIRONMENT_FILE}" 2>/dev/null; then
  echo "The protected application environment could not be loaded." >&2
  exit 2
fi
set +a
export NODE_ENV=production

exec node "${API_ENTRYPOINT}"
