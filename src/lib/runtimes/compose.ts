// src/lib/runtimes/compose.ts
// ComposeRuntime — placeholder implementation that lets TypeScript compile
// while the real Compose runtime lands in Phase 2 (see
// `docs/RUNTIME-STRATEGY.md` §4 and `docs/INTEGRATION-PLAN.md` §7).
//
// Every method throws `not implemented` so that any accidental wiring
// fails loudly instead of silently degrading.
import type { IndustreamConfig } from "../config.js";
import type {
  DeployOptions,
  Environment,
  LogsOptions,
  Runtime,
  RuntimeName,
  StackStatus,
} from "./index.js";

const NOT_IMPLEMENTED = "ComposeRuntime: not implemented yet — see Phase 2";

export class ComposeRuntime implements Runtime {
  public readonly name: RuntimeName = "compose";

  constructor(private readonly config: IndustreamConfig) {
    // Config is kept for parity with SwarmRuntime and future use.
    void this.config;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deploy(_env: Environment, _opts: DeployOptions): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async down(_env: Environment): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async status(): Promise<StackStatus> {
    throw new Error(NOT_IMPLEMENTED);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async logs(
    _service: string | undefined,
    _opts: LogsOptions,
  ): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
