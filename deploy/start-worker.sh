#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$-" == *x* ]]; then
  echo "Refusing to start with shell tracing enabled." >&2
  exit 2
fi

DEPLOY_ROOT="${CRAFT72_DEPLOY_ROOT:-/home/mun/apps/craft72-max-app}"
ENVIRONMENT_FILE="${CRAFT72_ENV_FILE:-${DEPLOY_ROOT}/shared/.env}"
WORKER_ENTRYPOINT="${CRAFT72_WORKER_ENTRYPOINT:?CRAFT72_WORKER_ENTRYPOINT is required}"

[[ -f "${ENVIRONMENT_FILE}" && -O "${ENVIRONMENT_FILE}" ]] || {
  echo "The protected application environment is missing or has the wrong owner." >&2
  exit 2
}
[[ -f "${WORKER_ENTRYPOINT}" ]] || {
  echo "The worker entrypoint is missing." >&2
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
# platform-api2.max.ru uses the Russian Trusted Root CA installed in the host trust store.
export NODE_USE_SYSTEM_CA=1

exec node "${WORKER_ENTRYPOINT}"
