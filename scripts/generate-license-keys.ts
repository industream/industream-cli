// scripts/generate-license-keys.ts
import { generateKeyPair, exportJWK } from "jose";
import { writeFile } from "node:fs/promises";

async function main() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  await writeFile("keys/public.jwk.json", JSON.stringify(publicJwk, null, 2));
  await writeFile("keys/private.jwk.json", JSON.stringify(privateJwk, null, 2));

  console.log("Keys generated in keys/");
  console.log("PUBLIC key goes into the CLI binary (src/lib/license.ts)");
  console.log("PRIVATE key stays with Industream for signing licenses");
}

main();
