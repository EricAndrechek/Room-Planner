// Checks that the MCP Registry signing key (the MCP_REGISTRY_PRIVATE_KEY secret, Ed25519, hex) is
// the private half of the public record committed at public/.well-known/mcp-registry-auth, so a
// mismatched secret fails on the pull request instead of at publish time. The key is never
// printed. Without the secret (a fork's pull request) it skips. docs/DEPLOY.md, "MCP Registry".
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** PKCS#8 DER prefix for an Ed25519 private key; the 32-byte seed follows. */
const PKCS8_ED25519 = '302e020100300506032b657004220420';

/** The proof record (`v=MCPv1; k=ed25519; p=<base64>`) for a hex Ed25519 private key. */
export function recordFor(hexKey) {
  const seed = hexKey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new Error('The key is not 32 bytes of hex.');
  const key = createPrivateKey({
    key: Buffer.from(PKCS8_ED25519 + seed, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return `v=MCPv1; k=ed25519; p=${spki.subarray(-32).toString('base64')}`;
}

/** The records in a proof file: one per line, surrounding whitespace ignored. */
export const recordsIn = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hexKey = process.env.MCP_REGISTRY_PRIVATE_KEY ?? '';
  if (!hexKey) {
    console.log('registry-key: no MCP_REGISTRY_PRIVATE_KEY here (a fork?), skipped.');
    process.exit(0);
  }
  const file = new URL('../public/.well-known/mcp-registry-auth', import.meta.url);
  const records = recordsIn(readFileSync(file, 'utf8'));
  let record;
  try {
    record = recordFor(hexKey);
  } catch (error) {
    console.error(`registry-key: ${error.message}`);
    process.exit(1);
  }
  if (!records.includes(record)) {
    console.error('registry-key: the secret does not match public/.well-known/mcp-registry-auth.');
    process.exit(1);
  }
  console.log('registry-key: the secret matches the committed public record.');
}
