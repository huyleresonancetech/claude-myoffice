#!/usr/bin/env bash
# Symlink this repo's agents/ and skills/ into ~/.claude/ so Claude Code CLI picks them up.
# Safe to re-run. Never overwrites files it doesn't own (i.e. anything that isn't already
# a symlink pointing into this repo).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"

link_item() {
  local src="$1" dst="$2"
  if [ -L "$dst" ]; then
    local current
    current="$(readlink "$dst")"
    if [ "$current" = "$src" ]; then
      echo "  ok      $dst"
    else
      ln -sfn "$src" "$dst"
      echo "  relink  $dst -> $src (was: $current)"
    fi
  elif [ -e "$dst" ]; then
    echo "  SKIP    $dst exists and is not a myoffice symlink — resolve manually"
  else
    ln -s "$src" "$dst"
    echo "  link    $dst -> $src"
  fi
}

echo "Installing claude-myoffice into $CLAUDE_DIR"
mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/skills"

echo "agents:"
for f in "$REPO_DIR"/agents/*.md; do
  link_item "$f" "$CLAUDE_DIR/agents/$(basename "$f")"
done

echo "skills:"
for d in "$REPO_DIR"/skills/*/; do
  d="${d%/}"
  link_item "$d" "$CLAUDE_DIR/skills/$(basename "$d")"
done

echo "Done. Open any repo with Claude Code and run: /dev \"<task>\""
