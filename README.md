# Industream CLI

Command-line tool to install, manage and monitor the Industream Platform.

## Quick Install

### Linux (Debian/Ubuntu/RHEL)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh)
```

### Windows (WSL2)

> **Warning:** WSL2 requires Docker to run inside the Linux subsystem (not Docker Desktop).
> The `bash <(curl ...)` syntax does not work on WSL2. Use the command below instead.
> After install, you **must close and reopen** your WSL terminal before running `industream`.

```bash
curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh -o /tmp/install.sh && bash /tmp/install.sh
```

After install, add the platform domains to your Windows hosts file (PowerShell as Admin):

```powershell
Add-Content C:\Windows\System32\drivers\etc\hosts "127.0.0.1 industream.platform.lan flowmaker.industream.platform.lan dashboard.industream.platform.lan datacatalog.industream.platform.lan auth.industream.platform.lan confighub.industream.platform.lan scheduler.industream.platform.lan"
```

---

After install, **close your terminal and reconnect** (required to activate Docker group), then run:

```bash
industream
```

This opens the interactive platform manager.

## What the installer does

1. Installs Git, Docker, Docker Swarm, bc, jq, Node.js 22
2. Clones the Industream CLI and builds it
3. Links the `industream` command globally

No registry credentials are needed for the community edition.

## Commands

| Command | Description |
|---------|-------------|
| `industream` | Interactive menu |
| `industream install` | Full platform setup wizard |
| `industream status` | Live service dashboard |
| `industream deploy` | Deploy an environment (prod/dev/staging) |
| `industream down` | Bring environment down (data preserved) |
| `industream update` | Check for available updates |
| `industream logs [service]` | View service logs |
| `industream secrets` | List platform secrets |
| `industream license` | View license info |
| `industream license --set KEY` | Activate a license |
| `industream uninstall --env prod` | Remove an environment |

## Platform Setup

After installing the CLI:

```bash
# 1. Launch the interactive installer (community mode, no credentials needed)
industream install

# 2. Check platform health
industream status
```

### Premium license

If you have a commercial license:

```bash
# Activate your license key
industream license --set XXXX-XXXX-XXXX-XXXX-XXXX-V3

# Redeploy with premium modules enabled
industream install
```

## System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Disk | 20 GB | 40+ GB |
| OS | Debian 12, Ubuntu 22.04+, RHEL 9+ | Debian 12 |
| Docker | 20.10+ | Latest |
| Node.js | 22+ | 22 LTS |

WSL2 on Windows 10/11 is supported.

## TLS Certificates

| Mode | Internet | Renewal | Usage |
|------|----------|---------|-------|
| `selfsigned` (default) | No | Manual (5 years) | Dev/demo |
| `letsencrypt` | Yes | Auto (90 days) | Production with internet |
| `custom` | No | Manual (client PKI) | Production offline |

Set `TLS_MODE` in `~/industream-platform/.env`.

## Development

```bash
git clone https://github.com/industream/industream-cli.git
cd industream-cli
npm install
npm run dev -- --help      # Run in dev mode
npm test                    # Run tests
npm run build               # Build for production
```

## Community Edition (BSL 1.1 — Free)

The community edition includes everything you need to run an industrial data platform:

### Platform Core
- **UI Fusion** — unified web interface with SSO
- **Keycloak** — identity & access management
- **Grafana** — dashboards & alerting
- **PostgreSQL** — relational database
- **InfluxDB** — time-series database
- **MinIO** — object storage

### FlowMaker (flow orchestration)
- Core engine, Scheduler, ConfigHub, CDN
- Visual flow designer & logger
- Worker Manager

### DataBridge Connectors (BSL)
- MQTT, Modbus TCP, REST API, HTTP
- PostgreSQL, InfluxDB, MinIO connectors

### Workers (BSL)
- Timer, Data Logger, JS Expression, Enqueue
- Notifications, Conditional Validator
- Test Data Generator, Equation Solver

### DataCatalog
- Asset catalog API & UI
- DataCatalog Mapper worker

## Premium Modules (Commercial License Required)

### Premium Connectors (PRODUCT_DATACATALOG)
- OPC-UA, Siemens S7, RTSP, GStreamer, Audio
- Lenada, OSIsoft PI, SAP, Odoo

### Database Add-ons
- TimescaleDB (ADDON_DB_TIMESCALE)
- MS SQL Server (ADDON_DB_MSSQL)
- OSIsoft PI (ADDON_DB_OSISOFT)

### AI Studio (PRODUCT_AI_STUDIO)
- AI Studio core, ONNX Runtime, AutoML
- Anomaly Detection, Pattern Recognition
- Virtual Sensor, Golden Batch, Root Cause Analysis

### MCP Agentic Access (PRODUCT_MCP)
- MCP FlowMaker, Visualization, Industream, DataCatalog

### System Add-ons
- Backup & Monitoring — Prometheus, Alertmanager, cAdvisor, ntfy (ADDON_BACKUP)
- Redundant Server — HA active/passive (ADDON_REDUNDANT)

### Process Packages (quoted separately)
- **IronStream** — Blast Furnace L2 models (PACKAGE_IRONSTREAM)
- **ArcStream** — Electric Arc Furnace models (PACKAGE_ARCSTREAM)
- **FlowGuard** — OEE/TRS monitoring (PACKAGE_FLOWGUARD)
- **Industrial Monitoring** — Tuyere, IR Hot Spot, Free Roll (PACKAGE_MONITORING)

## License

BSL 1.1 — Free for non-commercial use. Commercial use requires a paid license.
Tag-based tiers: 25, 100, 500, 1,000 and 5,000 tags per site.

Contact: license@industream.com | https://industream.com/pricing

See [LICENSE](https://github.com/industream/industream-stack/blob/main/LICENSE)
