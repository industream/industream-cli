// src/lib/secrets/index.ts
// SecretsBackend abstraction: one TypeScript contract, two implementations.
// - `SwarmSecrets` (docker secret ls / inspect, delegates rotation to the
//   shell script `scripts/setup/create-secrets.sh`).
// - `ComposeSecrets` (file-based secrets under `${platformDir}/secrets/`).
//
// See `docs/INTEGRATION-PLAN.md` §6 for the broader compose/swarm strategy.

export interface SecretDescriptor {
  /** Short secret name, without the `${env}_` prefix. */
  name: string;
  /** Environment (Swarm stack name suffix or Compose project name). */
  env: string;
  /** Optional logical scope (e.g. "postgres", "keycloak"). */
  scope?: string;
  /** Whether the secret currently exists in the backend. */
  exists: boolean;
}

export interface SecretsBackend {
  readonly name: "swarm" | "compose";

  /** List every secret belonging to `env`. */
  list(env: string): Promise<SecretDescriptor[]>;

  /**
   * Regenerate (create or rotate) every secret for `env`. Delegates to
   * `scripts/setup/create-secrets.sh`; each backend passes the flags that
   * match its storage model.
   */
  regenerate(env: string): Promise<void>;

  /**
   * Return the raw value of a secret.
   * - Swarm: throws — the raft store does not expose secret contents by design.
   * - Compose: reads the file on disk.
   */
  show(name: string, env: string): Promise<string>;

  /** Whether `${env}_${name}` exists in the backend. */
  exists(name: string, env: string): Promise<boolean>;
}

export { SwarmSecrets } from "./swarm.js";
export { ComposeSecrets } from "./compose.js";
