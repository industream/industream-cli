#!/bin/bash
# =============================================================================
# Industream Platform — One-Line Installer
# =============================================================================
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh)
#
# IMPORTANT: Use bash <(curl ...) NOT curl | bash — this preserves the TTY
# so the interactive menu works after installation.
#
# Installs all prerequisites (Node.js, Docker, Git) then the Industream CLI,
# and launches the interactive menu.
# =============================================================================
set -e

# Persist script to a temp file so we can re-exec after `sg docker`.
# When invoked via bash <(curl ...), $0 is /dev/fd/N — a pipe that can
# only be read once. We must download to a file FIRST, then exec from it.
if [ -z "$INDUSTREAM_INSTALLER_SELF" ]; then
  INDUSTREAM_INSTALLER_SELF=$(mktemp --suffix=.sh)
  curl -fsSL "https://raw.githubusercontent.com/industream/industream-cli/main/install.sh?t=$(date +%s)" > "$INDUSTREAM_INSTALLER_SELF"
  chmod +x "$INDUSTREAM_INSTALLER_SELF"
  export INDUSTREAM_INSTALLER_SELF
  # Re-exec from the saved file instead of continuing from the pipe
  exec bash "$INDUSTREAM_INSTALLER_SELF"
fi

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "${BLUE}        ┌───────┐${NC}"
echo -e "${BLUE}        │ ◉   ◉ │${NC}"
echo -e "${BLUE}        │  ───  │${NC}"
echo -e "${BLUE}     ┌──┤       ├──┐${NC}"
echo -e "${BLUE}     │  └───┬───┘  │${NC}"
echo -e "${BLUE}     ◯      │      ◯${NC}"
echo -e "${BLUE}     │   ┌──┴──┐   │${NC}"
echo -e "${BLUE}     └───┤     ├───┘${NC}"
echo -e "${BLUE}         │     │${NC}"
echo -e "${BLUE}         ┴─┐ ┌─┴${NC}"
echo -e "${BLUE}           │ │${NC}"
echo -e "${BLUE}          ─┘ └─${NC}"
echo ""
echo -e "${BOLD}  Hey! I'm ${BLUE}Bolt${NC}${BOLD}, your install companion.${NC}"
echo -e "${DIM}  I'll get everything set up for you.${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# =============================================================================
# Detect OS
# =============================================================================
detect_package_manager() {
  if command -v apt-get &> /dev/null; then
    echo "apt"
  elif command -v dnf &> /dev/null; then
    echo "dnf"
  elif command -v yum &> /dev/null; then
    echo "yum"
  else
    echo "unknown"
  fi
}

PKG_MANAGER=$(detect_package_manager)

# =============================================================================
# Step 1: Git
# =============================================================================
if command -v git &> /dev/null; then
  echo -e "  ${GREEN}✓${NC} Git $(git --version | awk '{print $3}')"
else
  echo -e "  ${YELLOW}Installing Git and tools...${NC}"
  case "$PKG_MANAGER" in
    apt) sudo apt-get update -qq && sudo apt-get install -y -qq git bc jq ;;
    dnf) sudo dnf install -y -q git bc jq ;;
    yum) sudo yum install -y -q git bc jq ;;
    *) echo -e "${RED}Cannot install Git automatically. Install it manually.${NC}"; exit 1 ;;
  esac
  echo -e "  ${GREEN}✓${NC} Git installed"
fi

# Install bc/jq if missing (needed by deploy scripts)
for tool in bc jq; do
  if ! command -v "$tool" &> /dev/null; then
    case "$PKG_MANAGER" in
      apt) sudo apt-get install -y -qq "$tool" ;;
      dnf|yum) sudo "$PKG_MANAGER" install -y -q "$tool" ;;
    esac
  fi
done

# =============================================================================
# Step 2: Docker
# =============================================================================
if command -v docker &> /dev/null && docker info &> /dev/null; then
  echo -e "  ${GREEN}✓${NC} Docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
  if command -v docker &> /dev/null; then
    # Docker exists but current user can't access it
    echo -e "  ${YELLOW}Docker installed but not accessible, fixing...${NC}"
    sudo systemctl enable --now docker 2>/dev/null || true
    sudo usermod -aG docker "$USER"
    echo -e "  ${DIM}Activating docker group for current session...${NC}"
    # Save current script to temp file and re-exec it with docker group active
    # (avoids re-downloading a cached version from GitHub)
    exec sg docker -c "bash $INDUSTREAM_INSTALLER_SELF"
  fi
  echo -e "  ${YELLOW}Installing Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
  echo -e "  ${GREEN}✓${NC} Docker installed"
  # Continue the rest of the script with docker group active (no re-login needed)
  echo -e "  ${DIM}Activating docker group for current session...${NC}"
  exec sg docker -c "bash $INDUSTREAM_INSTALLER_SELF"
fi

# =============================================================================
# Step 3: Docker Swarm
# =============================================================================
SWARM_INIT_OUTPUT=$(docker swarm init 2>&1) && {
  echo -e "  ${GREEN}✓${NC} Docker Swarm initialized"
} || {
  if echo "$SWARM_INIT_OUTPUT" | grep -q "already part of a swarm"; then
    echo -e "  ${GREEN}✓${NC} Docker Swarm active"
  else
    # Retry with explicit advertise address
    if docker swarm init --advertise-addr "$(hostname -I | awk '{print $1}')" 2>/dev/null; then
      echo -e "  ${GREEN}✓${NC} Docker Swarm initialized"
    else
      echo -e "  ${RED}✗${NC} Failed to initialize Docker Swarm"
      echo -e "  ${DIM}$SWARM_INIT_OUTPUT${NC}"
      exit 1
    fi
  fi
}

# =============================================================================
# Step 4: Node.js 22+
# =============================================================================
if command -v node &> /dev/null; then
  NODE_MAJOR=$(node -v | grep -oP '\d+' | head -1)
  if [ "$NODE_MAJOR" -ge 22 ]; then
    echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"
  else
    echo -e "  ${YELLOW}Node.js $(node -v) found, upgrading to 22...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo "$PKG_MANAGER" install -y nodejs
    echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"
  fi
else
  echo -e "  ${YELLOW}Installing Node.js 22...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  case "$PKG_MANAGER" in
    apt) sudo apt-get install -y -qq nodejs ;;
    dnf|yum) sudo "$PKG_MANAGER" install -y -q nodejs ;;
    *) echo -e "${RED}Cannot install Node.js automatically.${NC}"; exit 1 ;;
  esac
  echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"
fi

# =============================================================================
# Step 5: Install Industream CLI
# =============================================================================
# NOTE: Docker registry authentication is handled by the CLI itself:
#   - Community users get auto-login with an embedded public robot account
#   - Premium users get login from credentials in their Keygen license
echo ""
CLI_DIR="${HOME}/.local/share/industream/cli"
if [ -d "$CLI_DIR/.git" ]; then
  OLD_COMMIT=$(git -C "$CLI_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  echo -e "  ${DIM}Updating Industream CLI (current: $OLD_COMMIT)...${NC}"
  # Reset any local changes and force sync with origin/main
  git -C "$CLI_DIR" fetch --quiet origin main
  if ! git -C "$CLI_DIR" reset --hard origin/main --quiet; then
    echo -e "  ${RED}✗${NC} Failed to update CLI. Try: rm -rf $CLI_DIR && rerun this installer"
    exit 1
  fi
  NEW_COMMIT=$(git -C "$CLI_DIR" rev-parse --short HEAD)
  if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
    echo -e "  ${DIM}Already at latest commit ($NEW_COMMIT)${NC}"
  else
    echo -e "  ${DIM}Updated $OLD_COMMIT → $NEW_COMMIT${NC}"
  fi
else
  echo -e "  ${DIM}Downloading Industream CLI...${NC}"
  mkdir -p "$(dirname "$CLI_DIR")"
  git clone -q https://github.com/industream/industream-cli.git "$CLI_DIR"
fi
echo -e "  ${DIM}Installing dependencies...${NC}"
cd "$CLI_DIR"
if ! npm install --silent; then
  echo -e "  ${RED}✗${NC} npm install failed"
  exit 1
fi
if ! npm run build --silent; then
  echo -e "  ${RED}✗${NC} npm run build failed"
  exit 1
fi
if ! sudo npm link --silent; then
  echo -e "  ${RED}✗${NC} sudo npm link failed"
  exit 1
fi
CLI_VERSION=$(node "$CLI_DIR/dist/index.mjs" --version 2>/dev/null || echo 'installed')
echo -e "  ${GREEN}✓${NC} Industream CLI $CLI_VERSION"

# =============================================================================
# Done — launch wizard
# =============================================================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}        ┌───────┐${NC}"
echo -e "${GREEN}        │ ★   ★ │${NC}"
echo -e "${GREEN}        │  ◡◡◡  │${NC}"
echo -e "${GREEN}     ┌──┤       ├──┐${NC}"
echo -e "${GREEN}     │  └───┬───┘  │${NC}"
echo -e "${GREEN}    \\◯/     │    \\◯/${NC}"
echo -e "${GREEN}     │   ┌──┴──┐   │${NC}"
echo -e "${GREEN}     └───┤     ├───┘${NC}"
echo -e "${GREEN}         │     │${NC}"
echo -e "${GREEN}         ┴─┐ ┌─┴${NC}"
echo -e "${GREEN}           │ │${NC}"
echo -e "${GREEN}          ─┘ └─${NC}"
echo ""
echo -e "${GREEN}${BOLD}  All prerequisites installed!${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${RED}${BOLD}  ⚠  IMPORTANT: You MUST log out completely and reconnect.${NC}"
echo -e "${RED}${BOLD}     Docker requires a full session reload to work properly.${NC}"
echo ""
echo -e "  ${BOLD}Step 1:${NC} Wait for automatic logout (5 seconds)"
echo -e "  ${BOLD}Step 2:${NC} Reconnect:"
echo -e "           ${BOLD}ssh ${USER}@$(hostname -I | awk '{print $1}')${NC}"
echo -e "  ${BOLD}Step 3:${NC} Type:"
echo -e "           ${BOLD}industream install${NC}"
echo ""
echo -e "${YELLOW}${BOLD}  Logging out in 5 seconds...${NC}"
echo ""
sleep 5

# Kill the shell / SSH session to force a reconnect so the docker group
# becomes active. If the user is running this via `bash <(curl)` locally,
# just exit cleanly — they can manually reconnect.
if [ -n "$SSH_CONNECTION" ] && [ -n "$SSH_TTY" ]; then
  # Kill the parent shell to drop the SSH session
  kill -HUP "$PPID" 2>/dev/null || true
fi
exit 0
