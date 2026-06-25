// src/lib/keygen.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Avoid touching the real ~/.industream directory during activation.
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
});

import { activateLicense } from "./keygen.js";

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

const LICENSE_ID = "05ae84be-8ff0-4267-a153-c4af03862d4f";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
}

describe("activateLicense — floating machine registration", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Regression: a floating license that already has one machine registered
   * returns code FINGERPRINT_SCOPE_MISMATCH (not NO_MACHINE/NO_MACHINES) when
   * validated from a brand-new machine. The client must still register the new
   * machine and re-validate, so additional VMs can use the floating seats.
   */
  it("registers a new machine when validation returns FINGERPRINT_SCOPE_MISMATCH", async () => {
    let validateCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        calls.push({ url, method, body });

        if (url.endsWith("/licenses/actions/validate-key")) {
          validateCount += 1;
          // First validation: new fingerprint, license already has a machine.
          if (validateCount === 1) {
            return jsonResponse(200, {
              data: {
                id: LICENSE_ID,
                type: "licenses",
                attributes: { name: "GMH Bous", metadata: { plan: "enterprise" } },
              },
              meta: {
                ts: "2026-06-25T00:00:00Z",
                valid: false,
                detail: "fingerprint is not valid",
                code: "FINGERPRINT_SCOPE_MISMATCH",
                scope: {},
              },
            });
          }
          // Second validation: after the machine has been registered.
          return jsonResponse(200, {
            data: {
              id: LICENSE_ID,
              type: "licenses",
              attributes: { name: "GMH Bous", metadata: { plan: "enterprise" } },
            },
            meta: {
              ts: "2026-06-25T00:00:00Z",
              valid: true,
              detail: "is valid",
              code: "VALID",
              scope: {},
            },
          });
        }

        if (url.endsWith("/machines") && method === "POST") {
          return jsonResponse(201, { data: { id: "machine-2", type: "machines" } });
        }

        if (url.endsWith("/entitlements")) {
          return jsonResponse(200, { data: [{ attributes: { code: "PRODUCT_AI_STUDIO" } }] });
        }

        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const response = await activateLicense("BC21AE-7391EB-709DCA-C16565-97A074-V3");

    // The activation must succeed for the second VM.
    expect(response.meta.valid).toBe(true);

    // A machine must have actually been registered.
    const machinePost = calls.find(
      (c) => c.url.endsWith("/machines") && c.method === "POST",
    );
    expect(machinePost).toBeDefined();
  });
});
