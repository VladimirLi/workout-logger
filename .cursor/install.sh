#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

NODE_VERSION="$(cat .nvmrc)"
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
nvm use "$NODE_VERSION"

BASHRC="$HOME/.bashrc"
if ! grep -qF 'nvm use default' "$BASHRC" 2>/dev/null; then
  printf '\n%s\n' 'nvm use default >/dev/null 2>&1 || true' >>"$BASHRC"
fi

corepack enable

pnpm install --frozen-lockfile

pnpm exec playwright install --with-deps chromium || pnpm exec playwright install chromium
