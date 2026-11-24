import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordFor, recordsIn } from '../../scripts/registry-key.mjs';

describe('MCP Registry key check (scripts/registry-key.mjs)', () => {
  it('derives the public record from a hex Ed25519 private key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex');
    const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    expect(recordFor(seed)).toBe(`v=MCPv1; k=ed25519; p=${pub}`);
    expect(() => recordFor('not-hex')).toThrow();
  });

  it('the committed proof file holds Ed25519 records only', () => {
    const records = recordsIn(readFileSync('public/.well-known/mcp-registry-auth', 'utf8'));
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) expect(r).toMatch(/^v=MCPv1; k=ed25519; p=[A-Za-z0-9+/]{43}=$/);
  });
});
