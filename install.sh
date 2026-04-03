#!/bin/bash
# =============================================================================
# Industream Platform — One-Line Installer
# =============================================================================
# Usage: curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh | bash
#
# Installs all prerequisites (Node.js, Docker, Git) then the Industream CLI,
# and launches the interactive setup wizard.
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
  echo -e "  ${YELLOW}Installing Git...${NC}"
  case "$PKG_MANAGER" in
    apt) sudo apt-get update -qq && sudo apt-get install -y -qq git ;;
    dnf) sudo dnf install -y -q git ;;
    yum) sudo yum install -y -q git ;;
    *) echo -e "${RED}Cannot install Git automatically. Install it manually.${NC}"; exit 1 ;;
  esac
  echo -e "  ${GREEN}✓${NC} Git installed"
fi

# =============================================================================
# Step 2: Docker
# =============================================================================
if command -v docker &> /dev/null && docker info &> /dev/null; then
  echo -e "  ${GREEN}✓${NC} Docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
  if command -v docker &> /dev/null; then
    echo -e "  ${YELLOW}Docker installed but not running or no permission${NC}"
    echo -e "  ${DIM}Try: sudo systemctl start docker && sudo usermod -aG docker \$USER${NC}"
    exit 1
  fi
  echo -e "  ${YELLOW}Installing Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
  echo -e "  ${GREEN}✓${NC} Docker installed"
  echo ""
  echo -e "  ${YELLOW}NOTE: You were added to the docker group.${NC}"
  echo -e "  ${YELLOW}Log out and back in, then re-run this script.${NC}"
  exit 0
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
# Step 5: Install Industream CLI
# =============================================================================
echo ""
echo -e "  ${BLUE}Installing Industream CLI...${NC}"
sudo npm install -g git+https://github.com/industream/industream-cli.git 2>/dev/null || {
  echo -e "  ${RED}Failed to install CLI${NC}"
  exit 1
}
echo -e "  ${GREEN}✓${NC} Industream CLI $(industream --version 2>/dev/null || echo 'installed')"

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
echo -e "${DIM}  Launching the platform setup wizard...${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Launch the interactive installer
exec industream install
