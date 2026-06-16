// src/lib/deploy-reporter.ts
// Structured progress contract between a Runtime.deploy() and the UI.
// Runtimes (swarm/compose) NEVER touch Ink — they only push events here, so the
// exact same <DeployDashboard> renders any orchestrator. A headless logger can
// subscribe just as well (CI / non-TTY).

import { EventEmitter } from "node:events";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface DeployStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface ServiceHealth {
  name: string;
  ready: number;
  total: number;
  converged: boolean;
}

export interface DeployResultInfo {
  ok: boolean;
  summary: string;
  urls: { label: string; url: string }[];
  /** Generated admin credentials, shown ONCE at the end of install. */
  credentials?: { label: string; user: string; pass: string }[];
  /** Where the full set of generated secrets lives on disk (operator-only). */
  secretsDir?: string;
  /** Self-signed TLS hint: how to trust the CA so the browser stops warning. */
  tls?: { selfSigned: boolean; caPath?: string };
  /** /etc/hosts block to add on the operator workstation (self-signed/local domain). */
  hostsBlock?: string;
  /** Versioned deploy-state git repo (desired baseline recorded at install). */
  deployState?: { dir: string };
}

export interface DeploySnapshot {
  steps: DeployStep[];
  logs: string[];
  services: ServiceHealth[];
  result?: DeployResultInfo;
}

const MAX_LOGS = 1000;

export class DeployReporter extends EventEmitter {
  private snapshot: DeploySnapshot = { steps: [], logs: [], services: [] };

  setSteps(steps: DeployStep[]): void {
    this.snapshot.steps = steps.map((s) => ({ ...s }));
    this.emit("update");
  }

  step(id: string, status: StepStatus, detail?: string): void {
    const step = this.snapshot.steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      if (detail !== undefined) step.detail = detail;
    }
    this.emit("update");
  }

  log(line: string): void {
    this.snapshot.logs.push(line);
    if (this.snapshot.logs.length > MAX_LOGS) this.snapshot.logs.shift();
    this.emit("update");
  }

  setServices(services: ServiceHealth[]): void {
    this.snapshot.services = services;
    this.emit("update");
  }

  setResult(result: DeployResultInfo): void {
    this.snapshot.result = result;
    this.emit("update");
  }

  /** Immutable view for the UI to render. */
  get(): DeploySnapshot {
    return {
      steps: this.snapshot.steps.map((s) => ({ ...s })),
      logs: [...this.snapshot.logs],
      services: this.snapshot.services.map((s) => ({ ...s })),
      result: this.snapshot.result,
    };
  }
}
