#!/bin/bash
# Industream CLI — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh | bash
set -e

REPO="industream/industream-cli"
INSTALL_DIR="${INDUSTREAM_INSTALL_DIR:-$HOME/.local/bin}"
SHARE_DIR="${INDUSTREAM_SHARE_DIR:-$HOME/.local/share/industream}"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARTIFACT="industream-linux-x64" ;;
  aarch64) ARTIFACT="industream-linux-arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Get latest release URL
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep "browser_download_url.*$ARTIFACT" | head -1 | cut -d'"' -f4)

if [ -z "$LATEST" ]; then
  echo "Could not find release for $ARTIFACT"
  exit 1
fi

# Download
echo "Downloading Industream CLI..."
mkdir -p "$SHARE_DIR/versions"
VERSION=$(echo "$LATEST" | grep -oP 'v[\d.]+' | head -1)
BINARY_PATH="$SHARE_DIR/versions/$VERSION"
curl -fsSL -o "$BINARY_PATH" "$LATEST"
chmod +x "$BINARY_PATH"

# Symlink
mkdir -p "$INSTALL_DIR"
ln -sf "$BINARY_PATH" "$INSTALL_DIR/industream"

echo ""
echo "Industream CLI installed to $INSTALL_DIR/industream"
echo "Run: industream install"
