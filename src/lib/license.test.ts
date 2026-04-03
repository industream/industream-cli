// src/lib/license.test.ts
import { describe, it, expect } from "vitest";
import { SignJWT, importJWK } from "jose";
import { readFile } from "node:fs/promises";
import {
  validateLicense,
  type LicensePayload,
  type LicenseResult,
} from "./license.js";

async function createTestLicense(
  overrides: Partial<LicensePayload> = {},
  expiredDays = 0,
): Promise<string> {
  const privateJwk = JSON.parse(
    await readFile("keys/private.jwk.json", "utf-8"),
  );
  const privateKey = await importJWK(privateJwk, "ES256");

  const now = Math.floor(Date.now() / 1000);
  const payload: LicensePayload = {
    iss: "industream.com",
    sub: "test-client",
    customer: "Test Corp",
    plan: "enterprise",
    modules: ["opc-ua-connector"],
    seats: 10,
    trial: false,
    ...overrides,
  };

  const expiration = expiredDays > 0
    ? now - expiredDays * 86400
    : now + 365 * 86400;

  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "ES256" })
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(privateKey);
}

describe("license", () => {
  it("validates a valid license", async () => {
    const token = await createTestLicense();
    const result = await validateLicense(token);
    expect(result.isValid).toBe(true);
    expect(result.payload?.customer).toBe("Test Corp");
    expect(result.payload?.plan).toBe("enterprise");
  });

  it("rejects an expired license beyond grace period", async () => {
    const token = await createTestLicense({}, 31);
    const result = await validateLicense(token);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("accepts an expired license within grace period", async () => {
    const token = await createTestLicense({}, 15);
    const result = await validateLicense(token);
    expect(result.isValid).toBe(true);
    expect(result.isGracePeriod).toBe(true);
  });

  it("rejects a token with invalid signature", async () => {
    const result = await validateLicense("invalid.jwt.token");
    expect(result.isValid).toBe(false);
  });

  it("returns community plan when no license", async () => {
    const result = await validateLicense(undefined);
    expect(result.isValid).toBe(true);
    expect(result.payload?.plan).toBe("community");
  });
});
