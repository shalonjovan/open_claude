#!/bin/bash
# open-claude — install a global `open_claude` command
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${HOME}/.local/bin/open_claude"
BUN="${BUN:-$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")}"

# Install dependencies first
if [ ! -f "$DIR/node_modules/@anthropic-ai/sandbox-runtime/index.js" ]; then
  echo "→ Installing dependencies..."
  "$BUN" install --cwd "$DIR"
fi

mkdir -p "${HOME}/.local/bin"
ln -sf "${DIR}/run.sh" "${TARGET}"
chmod +x "${DIR}/run.sh"

echo "Installed → ${TARGET}"
echo "Make sure ${HOME}/.local/bin is in your PATH:"
echo "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
