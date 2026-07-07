#!/bin/bash
# open-claude — Claude Code TUI with opencode free models
#
# Usage:
#   ./run.sh                 Interactive TUI
#   ./run.sh --print "prompt"  Non-interactive
#   ./run.sh --help            All flags
#
# Environment (all optional):
#   OPEN_CLAUDE_MODEL       Model name (default: deepseek-v4-flash-free)
#   OPENCODE_API_KEY        API key (default: "public")
#   OPEN_CLAUDE_BASE_URL    API base URL (default: https://opencode.ai/zen/v1)
#
# To use your Anthropic account instead:
#   ANTHROPIC_API_KEY=sk-... ./run.sh

# Portable symlink resolution (works on Linux, macOS, Windows/MinGW)
_resolve_realpath() {
  local script="$1"
  while [ -h "$script" ]; do
    local link="$(readlink "$script")"
    case "$link" in
      /*) script="$link" ;;
      *)  script="$(cd "$(dirname "$script")" && pwd)/$link" ;;
    esac
  done
  cd "$(dirname "$script")" && pwd
}
DIR="$(_resolve_realpath "$0")"
BUN="${BUN:-$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")}"

# Auto-install deps if missing
if [ ! -f "$DIR/node_modules/@anthropic-ai/sandbox-runtime/index.js" ]; then
  echo "→ Installing dependencies..."
  "$BUN" install --cwd "$DIR"
fi

# Dummy API key — needed to skip the OAuth login screen.
# All model queries go through the opencode free tier (OPEN_CLAUDE_ENABLED=true).
DUMMY_KEY="sk-opencode-dummy"

# Last 20 chars of the key is how the config file identifies it (normalizeApiKeyForConfig)
KEY_SUFFIX="${DUMMY_KEY: -20}"

# Persistent config directory for sessions, conversations, etc.
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/open-claude}"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="$CONFIG_DIR/.claude.json"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<CONF
{
  "theme": "dark",
  "hasCompletedOnboarding": true,
  "customApiKeyResponses": {
    "approved": ["$KEY_SUFFIX"]
  }
}
CONF
fi

# Force opencode free tier.
# OPEN_CLAUDE_ENABLED=true bypasses the ANTHROPIC_API_KEY check in isOpencodeEnabled().
# Dummy ANTHROPIC_API_KEY prevents the login screen from showing.
exec env -u ANTHROPIC_AUTH_TOKEN \
  OPEN_CLAUDE_ENABLED=true \
  ANTHROPIC_API_KEY="$DUMMY_KEY" \
  CLAUDE_CONFIG_DIR="$CONFIG_DIR" \
  "$BUN" "$DIR/dev-launcher.ts" "$@"
