#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-109.174.15.132}"
DEPLOY_USER="${DEPLOY_USER:-mun}"
DEPLOY_PORT="${DEPLOY_PORT:-2222}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/mun/apps/craft72-max-app}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-https://craft72app.ru/release-id.txt}"

if [[ ! "${DEPLOY_PORT}" =~ ^[0-9]+$ ]] ||
  ((DEPLOY_PORT < 1 || DEPLOY_PORT > 65535)); then
  echo "DEPLOY_PORT must be an integer from 1 to 65535" >&2
  exit 2
fi
if [[ ! "${DEPLOY_HOST}" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "DEPLOY_HOST contains unsupported characters" >&2
  exit 2
fi
if [[ ! "${DEPLOY_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "DEPLOY_USER is invalid" >&2
  exit 2
fi
if [[ ! "${DEPLOY_ROOT}" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
  [[ "${DEPLOY_ROOT}" == *..* ]] ||
  [[ "${DEPLOY_ROOT}" == *//* ]]; then
  echo "DEPLOY_ROOT must be a normalized absolute path" >&2
  exit 2
fi
if [[ -n "$(git -C "${REPOSITORY_ROOT}" status --porcelain)" ]]; then
  echo "Refusing to deploy a dirty worktree. Commit or stash changes first." >&2
  exit 2
fi

git_revision="$(git -C "${REPOSITORY_ROOT}" rev-parse --short=12 HEAD)"
release_id="$(date -u +%Y%m%dT%H%M%S%NZ)-${git_revision}"
release_dir="${DEPLOY_ROOT}/releases/${release_id}"
incoming_dir="${DEPLOY_ROOT}/releases/.incoming-${release_id}"
lock_dir="${DEPLOY_ROOT}/.deploy-lock"
current_link="${DEPLOY_ROOT}/current"
current_candidate="${DEPLOY_ROOT}/current.next.${release_id}"
dist_dir="${REPOSITORY_ROOT}/apps/miniapp/dist"
manifest_file="${dist_dir}/.release-manifest.sha256"
target="${DEPLOY_USER}@${DEPLOY_HOST}"
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
lock_acquired=false

cleanup() {
  rm -f -- "${manifest_file}" "${dist_dir}/release-id.txt"
  if [[ "${lock_acquired}" == true ]]; then
    "${ssh_command[@]}" \
      "rm -rf '${incoming_dir}' && rm -f '${current_candidate}' && rmdir '${lock_dir}'" \
      >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Building @craft72/miniapp from the committed lock file..."
(
  cd "${REPOSITORY_ROOT}"
  corepack pnpm install --frozen-lockfile
  corepack pnpm --filter @craft72/miniapp build
)

if [[ ! -f "${dist_dir}/index.html" ]]; then
  echo "Mini App build did not produce dist/index.html" >&2
  exit 1
fi

printf '%s\n' "${release_id}" >"${dist_dir}/release-id.txt"
(
  cd "${dist_dir}"
  find . -type f ! -name '.release-manifest.sha256' -print0 |
    LC_ALL=C sort -z |
    xargs -0 sha256sum >"${manifest_file}"
)

echo "Acquiring the deployment lock on ${target}..."
if ! "${ssh_command[@]}" "mkdir '${lock_dir}'"; then
  echo "Another deployment may be running; lock was not acquired." >&2
  exit 1
fi
lock_acquired=true

echo "Uploading immutable release ${release_id}..."
"${ssh_command[@]}" \
  "test ! -e '${release_dir}' && test ! -e '${incoming_dir}' && mkdir '${incoming_dir}' && chmod 750 '${incoming_dir}'"
"${scp_command[@]}" -r "${dist_dir}/." "${target}:${incoming_dir}/"

"${ssh_command[@]}" \
  "cd '${incoming_dir}' && sha256sum -c '.release-manifest.sha256' >/dev/null && rm '.release-manifest.sha256' && find . -type d -exec chmod 550 {} + && find . -type f -exec chmod 440 {} + && mv '${incoming_dir}' '${release_dir}'"

previous_release="$(
  "${ssh_command[@]}" "readlink '${current_link}' 2>/dev/null || true"
)"

echo "Switching the current release atomically..."
"${ssh_command[@]}" \
  "ln -s 'releases/${release_id}' '${current_candidate}' && mv -Tf '${current_candidate}' '${current_link}' && test -s '${current_link}/index.html'"

echo "Checking ${HEALTHCHECK_URL}..."
healthy=false
for _attempt in 1 2 3 4 5; do
  observed_release="$(
    curl --fail --silent --show-error --location --max-time 15 "${HEALTHCHECK_URL}" || true
  )"
  if [[ "${observed_release}" == "${release_id}" ]]; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "${healthy}" != true ]]; then
  echo "Health check did not return release ${release_id}; rolling back." >&2
  if [[ "${previous_release}" =~ ^releases/[A-Za-z0-9._-]+$ ]]; then
    "${ssh_command[@]}" \
      "ln -s '${previous_release}' '${current_candidate}' && mv -Tf '${current_candidate}' '${current_link}'"
  else
    "${ssh_command[@]}" \
      "test \"\$(readlink '${current_link}')\" != 'releases/${release_id}' || rm -f '${current_link}'"
  fi
  exit 1
fi

"${ssh_command[@]}" "rmdir '${lock_dir}'"
lock_acquired=false

echo "Deployed ${release_id}."
echo "Current release: ${current_link}"
