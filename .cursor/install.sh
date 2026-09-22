#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

NODE_VERSION="$(cat .nvmrc)"
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
nvm use "$NODE_VERSION"

NODE_BIN="$NVM_DIR/versions/node/v${NODE_VERSION}/bin"
BASHRC="$HOME/.bashrc"
MARKER="# workout-logger: pinned node on PATH"
if [ -f "$BASHRC" ]; then
  grep -vF "$MARKER" "$BASHRC" >"$BASHRC.tmp" && mv "$BASHRC.tmp" "$BASHRC"
fi
printf '%s\n' "export PATH=\"$NODE_BIN:\$PATH\" $MARKER" >>"$BASHRC"

corepack enable

pnpm install --frozen-lockfile

pnpm exec playwright install --with-deps chromium || pnpm exec playwright install chromium
