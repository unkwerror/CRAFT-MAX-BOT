#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$-" == *x* ]]; then
  echo "Refusing to manage the webhook with shell tracing enabled." >&2
  exit 2
fi

readonly REQUESTED_ACTION="${1:-status}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/mun/apps/craft72-max-app}"
ENVIRONMENT_FILE="${ENVIRONMENT_FILE:-${DEPLOY_ROOT}/shared/.env}"

case "${REQUESTED_ACTION}" in
  status | register | unregister) ;;
  *)
    echo "Usage: $0 [status|register|unregister]" >&2
    exit 2
    ;;
esac

[[ -f "${ENVIRONMENT_FILE}" && -O "${ENVIRONMENT_FILE}" ]] || {
  echo "The protected application environment is missing or has the wrong owner." >&2
  exit 2
}

# shellcheck disable=SC1090
if ! . "${ENVIRONMENT_FILE}" 2>/dev/null; then
  echo "The protected application environment could not be loaded." >&2
  exit 2
fi

: "${MAX_API_BASE_URL:?}"
: "${MAX_BOT_TOKEN:?}"
: "${MAX_WEBHOOK_SECRET:?}"
: "${PUBLIC_BASE_URL:?}"

[[ "${MAX_API_BASE_URL}" == "https://platform-api2.max.ru" ]] || {
  echo "Unsupported MAX API endpoint." >&2
  exit 2
}
[[ "${PUBLIC_BASE_URL}" =~ ^https://[A-Za-z0-9.-]+$ ]] || {
  echo "PUBLIC_BASE_URL must be an HTTPS origin." >&2
  exit 2
}
[[ "${MAX_WEBHOOK_SECRET}" =~ ^[A-Za-z0-9_-]{32,256}$ ]] || {
  echo "MAX_WEBHOOK_SECRET does not satisfy the subscription format." >&2
  exit 2
}

node_binary="$(command -v node)"
# Pass only the values required by the manager. The protected environment can also contain
# database and Tracker credentials, which must never reach this helper process.
(
  while IFS= read -r exported_name; do
    export -n "${exported_name}"
  done < <(compgen -e)
  export ACTION="${REQUESTED_ACTION}"
  export MAX_API_BASE_URL MAX_BOT_TOKEN MAX_WEBHOOK_SECRET PUBLIC_BASE_URL
  export NODE_USE_SYSTEM_CA=1
  "${node_binary}" --input-type=module <<'NODE'
const action = process.env.ACTION;
const baseUrl = process.env.MAX_API_BASE_URL;
const token = process.env.MAX_BOT_TOKEN;
const secret = process.env.MAX_WEBHOOK_SECRET;
const webhookUrl = `${process.env.PUBLIC_BASE_URL}/webhooks/max`;
const headers = { Authorization: token, 'Content-Type': 'application/json' };

let requestUrl = `${baseUrl}/subscriptions`;
let init = { headers, method: 'GET', signal: AbortSignal.timeout(10_000) };
if (action === 'register') {
  init = {
    ...init,
    method: 'POST',
    body: JSON.stringify({
      url: webhookUrl,
      update_types: ['bot_started', 'bot_stopped', 'message_created', 'message_callback'],
      secret,
    }),
  };
} else if (action === 'unregister') {
  requestUrl = `${requestUrl}?url=${encodeURIComponent(webhookUrl)}`;
  init = { ...init, method: 'DELETE' };
}

try {
  const response = await fetch(requestUrl, init);
  if (!response.ok) {
    console.error(`MAX subscription ${action} failed with HTTP ${response.status}.`);
    process.exitCode = 1;
  } else if (action === 'status') {
    const body = await response.json();
    const subscriptions = Array.isArray(body) ? body : body?.subscriptions;
    if (!Array.isArray(subscriptions)) throw new Error('Unexpected subscription response');
    const requiredTypes = ['bot_started', 'bot_stopped', 'message_created', 'message_callback'].sort();
    const matching = subscriptions.find((item) => item?.url === webhookUrl);
    const observedTypes = Array.isArray(matching?.update_types)
      ? [...matching.update_types].filter((item) => typeof item === 'string').sort()
      : [];
    const configured =
      matching !== undefined && JSON.stringify(observedTypes) === JSON.stringify(requiredTypes);
    console.log(
      matching === undefined
        ? 'CRAFT72 webhook registered: no.'
        : `CRAFT72 webhook registered: yes; event filter: ${configured ? 'valid' : 'mismatch'}.`,
    );
    if (!configured && matching !== undefined) process.exitCode = 1;
  } else {
    const body = await response.json();
    if (body?.success !== true) {
      console.error(`MAX subscription ${action} returned an unsuccessful result.`);
      process.exitCode = 1;
    } else {
      console.log(`MAX subscription ${action} completed.`);
    }
  }
} catch {
  console.error(`MAX subscription ${action} failed without exposing response data.`);
  process.exitCode = 1;
}
NODE
)

unset MAX_BOT_TOKEN MAX_WEBHOOK_SECRET TRACKER_TOKEN
