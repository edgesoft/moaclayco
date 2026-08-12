#!/bin/sh

set -eu

marker="node_modules/.package-lock.sha256"
current_hash=$(node -e "const fs=require('node:fs');const crypto=require('node:crypto');const lock=fs.readFileSync('package-lock.json');process.stdout.write(crypto.createHash('sha256').update(lock).digest('hex'))")
installed_hash=""

if [ -f "$marker" ]; then
  IFS= read -r installed_hash < "$marker"
fi

if [ "$current_hash" != "$installed_hash" ]; then
  echo "package-lock.json changed; refreshing Docker dependencies"
  npm ci --include=dev
  printf '%s\n' "$current_hash" > "$marker"
fi

exec "$@"
