# Industream CLI

Command-line tool to install, manage and monitor the Industream Platform.

---

## Quick Install

### Linux (Debian/Ubuntu/RHEL)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh)
```

### Windows (WSL2)

> **Warning:** WSL2 requires Docker Engine inside the Linux subsystem (not Docker Desktop).
> After install, you **must close and reopen** your WSL terminal before running `industream`.

```bash
curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh -o /tmp/install.sh && bash /tmp/install.sh
```

After install on WSL2, add platform domains to your Windows hosts file (PowerShell as Admin):

```powershell
Add-Content C:\Windows\System32\drivers\etc\hosts "127.0.0.1 industream.platform.lan flowmaker.industream.platform.lan dashboard.industream.platform.lan datacatalog.industream.platform.lan auth.industream.platform.lan confighub.industream.platform.lan scheduler.industream.platform.lan"
```

### What the installer does

1. Installs prerequisites: Git, Docker, Docker Swarm, bc, jq, Node.js 22
2. Clones and builds the Industream CLI
3. Links the `industream` command globally
4. Disconnects your session (to activate the Docker group)

No registry credentials or license key needed for the community edition.

---

## Getting Started

After install, reconnect and run:

```bash
industream install           # Deploy the platform (community mode)
industream status            # Check platform health
industream                   # Open the interactive menu
```

### With a commercial license

```bash
industream license --set XXXX-XXXX-XXXX-XXXX-XXXX-V3    # Activate license
industream install                                        # Redeploy with premium modules
industream status                                         # Verify premium modules are running
```

---

## Commands Reference

### Platform Management

| Command | Description |
|---------|-------------|
| `industream` | Interactive menu (arrow keys + number keys) |
| `industream install` | Full platform setup wizard |
| `industream install --env dev` | Install a dev environment |
| `industream deploy` | Deploy (prompts for environment: prod/dev/staging) |
| `industream deploy --env prod` | Deploy a specific environment |
| `industream down` | Bring environment down (data is preserved) |
| `industream down --env dev` | Bring down a specific environment |
| `industream uninstall --env prod` | Fully remove an environment |

### Monitoring

| Command | Description |
|---------|-------------|
| `industream status` | Live service dashboard with categories, uptime, versions |
| `industream update` | Check for available updates (compares deployed vs latest) |
| `industream logs flowmaker-scheduler` | View logs for a specific service |
| `industream logs -f flowmaker-scheduler` | Follow logs in real-time |
| `industream logs` | List all available services |

### License Management

| Command | Description |
|---------|-------------|
| `industream license` | View current license info (plan, customer, entitlements) |
| `industream license --set <KEY>` | Activate a license key (auto-registers machine) |

### Secrets

| Command | Description |
|---------|-------------|
| `industream secrets` | List Docker secrets for current environment |
| `industream secrets --regenerate` | Regenerate all secrets |

### External Workers

| Command | Description |
|---------|-------------|
| `industream worker add ./my-worker/` | Install a custom worker from a directory |
| `industream worker list` | List installed external workers |
| `industream worker remove my-worker` | Remove an external worker |

---

## External Workers

You can deploy your own custom Docker workers alongside the platform.

### Create a worker

Create a directory with an `industream.yaml` manifest:

```
my-custom-worker/
├── industream.yaml      # Required: worker manifest
├── image.tar.gz         # Option A: pre-built Docker image
└── Dockerfile           # Option B: build from source
```

### Worker manifest format

```yaml
apiVersion: industream.com/v1
kind: Worker
metadata:
  name: my-custom-worker
  version: 1.0.0
  author: Your Company
  description: What this worker does
spec:
  image:
    # Option 1: image from a registry
    ref: registry.example.com/workers/my-worker:1.0.0
    # Option 2: local tar.gz file
    # file: image.tar.gz
    # Option 3: build from Dockerfile
    # dockerfile: Dockerfile
  resources:
    limits:
      cpus: "0.5"
      memory: 256M
  environment:
    MY_CONFIG: value
  replicas: 1
```

### Install and deploy

```bash
industream worker add ./my-custom-worker/   # Import image + generate stack YAML
industream deploy                           # Redeploy to include the new worker
```

External workers are automatically included in all subsequent deployments.

See `examples/simple-worker/` for a minimal example.

---

## Environments

The platform supports multiple isolated environments on the same server:

| Environment | Stack name | Use case |
|-------------|-----------|----------|
| `prod` (default) | `industream-prod` | Production |
| `dev` | `industream-dev` | Development/testing |
| `staging` | `industream-staging` | Pre-production |

Each environment has its own Docker secrets, volumes, and network. Data is isolated.

```bash
industream install --env prod      # Deploy production
industream install --env dev       # Deploy dev alongside prod
industream status                  # Shows default environment
industream down --env dev          # Stop dev without affecting prod
```

---

## Community Edition (BSL 1.1 — Free)

The community edition includes everything you need to run an industrial data platform:

**Platform Core** — UI Fusion, Keycloak (SSO), Grafana, PostgreSQL, InfluxDB, MinIO

**FlowMaker** — Core engine, Scheduler, ConfigHub, CDN, Visual designer, Worker Manager

**DataBridge Connectors** — MQTT, Modbus TCP, REST API, HTTP, PostgreSQL, InfluxDB, MinIO

**Workers** — Timer, Data Logger, JS Expression, Enqueue, Notifications, Equation Solver, Conditional Validator, Test Data Generator, DataCatalog Mapper

**DataCatalog** — Asset catalog API & UI

---

## Premium Modules (Commercial License Required)

### Premium Connectors (included with any tag bundle)

OPC-UA · Siemens S7 · RTSP · GStreamer · Audio · Lenada · OSIsoft PI · SAP · Odoo

### Database Add-ons (per database)

- **ADDON_DB_TIMESCALE** — TimescaleDB time-series database
- **ADDON_DB_MSSQL** — MS SQL Server connector
- **ADDON_DB_OSISOFT** — OSIsoft PI connector

### AI Studio (PRODUCT_AI_STUDIO)

AI Studio core · ONNX Runtime · AutoML · Anomaly Detection · Pattern Recognition · Virtual Sensor · Golden Batch · Root Cause Analysis

### MCP Agentic Access (PRODUCT_MCP)

MCP FlowMaker · MCP Visualization · MCP Industream · MCP DataCatalog

### System Add-ons

- **ADDON_BACKUP** — Prometheus, Alertmanager, cAdvisor, ntfy, backup services
- **ADDON_REDUNDANT** — HA active/passive redundancy

### Process Packages (quoted separately)

- **PACKAGE_IRONSTREAM** — Blast Furnace L2 models
- **PACKAGE_ARCSTREAM** — Electric Arc Furnace models
- **PACKAGE_FLOWGUARD** — OEE/TRS monitoring
- **PACKAGE_MONITORING** — Tuyere, IR Hot Spot, Free Roll monitoring

---

## TLS Certificates

| Mode | Internet | Renewal | Usage |
|------|----------|---------|-------|
| `selfsigned` (default) | No | 5 years | Dev, demo, internal |
| `letsencrypt` | Yes | Auto (90 days) | Production with public domain |
| `custom` | No | Manual (client PKI) | Production offline |

Set `TLS_MODE` in `~/industream-platform/.env`.

---

## System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Disk | 20 GB | 40+ GB |
| OS | Debian 12, Ubuntu 22.04+, RHEL 9+ | Debian 12 |
| Docker | 24.0+ | Latest |
| Node.js | 22+ | 22 LTS |

WSL2 on Windows 10/11 is fully supported.

---

## Manual Install

If you prefer to install manually instead of using the one-liner:

```bash
# 1. Install prerequisites
sudo apt-get update && sudo apt-get install -y git curl bc jq
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Init Docker Swarm
docker swarm init

# 3. Install the CLI
git clone https://github.com/industream/industream-cli.git ~/.local/share/industream/cli
cd ~/.local/share/industream/cli
npm install && npm run build && sudo npm link

# 4. Deploy
industream install
```

---

## Development

```bash
git clone https://github.com/industream/industream-cli.git
cd industream-cli
npm install
npm run dev -- --help      # Run in dev mode
npm test                    # Run tests (46 tests)
npm run build               # Build for production
```

---

## License

**BSL 1.1** — Free for non-commercial use. Commercial use requires a paid license.

Tag-based tiers: 25 · 100 · 500 · 1,000 · 5,000 tags per site.

Third-party external workers are your responsibility and not covered by this license.

Contact: license@industream.com · https://industream.com/pricing

[Full License](https://github.com/industream/industream-stack/blob/main/LICENSE)
