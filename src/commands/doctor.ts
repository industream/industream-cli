// src/commands/doctor.ts
// Preflight + provision for the unified install. Asks runtime/edition (+ license
// for EE), checks every dependency the unified `scripts/deploy.sh` needs, and —
// with --fix — provisions what's missing. The one front door to "am I ready?".
import { execa } from "execa";
import { stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../lib/config.js";
import { COMMUNITY_REGISTRY, ENTERPRISE_REGISTRY } from "../lib/registry-login.js";

type Runtime = "swarm" | "compose";
type Edition = "ce" | "ee";
type Status = "pass" | "warn" | "fail";

interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: () => Promise<void>;
  fixLabel?: string;
}

export interface DoctorOptions {
  runtime?: Runtime;
  edition?: Edition;
  env?: string;
  fix?: boolean;
  yes?: boolean;
}

// Secret base names shared by both runtimes. Swarm uses `${env}_<name>` external
// secrets; compose uses files named `<name>` under SECRETS_DIR.
const SECRET_NAMES = [
  "postgres_admin_password", "datacatalog_db_password", "datacatalog_api_key", "grafana_admin_password",
  "grafana_db_password", "minio_root_user", "minio_root_password",
  "influx_admin_password", "influx_admin_token", "timescaledb_password", "databridge_pg_password",
  "hub_jwt_signing_key",
];
const EE_SECRET_NAMES = ["logto_db_url", "logto_db_password"];

// ---- small helpers ---------------------------------------------------------
function expandTilde(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

async function pathType(p: string): Promise<"file" | "dir" | "missing"> {
  try { const s = await stat(p); return s.isDirectory() ? "dir" : "file"; }
  catch { return "missing"; }
}

async function sh(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await execa(cmd, args, { reject: false });
  return { ok: r.exitCode === 0, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim() };
}

async function readEnvFile(p: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  let txt = "";
  try { txt = await readFile(p, "utf-8"); } catch { return m; }
  for (const line of txt.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) m.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return m;
}

async function ask(question: string, choices: string[], dflt: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const a = (await rl.question(`${question} [${choices.join("/")}] (${dflt}): `)).trim().toLowerCase();
    return choices.includes(a) ? a : dflt;
  } finally { rl.close(); }
}

function secretValueFor(name: string): string {
  if (name.endsWith("minio_root_user")) return "minioadmin";
  if (name.endsWith("logto_db_url"))
    return `postgres://postgres:${randomBytes(12).toString("hex")}@logto-postgres:5432/logto`;
  return randomBytes(16).toString("hex");
}

// ---- checks ----------------------------------------------------------------
async function commonChecks(unified: string, runtime: Runtime, env: string): Promise<Check[]> {
  const checks: Check[] = [];
  const docker = await sh("docker", ["info", "--format", "{{.ServerVersion}}"]);
  checks.push({ name: "docker daemon", status: docker.ok ? "pass" : "fail",
    detail: docker.ok ? `server ${docker.out}` : "not running / not installed" });
  const compose = await sh("docker", ["compose", "version", "--short"]);
  checks.push({ name: "docker compose v2", status: compose.ok ? "pass" : "fail",
    detail: compose.ok ? `v${compose.out}` : "compose plugin missing" });
  const py = await sh("python3", ["--version"]);
  checks.push({ name: "python3 (swarm render)", status: py.ok ? "pass" : "warn",
    detail: py.ok ? py.out : "needed for deploy.sh --render on swarm" });

  const deploy = join(unified, "scripts/deploy.sh");
  checks.push({ name: "unified tree", status: (await pathType(deploy)) === "file" ? "pass" : "fail", detail: deploy });

  const bundles = await sh("bash", ["-lc", `ls -d ${unified}/releases/bundle-platform-*/ 2>/dev/null`]);
  const hasBundle = bundles.ok && bundles.out.length > 0;
  checks.push({ name: "release bundle", status: hasBundle ? "pass" : "fail",
    detail: hasBundle ? bundles.out.split("\n")[0] : "no releases/bundle-platform-* — run render-bundles.sh",
    fixLabel: "render bundle", fix: hasBundle ? undefined
      : async () => { await execa("bash", [join(unified, "scripts/render-bundles.sh")], { stdio: "inherit" }); } });

  for (const f of ["registries.env", "versions.env", "auth.env", `runtime.${runtime}.env`])
    checks.push({ name: `env: ${f}`, status: (await pathType(join(unified, f))) === "file" ? "pass" : "fail", detail: f });

  const envPath = join(unified, `.env.${env}`);
  const envType = await pathType(envPath);
  const vars = await readEnvFile(envPath);
  const missing = ["INDUSTREAM_DOMAIN", "INDUSTREAM_HUB_ORIGIN"].filter((k) => !vars.get(k));
  checks.push({ name: `.env.${env}`,
    status: envType === "missing" ? "fail" : missing.length ? "warn" : "pass",
    detail: envType === "missing" ? "missing (site env)" : missing.length ? `missing ${missing.join(",")}` : "ok" });

  checks.push(await baseConfigCheck(unified));
  return checks;
}

// The #1 live-gate bug: bind-mounted config FILES must exist as files, else
// docker auto-creates empty ROOT dirs and entrypoints fail silently.
async function baseConfigCheck(unified: string): Promise<Check> {
  const files = ["dotnet-entrypoint.sh", "influxdb-entrypoint.sh", "prometheus/prometheus.yml",
    "alertmanager/alertmanager.yml", "postgres-init/init-postgres.sh"];
  const bad: string[] = [];
  for (const f of files) {
    const t = await pathType(join(unified, "base/config", f));
    if (t !== "file") bad.push(`${f}${t === "dir" ? " (DIR!)" : ""}`);
  }
  return { name: "base/config bind files", status: bad.length ? "fail" : "pass",
    detail: bad.length ? `missing/dir: ${bad.join(", ")}` : "all present as files" };
}

async function swarmChecks(env: string, edition: Edition): Promise<Check[]> {
  const checks: Check[] = [];
  const sw = await sh("docker", ["info", "--format", "{{.Swarm.LocalNodeState}}"]);
  const active = sw.ok && sw.out.startsWith("active");
  checks.push({ name: "swarm active", status: active ? "pass" : "fail",
    detail: active ? "active" : "not in a swarm", fixLabel: "docker swarm init",
    fix: active ? undefined : async () => { await execa("docker", ["swarm", "init"], { stdio: "inherit" }); } });

  const net = await sh("docker", ["network", "inspect", "traefik-shared_traefik-public"]);
  checks.push({ name: "traefik-public network", status: net.ok ? "pass" : "fail",
    detail: net.ok ? "present" : "traefik-shared_traefik-public missing (deploy traefik-shared first)" });

  const ls = await sh("docker", ["secret", "ls", "--format", "{{.Name}}"]);
  const have = new Set(ls.out.split("\n").map((s) => s.trim()));
  const wanted = [...SECRET_NAMES, ...(edition === "ee" ? EE_SECRET_NAMES : [])].map((n) => `${env}_${n}`);
  const miss = wanted.filter((n) => !have.has(n));
  checks.push({ name: "swarm external secrets", status: miss.length ? "fail" : "pass",
    detail: miss.length ? `missing ${miss.length}: ${miss.slice(0, 3).join(", ")}${miss.length > 3 ? "…" : ""}` : `${wanted.length} present`,
    fixLabel: "create missing secrets", fix: miss.length ? async () => {
      for (const full of miss) await execa("docker", ["secret", "create", full, "-"], { input: secretValueFor(full) });
    } : undefined });
  return checks;
}

async function composeChecks(unified: string, env: string, edition: Edition): Promise<Check[]> {
  const checks: Check[] = [];
  const vars = await readEnvFile(join(unified, `.env.${env}`));
  const fmNet = vars.get("FM_NETWORK") ?? "";
  const netOk = fmNet ? (await sh("docker", ["network", "inspect", fmNet])).ok : false;
  checks.push({ name: "FM_NETWORK", status: fmNet ? (netOk ? "pass" : "fail") : "warn",
    detail: !fmNet ? ".env has no FM_NETWORK" : netOk ? `${fmNet} present` : `${fmNet} missing`,
    fixLabel: "create network", fix: fmNet && !netOk
      ? async () => { await execa("docker", ["network", "create", fmNet], { stdio: "inherit" }); } : undefined });

  const dir = expandTilde(vars.get("SECRETS_DIR") ?? join(unified, "secrets"));
  const wanted = [...SECRET_NAMES, ...(edition === "ee" ? EE_SECRET_NAMES : [])];
  const miss: string[] = [];
  for (const n of wanted) if ((await pathType(join(dir, n))) !== "file") miss.push(n);
  checks.push({ name: "compose file secrets", status: miss.length ? "fail" : "pass",
    detail: miss.length ? `missing ${miss.length} in ${dir}` : `${wanted.length} present in ${dir}`,
    fixLabel: "generate secret files", fix: miss.length ? async () => {
      await mkdir(dir, { recursive: true });
      for (const n of miss) await writeFile(join(dir, n), secretValueFor(n));
    } : undefined });
  return checks;
}

// Registry reachability — NEVER assume GHCR is anonymous (industream packages are
// currently PRIVATE). Probe a real manifest with whatever creds the host has.
async function registryChecks(unified: string, edition: Edition): Promise<Check[]> {
  const checks: Check[] = [];
  const versions = await readEnvFile(join(unified, "versions.env"));
  const communityImg = `${COMMUNITY_REGISTRY}/datacatalog/api:${versions.get("DATACATALOG_API_VERSION") ?? "1.9.1"}`;
  const cOk = (await sh("docker", ["manifest", "inspect", communityImg])).ok;
  checks.push({ name: "community registry pull", status: cOk ? "pass" : "fail",
    detail: cOk ? `${communityImg} reachable`
      : `cannot pull ${communityImg} — GHCR packages are PRIVATE; docker login or make them public` });

  if (edition === "ee") {
    // grafana-hub-wrapper is now a COMMUNITY image (GHCR); probe a genuinely
    // enterprise-only image instead — the enterprise Hub backend.
    const entImg = `${ENTERPRISE_REGISTRY}/uifusion/api-enterprise:${versions.get("UIFUSION_API_EE_VERSION") ?? "2.1.2"}`;
    const eOk = (await sh("docker", ["manifest", "inspect", entImg])).ok;
    checks.push({ name: "enterprise registry pull (EE)", status: eOk ? "pass" : "fail",
      detail: eOk ? `${entImg} reachable`
        : "cannot pull enterprise image — provide a license (`industream license --set <token>`), then docker login" });
  }
  return checks;
}

// ---- render / run ----------------------------------------------------------
function icon(s: Status): string { return s === "pass" ? "✓" : s === "warn" ? "!" : "✗"; }

function printChecks(checks: Check[]): void {
  for (const c of checks) console.log(`  [${icon(c.status)}] ${c.name.padEnd(26)} ${c.detail}`);
}

async function runFixes(checks: Check[], yes: boolean): Promise<void> {
  console.log("\n  Provisioning:");
  for (const c of checks) {
    if (!c.fix) continue;
    if (!yes && (await ask(`  fix "${c.name}" (${c.fixLabel ?? "apply"})?`, ["y", "n"], "y")) !== "y") continue;
    try { await c.fix(); console.log(`  ✓ fixed: ${c.name}`); }
    catch (e) { console.log(`  ✗ fix failed: ${c.name} — ${e instanceof Error ? e.message : String(e)}`); }
  }
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const runtime = (options.runtime ?? (await ask("Install type", ["swarm", "compose"], "swarm")) as Runtime);
  const edition = (options.edition ?? (await ask("Edition", ["ce", "ee"], "ce")) as Edition);
  const env = options.env ?? (runtime === "swarm" ? "prod" : "dev");
  const cfg = await loadConfig();
  const unified = join(expandTilde(cfg.platformDir), "unified");

  console.log(`\n  Industream doctor — ${runtime.toUpperCase()} / ${edition.toUpperCase()} / env=${env}`);
  console.log(`  tree: ${unified}\n`);
  if (edition === "ee")
    console.log("  EE: enterprise images need a valid license (Harbor robot creds from its metadata).\n");

  const checks: Check[] = [
    ...(await commonChecks(unified, runtime, env)),
    ...(runtime === "swarm" ? await swarmChecks(env, edition) : await composeChecks(unified, env, edition)),
    ...(await registryChecks(unified, edition)),
  ];
  printChecks(checks);

  const fixable = checks.filter((c) => c.status === "fail" && c.fix);
  if (options.fix && fixable.length) await runFixes(fixable, options.yes ?? false);

  const blocking = (options.fix
    ? [...(await commonChecks(unified, runtime, env)),
       ...(runtime === "swarm" ? await swarmChecks(env, edition) : await composeChecks(unified, env, edition)),
       ...(await registryChecks(unified, edition))]
    : checks).filter((c) => c.status === "fail");

  if (blocking.length === 0) {
    const target = runtime === "swarm" ? `--stack industream-${env}` : `--project ${env}`;
    console.log(`\n  ✅ READY. Run:\n     cd ${unified} && ./scripts/deploy.sh --runtime ${runtime} --edition ${edition} --env ${env} ${target}\n`);
  } else {
    console.log(`\n  ✗ ${blocking.length} blocking issue(s).${options.fix ? "" : " Re-run with --fix to provision."}\n`);
    process.exitCode = 1;
  }
}
