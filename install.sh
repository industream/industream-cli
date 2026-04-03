#!/bin/bash
# Industream CLI — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh | bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BLUE}${BOLD}Industream CLI Installer${NC}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo -e "${RED}Node.js is not installed.${NC}"
  echo "Install Node.js 22+: https://nodejs.org/"
  echo "Or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22"
  exit 1
fi

NODE_VERSION=$(node -v | grep -oP '\d+' | head -1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo -e "${RED}Node.js 22+ required (found: $(node -v))${NC}"
  exit 1
fi

echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

# Install globally via npm
echo ""
echo "Installing @industream/cli..."
npm install -g @industream/cli@latest 2>/dev/null || {
  echo ""
  echo -e "${RED}npm global install failed.${NC}"
  echo "Try with sudo: sudo npm install -g @industream/cli"
  echo "Or use npx:    npx @industream/cli"
  exit 1
}

echo ""
echo -e "${GREEN}${BOLD}Industream CLI installed!${NC}"
echo ""
echo -e "  Run: ${BOLD}industream install${NC}  — to set up the platform"
echo -e "  Run: ${BOLD}industream status${NC}   — to check platform health"
echo -e "  Run: ${BOLD}industream --help${NC}   — for all commands"
echo ""
