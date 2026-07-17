#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$-" == *x* ]]; then
  echo "Refusing to deploy with shell tracing enabled: it could expose environment values." >&2
  exit 2
fi

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-109.174.15.132}"
DEPLOY_USER="${DEPLOY_USER:-mun}"
DEPLOY_PORT="${DEPLOY_PORT:-2222}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/mun/apps/craft72-max-app}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://craft72app.ru}"
API_HEALTHCHECK_URL="${API_HEALTHCHECK_URL:-${PUBLIC_BASE_URL}/health/ready}"
STATIC_HEALTHCHECK_URL="${STATIC_HEALTHCHECK_URL:-${PUBLIC_BASE_URL}/release-id.txt}"
WEBHOOK_HEALTHCHECK_URL="${WEBHOOK_HEALTHCHECK_URL:-${PUBLIC_BASE_URL}/webhooks/max}"

die() {
  echo "$*" >&2
  exit 2
}

[[ "${DEPLOY_PORT}" =~ ^[0-9]+$ ]] &&
  ((DEPLOY_PORT >= 1 && DEPLOY_PORT <= 65535)) || die "DEPLOY_PORT must be an integer from 1 to 65535."
[[ "${DEPLOY_HOST}" =~ ^[A-Za-z0-9.-]+$ ]] || die "DEPLOY_HOST contains unsupported characters."
[[ "${DEPLOY_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "DEPLOY_USER is invalid."
[[ "${DEPLOY_ROOT}" =~ ^/[A-Za-z0-9._/-]+$ ]] &&
  [[ "${DEPLOY_ROOT}" != *..* ]] &&
  [[ "${DEPLOY_ROOT}" != *//* ]] || die "DEPLOY_ROOT must be a normalized absolute path."
[[ "${PUBLIC_BASE_URL}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] ||
  die "PUBLIC_BASE_URL must be an HTTPS origin without a path."

for command_name in corepack curl git grep rg scp sha256sum ssh tar; do
  command -v "${command_name}" >/dev/null || die "Required command is missing: ${command_name}."
done

if [[ -n "$(git -C "${REPOSITORY_ROOT}" status --porcelain --untracked-files=normal)" ]]; then
  die "Refusing to deploy a dirty worktree. Commit or stash every change first."
fi

git_revision="$(git -C "${REPOSITORY_ROOT}" rev-parse --verify HEAD)"
short_revision="${git_revision:0:12}"
release_id="$(date -u +%Y%m%dT%H%M%SZ)-${short_revision}"
release_dir="${DEPLOY_ROOT}/releases/${release_id}"
incoming_dir="${DEPLOY_ROOT}/releases/.incoming-${release_id}"
upload_archive="${DEPLOY_ROOT}/releases/.upload-${release_id}.tar.gz"
upload_checksum="${upload_archive}.sha256"
lock_dir="${DEPLOY_ROOT}/.deploy-lock"
target="${DEPLOY_USER}@${DEPLOY_HOST}"
build_root="$(mktemp -d /tmp/craft72-stage6-deploy.XXXXXXXX)"
payload_dir="${build_root}/payload"
archive_file="${build_root}/${release_id}.tar.gz"
checksum_file="${archive_file}.sha256"
lock_acquired=false

ssh_command=(
  ssh
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -p "${DEPLOY_PORT}"
  "${target}"
)
scp_command=(
  scp
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -P "${DEPLOY_PORT}"
)

cleanup() {
  local status=$?
  trap - EXIT
  rm -rf -- "${build_root}"

  if [[ "${lock_acquired}" == true ]]; then
    "${ssh_command[@]}" \
      "rm -rf -- '${incoming_dir}' && rm -f -- '${upload_archive}' '${upload_checksum}' '${DEPLOY_ROOT}/current.next.${release_id}' '${DEPLOY_ROOT}/current.rollback.${release_id}' && rmdir '${lock_dir}'" \
      >/dev/null 2>&1 || true
  fi

  exit "${status}"
}
trap cleanup EXIT

echo "Reading the public build settings from the protected server environment..."
if ! public_configuration="$("${ssh_command[@]}" bash -s -- "${DEPLOY_ROOT}/shared/.env" 2>/dev/null <<'REMOTE_CONFIG'
set -Eeuo pipefail
[[ "$-" != *x* ]] || exit 2
environment_file="$1"
[[ -f "${environment_file}" && -O "${environment_file}" ]] || exit 2
set -a
# shellcheck disable=SC1090
if ! . "${environment_file}" 2>/dev/null; then
  exit 2
fi
set +a
: "${PRIVACY_POLICY_URL:?}"
: "${CONSENT_VERSION:?}"
: "${MAX_BOT_PUBLIC_NAME:?}"
: "${MAX_MANAGER_USER_ID:?}"
[[ "${PRIVACY_POLICY_URL}" != *$'\n'* && "${CONSENT_VERSION}" != *$'\n'* && \
  "${MAX_BOT_PUBLIC_NAME}" != *$'\n'* && "${MAX_MANAGER_USER_ID}" != *$'\n'* ]] || exit 2
printf '%s\n%s\n%s\n%s\n' \
  "${PRIVACY_POLICY_URL}" "${CONSENT_VERSION}" "${MAX_BOT_PUBLIC_NAME}" "${MAX_MANAGER_USER_ID}"
REMOTE_CONFIG
)"; then
  die "Could not read privacy URL, consent version, bot name and manager id from the server environment."
fi
mapfile -t public_values <<<"${public_configuration}"
[[ "${#public_values[@]}" -eq 4 ]] || die "Server public build settings are missing or malformed."
PRIVACY_POLICY_URL="${public_values[0]}"
CONSENT_VERSION="${public_values[1]}"
MAX_BOT_PUBLIC_NAME="${public_values[2]}"
MAX_MANAGER_USER_ID="${public_values[3]}"
unset public_configuration public_values

[[ "${PRIVACY_POLICY_URL}" == "${PUBLIC_BASE_URL}/privacy.html" ]] ||
  die "PRIVACY_POLICY_URL must be ${PUBLIC_BASE_URL}/privacy.html for this production release."
[[ "${CONSENT_VERSION}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] ||
  die "CONSENT_VERSION has an invalid format."
[[ "${MAX_BOT_PUBLIC_NAME}" =~ ^[A-Za-z0-9_]+$ ]] ||
  die "MAX_BOT_PUBLIC_NAME has an invalid format."
[[ "${MAX_MANAGER_USER_ID}" =~ ^[1-9][0-9]{4,20}$ ]] ||
  die "MAX_MANAGER_USER_ID must be a numeric MAX user id."
MAX_BOT_URL="https://max.ru/${MAX_BOT_PUBLIC_NAME}"
unset MAX_BOT_PUBLIC_NAME

privacy_file="${REPOSITORY_ROOT}/apps/miniapp/public/privacy.html"
terms_file="${REPOSITORY_ROOT}/apps/miniapp/public/terms.html"
[[ -s "${privacy_file}" ]] || die "The production privacy document is missing: apps/miniapp/public/privacy.html."
[[ -s "${terms_file}" ]] || die "The production terms document is missing: apps/miniapp/public/terms.html."
grep -Fq "<strong>${CONSENT_VERSION}</strong>" "${privacy_file}" ||
  die "privacy.html does not declare the CONSENT_VERSION from the server environment."
grep -Fq ">${CONSENT_VERSION}</code>" "${privacy_file}" ||
  die "privacy.html footer does not match the CONSENT_VERSION from the server environment."
grep -Fq "<strong>${CONSENT_VERSION}</strong>" "${terms_file}" ||
  die "terms.html does not declare the CONSENT_VERSION from the server environment."

if migration_violations="$(rg --line-number --ignore-case \
  '^[[:space:]]*(drop[[:space:]]|truncate[[:space:]]|delete[[:space:]]+from|alter[[:space:]].*[[:space:]]drop[[:space:]]|rename[[:space:]])' \
  "${REPOSITORY_ROOT}/packages/database/drizzle" \
  --glob '*.sql' --glob '!**/rollback/**')"; then
  printf '%s\n' "${migration_violations}" >&2
  die "A forward migration contains a destructive statement. Stage 6 deploy accepts expand-only migrations."
else
  migration_scan_status=$?
  [[ "${migration_scan_status}" -eq 1 ]] || die "Forward migrations could not be inspected safely."
fi
unset migration_violations migration_scan_status

echo "Installing and building committed sources..."
(
  cd "${REPOSITORY_ROOT}"
  NODE_ENV=development corepack pnpm install --frozen-lockfile
  corepack pnpm --filter @craft72/api... --filter @craft72/worker... --if-present run build
  VITE_PRIVACY_POLICY_URL="${PRIVACY_POLICY_URL}" \
    VITE_CONSENT_VERSION="${CONSENT_VERSION}" \
    VITE_MAX_BOT_URL="${MAX_BOT_URL}" \
    VITE_MAX_MANAGER_USER_ID="${MAX_MANAGER_USER_ID}" \
    corepack pnpm --filter @craft72/miniapp build
)
unset PRIVACY_POLICY_URL CONSENT_VERSION MAX_BOT_URL MAX_MANAGER_USER_ID

[[ -s "${REPOSITORY_ROOT}/apps/miniapp/dist/index.html" ]] || die "Mini App build did not produce index.html."
[[ -s "${REPOSITORY_ROOT}/apps/miniapp/dist/privacy.html" ]] || die "Mini App build did not include privacy.html."
[[ -s "${REPOSITORY_ROOT}/apps/miniapp/dist/terms.html" ]] || die "Mini App build did not include terms.html."
[[ -s "${REPOSITORY_ROOT}/apps/api/dist/index.js" ]] || die "API build did not produce dist/index.js."
[[ -s "${REPOSITORY_ROOT}/apps/worker/dist/index.js" ]] || die "Worker build did not produce dist/index.js."

mkdir -p "${payload_dir}/api" "${payload_dir}/worker" "${payload_dir}/deploy" "${payload_dir}/scripts"
cp -a "${REPOSITORY_ROOT}/apps/miniapp/dist/." "${payload_dir}/"

echo "Creating a portable production API package..."
(
  cd "${REPOSITORY_ROOT}"
  corepack pnpm --filter @craft72/api deploy --prod --legacy "${payload_dir}/api"
)
echo "Creating a portable production worker package..."
(
  cd "${REPOSITORY_ROOT}"
  corepack pnpm --filter @craft72/worker deploy --prod --legacy "${payload_dir}/worker"
)
cp -a "${REPOSITORY_ROOT}/deploy/." "${payload_dir}/deploy/"
cp -a "${REPOSITORY_ROOT}/scripts/cleanup-stage3-retention.sh" "${payload_dir}/scripts/"
cp -a "${REPOSITORY_ROOT}/scripts/max-webhook-subscription.sh" "${payload_dir}/scripts/"
cp -a "${REPOSITORY_ROOT}/deploy/run-migrations.mjs" "${payload_dir}/api/run-migrations.mjs"
printf '%s\n' "${release_id}" >"${payload_dir}/release-id.txt"
printf '%s\n' "${git_revision}" >"${payload_dir}/git-revision.txt"

tar --sort=name --owner=0 --group=0 --numeric-owner -C "${payload_dir}" -czf "${archive_file}" .
(
  cd "${build_root}"
  sha256sum "$(basename -- "${archive_file}")" >"$(basename -- "${checksum_file}")"
)

echo "Acquiring the deployment lock on ${target}..."
if ! "${ssh_command[@]}" \
  "test -d '${DEPLOY_ROOT}/releases' && test -d '${DEPLOY_ROOT}/shared' && mkdir '${lock_dir}'"; then
  die "Deployment directories are missing or another deployment holds the lock."
fi
lock_acquired=true

"${ssh_command[@]}" "test ! -e '${release_dir}' && test ! -e '${incoming_dir}'"
echo "Uploading immutable Stage 6 release ${release_id}..."
"${scp_command[@]}" "${archive_file}" "${target}:${upload_archive}"
"${scp_command[@]}" "${checksum_file}" "${target}:${upload_checksum}"

"${ssh_command[@]}" bash -s -- \
  "${DEPLOY_ROOT}" "${release_id}" "$(basename -- "${archive_file}")" <<'REMOTE_UNPACK'
set -Eeuo pipefail
deploy_root="$1"
release_id="$2"
archive_basename="$3"
incoming_dir="${deploy_root}/releases/.incoming-${release_id}"
upload_archive="${deploy_root}/releases/.upload-${release_id}.tar.gz"
upload_checksum="${upload_archive}.sha256"
test -d "${deploy_root}/.deploy-lock"
test ! -e "${incoming_dir}"
cd "${deploy_root}/releases"
sed -i "s#${archive_basename}#$(basename -- "${upload_archive}")#" "${upload_checksum}"
sha256sum --check "${upload_checksum}"
mkdir "${incoming_dir}"
tar -xzf "${upload_archive}" -C "${incoming_dir}" --no-same-owner
rm -f -- "${upload_archive}" "${upload_checksum}"
test -s "${incoming_dir}/index.html"
test -s "${incoming_dir}/privacy.html"
test -s "${incoming_dir}/terms.html"
test -s "${incoming_dir}/api/dist/index.js"
test -s "${incoming_dir}/worker/dist/index.js"
test -s "${incoming_dir}/deploy/activate-stage3.sh"
REMOTE_UNPACK

echo "Backing up the database, applying expand-only migrations and switching atomically..."
"${ssh_command[@]}" \
  "bash '${incoming_dir}/deploy/activate-stage3.sh' '${DEPLOY_ROOT}' '${release_id}'"

echo "Checking public static, API and webhook endpoints..."
healthy=false
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  observed_release="$(curl --fail --silent --show-error --max-time 10 "${STATIC_HEALTHCHECK_URL}" || true)"
  api_status="$(curl --fail --silent --show-error --max-time 10 "${API_HEALTHCHECK_URL}" || true)"
  webhook_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
    --request POST --header 'Content-Type: application/json' \
    --data '{"update_type":"deployment_probe","timestamp":0}' \
    "${WEBHOOK_HEALTHCHECK_URL}" || true)"
  if [[ "${observed_release}" == "${release_id}" && "${api_status}" == *'"status":"ok"'* && \
    "${webhook_status}" == "401" ]]; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "${healthy}" != true ]]; then
  echo "Public health checks failed; restoring the previous release pointer." >&2
  "${ssh_command[@]}" \
    "bash '${release_dir}/deploy/rollback-stage3.sh' '${DEPLOY_ROOT}' '${release_id}'" || true
  exit 1
fi

"${ssh_command[@]}" "rmdir '${lock_dir}'"
lock_acquired=false

echo "Deployed ${release_id}."
echo "Static: ${STATIC_HEALTHCHECK_URL}"
echo "API: ${API_HEALTHCHECK_URL}"
echo "Webhook: ${WEBHOOK_HEALTHCHECK_URL}"
