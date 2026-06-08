// src/dev/dashboard-demo.tsx
// Standalone demo of <DeployDashboard> driven by a scripted DeployReporter.
// Run: npx tsx src/dev/dashboard-demo.tsx
import React from "react";
import { render } from "ink";
import { DeployReporter } from "../lib/deploy-reporter.js";
import { DeployDashboard } from "../components/DeployDashboard.js";

const reporter = new DeployReporter();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function script(): Promise<void> {
  reporter.setSteps([
    { id: "certs", label: "Generate certificates", status: "pending" },
    { id: "secrets", label: "Create secrets", status: "pending" },
    { id: "stack", label: "Deploy stack", status: "pending" },
    { id: "converge", label: "Wait for services", status: "pending" },
  ]);
  const names = ["postgres", "industream-hub-frontend", "industream-hub-backend", "grafana", "databridge", "prometheus"];

  reporter.step("certs", "running");
  for (const l of ["openssl req -x509 …", "certificate written"]) { reporter.log(l); await sleep(250); }
  reporter.step("certs", "done");

  reporter.step("secrets", "running");
  for (const l of ["postgres_password ✓", "hub_jwt_signing_key ✓"]) { reporter.log(l); await sleep(250); }
  reporter.step("secrets", "done");

  reporter.step("stack", "running", `${names.length} services`);
  const svcs = names.map((n) => ({ name: n, ready: 0, total: 1, converged: false }));
  reporter.setServices(svcs);
  for (const n of names) { reporter.log(`Creating service industream-prod_${n}`); await sleep(200); }
  reporter.step("stack", "done");

  reporter.step("converge", "running");
  for (let i = 0; i < svcs.length; i++) {
    await sleep(320);
    svcs[i] = { ...svcs[i], ready: 1, converged: true };
    reporter.setServices([...svcs]);
    reporter.log(`industream-prod_${names[i]} converged (1/1)`);
  }
  reporter.step("converge", "done");

  reporter.setResult({
    ok: true,
    summary: "prod deployed via swarm (demo)",
    urls: [
      { label: "Hub", url: "https://industream.platform.lan" },
      { label: "Grafana", url: "https://dashboard.industream.platform.lan" },
    ],
  });
  await sleep(700);
}

const { unmount } = render(
  <DeployDashboard reporter={reporter} title="Industream installer · prod · swarm (demo)" />,
);
void script().then(() => setTimeout(() => { unmount(); process.exit(0); }, 400));
