# Industream CLI — Roadmap

## Priority 1 — Must fix before testing

- [ ] **Fix deploy non-interactive mode** — `deploy-swarm.sh` has `read` prompts that block when piped. Add `--non-interactive` or `--yes` flag to skip all confirmations
- [ ] **Fix status fallback** — `industream status` crashes with raw mode error in non-TTY sessions (same issue as menu). Add readline fallback like `menu.tsx`
- [ ] **Wire ModuleSelector into install** — component exists (`src/components/ModuleSelector.tsx`) but not rendered in the wizard. Show it during the "modules" step
- [ ] **End-to-end test on clean VM** — full `bash <(curl ...)` → `industream install` → platform running

## Priority 2 — Polish

- [ ] **Bolt builds ASCII logo** — animated sequence where Bolt "constructs" the INDUSTREAM logo character by character
- [ ] **Progress bar for image pulls** — parse `docker pull` output to show download progress
- [ ] **Interactive module selector** — checkboxes to enable/disable premium modules (currently read-only display)
- [ ] **Domain prompt in install wizard** — ask for domain instead of defaulting to `industream.platform.lan`
- [ ] **Environment selector in install** — choose prod/dev/staging/demo (like `industream.sh` menu)
- [ ] **Registry credentials in install wizard** — ask for Harbor credentials via Ink prompts instead of relying on `install.sh` bootstrap

## Priority 3 — Features

- [ ] **Publish to npm** — create `@industream` org on npmjs.com, `npm publish --access public`
- [ ] **Auto-update notification** — check CLI version vs GitHub Releases on launch (24h cache)
- [ ] **`industream self-update`** — download and replace CLI binary/install
- [ ] **`industream doctor`** — diagnostic command (check Docker, Swarm, DNS, certs, services health)
- [ ] **`industream backup`** / **`industream restore`** — managed backup operations
- [ ] **Status dashboard: UPDATE column** — compare deployed versions vs registry latest (OVH Harbor API)
- [ ] **License enforcement at deploy** — actually exclude proprietary services from stack when community plan

## Priority 4 — Future

- [ ] **Node SEA binary** — fix Ink/yoga top-level await incompatibility with CJS (or use Bun build)
- [ ] **Remote management** — `industream --host user@server` to manage remote clusters via SSH
- [ ] **Web dashboard companion** — browser-based status page
- [ ] **Plugin system** — custom modules installable via CLI
- [ ] **SaaS mode** — managed cloud deployment (industream.cloud)
