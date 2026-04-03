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

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "${CYAN}        ┌───────┐${NC}"
echo -e "${CYAN}        │ ◉   ◉ │${NC}"
echo -e "${CYAN}        │  ───  │${NC}"
echo -e "${CYAN}     ┌──┤       ├──┐${NC}"
echo -e "${CYAN}     │  └───┬───┘  │${NC}"
echo -e "${CYAN}     ◯      │      ◯${NC}"
echo -e "${CYAN}     │   ┌──┴──┐   │${NC}"
echo -e "${CYAN}     └───┤     ├───┘${NC}"
echo -e "${CYAN}         │     │${NC}"
echo -e "${CYAN}         ┴─┐ ┌─┴${NC}"
echo -e "${CYAN}           │ │${NC}"
echo -e "${CYAN}          ─┘ └─${NC}"
echo ""
echo -e "${BOLD}  Hey! I'm ${CYAN}Bolt${NC}${BOLD}, your install companion.${NC}"
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
    SCRIPT_URL="https://raw.githubusercontent.com/industream/industream-cli/main/install.sh"
    exec sg docker -c "curl -fsSL $SCRIPT_URL | bash"
  fi
  echo -e "  ${YELLOW}Installing Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
  echo -e "  ${GREEN}✓${NC} Docker installed"
  # Continue the rest of the script with docker group active (no re-login needed)
  echo -e "  ${DIM}Activating docker group for current session...${NC}"
  SCRIPT_URL="https://raw.githubusercontent.com/industream/industream-cli/main/install.sh"
  exec sg docker -c "curl -fsSL $SCRIPT_URL | bash"
fi

# =============================================================================
# Step 3: Docker Swarm
# =============================================================================
SWARM_STATE=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo "inactive")
if [ "$SWARM_STATE" = "active" ]; then
  echo -e "  ${GREEN}✓${NC} Docker Swarm active"
else
  echo -e "  ${YELLOW}Initializing Docker Swarm...${NC}"
  docker swarm init 2>/dev/null || docker swarm init --advertise-addr "$(hostname -I | awk '{print $1}')"
  echo -e "  ${GREEN}✓${NC} Docker Swarm initialized"
fi

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
# Step 5: Docker Registry Login
# =============================================================================
REGISTRY="842775dh.c1.gra9.container-registry.ovh.net"
if docker pull "$REGISTRY/uifusion/ui:latest" > /dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} Registry authenticated"
else
  echo ""
  echo -e "  ${CYAN}Bolt:${NC} ${DIM}\"I need your registry credentials to pull images.\"${NC}"
  echo ""
  echo -e "  Registry: ${BOLD}${REGISTRY}${NC}"
  echo ""
  printf "  Username: "
  read -r REGISTRY_USER </dev/tty
  printf "  Password: "
  stty -echo 2>/dev/null
  read -r REGISTRY_PASSWORD </dev/tty
  stty echo 2>/dev/null
  echo ""
  echo ""

  if [ -z "$REGISTRY_USER" ] || [ -z "$REGISTRY_PASSWORD" ]; then
    echo -e "  ${RED}Username and password are required${NC}"
    exit 1
  fi

  if echo "$REGISTRY_PASSWORD" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Registry: authenticated"
  else
    echo -e "  ${RED}Registry login failed. Check your credentials.${NC}"
    exit 1
  fi
fi

# =============================================================================
# Step 6: Install Industream CLI
# =============================================================================
echo ""
CLI_DIR="${HOME}/.local/share/industream/cli"
if [ -d "$CLI_DIR/.git" ]; then
  echo -e "  ${DIM}Updating Industream CLI...${NC}"
  git -C "$CLI_DIR" pull --ff-only -q 2>/dev/null || true
else
  echo -e "  ${DIM}Downloading Industream CLI...${NC}"
  mkdir -p "$(dirname "$CLI_DIR")"
  git clone -q https://github.com/industream/industream-cli.git "$CLI_DIR"
fi
echo -e "  ${DIM}Installing dependencies...${NC}"
cd "$CLI_DIR" && npm install --omit=dev -q 2>/dev/null
npm run build -s 2>/dev/null
sudo npm link -q 2>/dev/null
echo -e "  ${GREEN}✓${NC} Industream CLI $(node "$CLI_DIR/dist/index.mjs" --version 2>/dev/null || echo 'installed')"

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
echo -e "  ${YELLOW}${BOLD}Next step:${NC}"
echo ""
echo -e "  Close this session and reconnect, then type:"
echo ""
echo -e "    ${BOLD}industream${NC}"
echo ""
echo -e "  This will open the interactive platform manager."
echo ""
