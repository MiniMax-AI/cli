#!/bin/sh
set -e

# Usage: install.sh [stable|latest|VERSION]
CHANNEL="${1:-stable}"

case "$CHANNEL" in
  stable|latest) ;;
  v*|[0-9]*) ;;
  *)
    echo "Usage: $0 [stable|latest|VERSION]" >&2
    exit 1
    ;;
esac

REPO="MiniMax-AI-Dev/cli"
INSTALL_DIR="${MINIMAX_INSTALL_DIR:-$HOME/.local/bin}"

# Require Node.js >= 18
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install from https://nodejs.org" >&2; exit 1
fi
NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
  echo "Node.js 18+ is required (found: $(node --version))" >&2; exit 1
fi

# Dependency check: curl or wget
if command -v curl >/dev/null 2>&1; then
  download()    { curl -fsSL "$1"; }
  download_to() { curl -fsSL -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  download()    { wget -qO- "$1"; }
  download_to() { wget -qO  "$2" "$1"; }
else
  echo "curl or wget is required." >&2; exit 1
fi

# Resolve version from channel
GH_API="https://api.github.com/repos/${REPO}"
case "$CHANNEL" in
  stable)
    VERSION=$(download "${GH_API}/releases/latest" \
      | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    ;;
  latest)
    VERSION=$(download "${GH_API}/releases?per_page=1" \
      | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    ;;
  *)
    case "$CHANNEL" in v*) VERSION="$CHANNEL" ;; *) VERSION="v${CHANNEL}" ;; esac
    ;;
esac

if [ -z "$VERSION" ]; then
  echo "Failed to resolve version." >&2; exit 1
fi

echo "Installing minimax ${VERSION}..."

BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"

# Fetch checksum from manifest
CHECKSUM=$(download "${BASE_URL}/manifest.json" \
  | grep '"checksum"' | sed 's/.*"checksum": *"\([^"]*\)".*/\1/')

if [ -z "$CHECKSUM" ] || [ "${#CHECKSUM}" -ne 64 ]; then
  echo "Failed to fetch manifest." >&2; exit 1
fi

# Download
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

download_to "${BASE_URL}/minimax.mjs" "$TMP" || {
  echo "Download failed." >&2; exit 1
}

# Verify SHA256
if command -v shasum >/dev/null 2>&1; then
  ACTUAL=$(shasum -a 256 "$TMP" | cut -d' ' -f1)
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$TMP" | cut -d' ' -f1)
else
  echo "shasum or sha256sum is required." >&2; exit 1
fi

if [ "$ACTUAL" != "$CHECKSUM" ]; then
  echo "Checksum verification failed." >&2; exit 1
fi

chmod +x "$TMP"
mkdir -p "$INSTALL_DIR"
mv "$TMP" "${INSTALL_DIR}/minimax"

echo "Installed minimax ${VERSION} to ${INSTALL_DIR}/minimax"

# Warn if install dir is not in PATH
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    printf '\nNote: %s is not in PATH. Add to your shell profile:\n' "$INSTALL_DIR"
    printf '  export PATH="%s:$PATH"\n\n' "$INSTALL_DIR"
    ;;
esac
