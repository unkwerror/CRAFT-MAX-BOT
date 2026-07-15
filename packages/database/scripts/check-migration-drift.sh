#!/bin/sh

set -eu

temporary_directory="$(mktemp -d)"
temporary_migration_directory="$temporary_directory/drizzle"
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

cp -R drizzle "$temporary_migration_directory"
drizzle_output_directory="$(realpath --relative-to=. "$temporary_migration_directory")"

hash_tree() {
  find "$1" -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | cut -d ' ' -f 1
}

before="$(hash_tree "$temporary_migration_directory")"

if ! generation_output="$(
  drizzle-kit generate \
    --dialect=postgresql \
    --schema=src/schema.ts \
    --out="$drizzle_output_directory" \
    --name=schema_drift_check 2>&1
)"; then
  echo "$generation_output" >&2
  exit 1
fi

echo "$generation_output"

case "$generation_output" in
  *"Error:"*)
    echo 'drizzle-kit reported an error while checking migration drift.' >&2
    exit 1
    ;;
esac

after="$(hash_tree "$temporary_migration_directory")"

if [ "$before" != "$after" ]; then
  echo 'Database schema drift detected: generate and commit a migration before continuing.' >&2
  exit 1
fi

echo 'Database schema and committed migration snapshot are synchronized.'
