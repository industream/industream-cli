# Industream CLI

Command-line tool to install, manage and monitor the Industream Platform.

## Quick Install (clean server)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh)
```

This installs all prerequisites (Git, Docker, Node.js 22) and the CLI.
After install, close your session and reconnect, then run:

```bash
industream
```

## Manual Install

### Prerequisites

- Linux (Debian/Ubuntu/RHEL)
- Docker 20.10+ with Swarm mode
- Node.js 22+
- Git

### Install

```bash
git clone https://github.com/industream/industream-cli.git ~/.local/share/industream/cli
cd ~/.local/share/industream/cli
npm install
npm run build
sudo npm link
```

### Verify

```bash
industream --help
```

## Commands

| Command | Description |
|---------|-------------|
| `industream` | Interactive menu |
| `industream install` | Full platform setup wizard |
| `industream status` | Live service dashboard |
| `industream deploy --env prod` | Deploy an environment |
| `industream stop --env prod` | Stop an environment |
| `industream update` | Check for available updates |
| `industream logs [service]` | View service logs |
| `industream secrets --show` | Display platform secrets |
| `industream license` | View license info |
| `industream uninstall --env prod` | Remove an environment |

## Platform Setup

After installing the CLI, the typical flow is:

```bash
# 1. Login to Docker registry (required for private images)
docker login 842775dh.c1.gra9.container-registry.ovh.net

# 2. Launch the interactive installer
industream install

# 3. Check platform health
industream status
```

## Development

```bash
git clone https://github.com/industream/industream-cli.git
cd industream-cli
npm install
npm run dev -- --help      # Run in dev mode
npm test                    # Run tests (25 tests)
npm run build               # Build for production
```

## License

BSL 1.1 — See [LICENSE](../industream-stack/LICENSE)
