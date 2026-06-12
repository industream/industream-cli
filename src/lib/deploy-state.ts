// src/lib/deploy-state.ts
// Arg-builder for `unified/scripts/deploy-state.sh` (versioned deploy state:
// live Portainer snapshots + rendered desired state in a local .deploy-state
// git repo). Pure and deterministic so it can be unit-tested without a
// platform tree — mirrors the buildDeployArgs pattern in unified-deploy.ts.

export const STATE_SUBCOMMANDS = ["init", "snapshot", "render", "diff", "log"] as const;
export type StateSubcommand = (typeof STATE_SUBCOMMANDS)[number];

export interface StateOptions {
  env?: string;
  edition?: string;
  baked?: boolean;
}

/** True when the given string is a known deploy-state.sh subcommand. */
export function isStateSubcommand(value: string): value is StateSubcommand {
  return (STATE_SUBCOMMANDS as readonly string[]).includes(value);
}

/**
 * Build the argv for `unified/scripts/deploy-state.sh`: subcommand first,
 * then `--env` / `--edition` / `--baked` only when provided.
 */
export function buildStateArgs(subcommand: string, opts: StateOptions = {}): string[] {
  const args = [subcommand];
  if (opts.env) args.push("--env", opts.env);
  if (opts.edition) args.push("--edition", opts.edition);
  if (opts.baked) args.push("--baked");
  return args;
}
