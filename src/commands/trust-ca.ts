// src/commands/trust-ca.ts
// `industream trust-ca` — install the platform's self-signed CA certificate
// into the OPERATOR's machine trust store so browsers/curl stop warning with
// ERR_CERT_AUTHORITY_INVALID. CA trust is client-side, so this is a
// per-workstation helper the operator runs.
//
// The per-OS commands below MIRROR industream-stack/scripts/generate/
// generate-certs.sh (the known-good trust block). Keep them in sync.
import { execa } from "execa";
import { access, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../lib/config.js";
import { resolvePlatformDir, loadEnvFile } from "../lib/swarm-repo.js";

const DEFAULT_DOMAIN = "industream.platform.lan";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execa("command", ["-v", command], { shell: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the CA certificate path. Prefer an explicit --cert; otherwise derive
 * the domain from the platform .env (INDUSTREAM_DOMAIN ?? DOMAIN) and look up
 * <platformDir>/certs/<domain>.crt.
 */
async function resolveCertPath(opts: {
  domain?: string;
  cert?: string;
}): Promise<{ cert: string; domain: string }> {
  const config = await loadConfig();
  if (opts.cert) {
    const domain = opts.domain ?? basename(opts.cert).replace(/\.crt$/, "");
    return { cert: opts.cert, domain };
  }
  let envDomain: string | undefined;
  try {
    const env = await loadEnvFile(config.platformDir);
    envDomain = env.INDUSTREAM_DOMAIN ?? env.DOMAIN;
  } catch {
    // .env not present on this workstation — fall back to the default domain.
  }
  const domain = opts.domain ?? envDomain ?? DEFAULT_DOMAIN;
  const cert = join(resolvePlatformDir(config.platformDir), "certs", `${domain}.crt`);
  return { cert, domain };
}

/** Run one best-effort trust step; print a clear ✓/⚠ line, never throw. */
async function bestEffort(
  label: string,
  run: () => Promise<void>,
): Promise<boolean> {
  try {
    await run();
    console.log(`✓ ${label}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`⚠ ${label} failed: ${message}`);
    return false;
  }
}

/** Install into the system trust store (sudo). Returns a label for the summary. */
async function installSystemTrust(cert: string): Promise<string | undefined> {
  const base = basename(cert).replace(/\.crt$/, "");

  if (process.platform === "darwin") {
    const ok = await bestEffort("macOS system keychain (security add-trusted-cert)", () =>
      execa(
        "sudo",
        [
          "security",
          "add-trusted-cert",
          "-d",
          "-r",
          "trustRoot",
          "-k",
          "/Library/Keychains/System.keychain",
          cert,
        ],
        { stdio: "inherit" },
      ).then(() => undefined),
    );
    return ok ? "macOS system keychain" : undefined;
  }

  // Linux: pick the distro path by which tool/dir exists.
  if ((await commandExists("trust")) || (await pathExists("/etc/ca-certificates/trust-source"))) {
    const ok = await bestEffort("Arch system trust store (trust anchor)", () =>
      execa("sudo", ["trust", "anchor", cert], { stdio: "inherit" }).then(() => undefined),
    );
    return ok ? "Arch system trust store" : undefined;
  }

  if (await pathExists("/usr/local/share/ca-certificates")) {
    const dest = `/usr/local/share/ca-certificates/${base}.crt`;
    const ok = await bestEffort(
      "Debian/Ubuntu system trust store (update-ca-certificates)",
      async () => {
        await execa("sudo", ["cp", cert, dest], { stdio: "inherit" });
        await execa("sudo", ["update-ca-certificates"], { stdio: "inherit" });
      },
    );
    return ok ? "Debian/Ubuntu system trust store" : undefined;
  }

  if (await pathExists("/etc/pki/ca-trust/source/anchors")) {
    const dest = `/etc/pki/ca-trust/source/anchors/${base}.crt`;
    const ok = await bestEffort(
      "Fedora/RHEL system trust store (update-ca-trust)",
      async () => {
        await execa("sudo", ["cp", cert, dest], { stdio: "inherit" });
        await execa("sudo", ["update-ca-trust"], { stdio: "inherit" });
      },
    );
    return ok ? "Fedora/RHEL system trust store" : undefined;
  }

  console.log(
    "⚠ Unknown OS — could not detect a system trust store. Import the cert manually:",
  );
  console.log(`    ${cert}`);
  return undefined;
}

/**
 * NSS for Chrome/Firefox (Linux). Best-effort: the shared ~/.pki/nssdb store
 * (Chromium/Chrome) plus any Firefox profiles.
 */
async function installNssTrust(cert: string, domain: string): Promise<string[]> {
  if (process.platform === "darwin") return [];
  const added: string[] = [];

  if (!(await commandExists("certutil"))) {
    console.log(
      "⚠ certutil not found — install nss/libnss3-tools for Chrome/Firefox support, or import the cert manually in the browser settings.",
    );
    return added;
  }

  const nssdb = join(homedir(), ".pki", "nssdb");
  if (await pathExists(nssdb)) {
    const ok = await bestEffort(`Chrome/Chromium NSS database (${nssdb})`, async () => {
      // Remove an existing entry first so re-runs don't fail.
      await execa("certutil", ["-D", "-n", domain, "-d", `sql:${nssdb}`]).catch(() => undefined);
      await execa("certutil", [
        "-A",
        "-n",
        domain,
        "-t",
        "CT,c,c",
        "-i",
        cert,
        "-d",
        `sql:${nssdb}`,
      ]);
    });
    if (ok) added.push("Chrome/Chromium (NSS)");
  }

  const firefoxDir = join(homedir(), ".mozilla", "firefox");
  if (await pathExists(firefoxDir)) {
    let profiles: string[] = [];
    try {
      const entries = await readdir(firefoxDir, { withFileTypes: true });
      profiles = entries
        .filter((entry) => entry.isDirectory() && /\.default/.test(entry.name))
        .map((entry) => join(firefoxDir, entry.name));
    } catch {
      profiles = [];
    }
    for (const profile of profiles) {
      // Firefox profiles use a cert9.db (sql) store.
      if (!(await pathExists(join(profile, "cert9.db")))) continue;
      const ok = await bestEffort(`Firefox profile (${basename(profile)})`, async () => {
        await execa("certutil", ["-D", "-n", domain, "-d", `sql:${profile}`]).catch(
          () => undefined,
        );
        await execa("certutil", [
          "-A",
          "-n",
          domain,
          "-t",
          "CT,c,c",
          "-i",
          cert,
          "-d",
          `sql:${profile}`,
        ]);
      });
      if (ok) added.push(`Firefox (${basename(profile)})`);
    }
  }

  return added;
}

export async function runTrustCa(opts: { domain?: string; cert?: string }): Promise<void> {
  const { cert, domain } = await resolveCertPath(opts);

  if (!(await pathExists(cert))) {
    console.error(`✗ CA certificate not found: ${cert}`);
    console.error("");
    console.error(
      "Run this on the host that has the platform tree, or pass --cert <path>.",
    );
    console.error(
      `For a remote install, copy the cert over first, e.g.:\n  scp <server>:~/industream-platform/certs/${domain}.crt .\n  industream trust-ca --cert ./${domain}.crt`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Installing platform CA into your machine trust store:`);
  console.log(`  cert:   ${cert}`);
  console.log(`  domain: ${domain}`);
  console.log("");

  const added: string[] = [];
  const systemLabel = await installSystemTrust(cert);
  if (systemLabel) added.push(systemLabel);
  added.push(...(await installNssTrust(cert, domain)));

  console.log("");
  if (added.length === 0) {
    console.log("No trust store was updated automatically. Import the cert manually:");
    console.log(`  ${cert}`);
    return;
  }
  console.log(`Trusted CA added to: ${added.join(", ")}.`);
  console.log("↻ Restart your browser for the change to take effect.");
}
