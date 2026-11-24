/**
 * Byte encodings for share links: base64url (RFC 4648 section 5, no padding) and raw deflate via
 * the web-standard CompressionStream (browsers, Workers and Node all have it).
 */

// --- base64url ----------------------------------------------------------------

export const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const base64UrlToBytes = (input: string): Uint8Array => {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// --- compression ----------------------------------------------------------------

export const supportsCompression = (): boolean =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

const pipeThrough = async (
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> => {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
};

export const deflate = (bytes: Uint8Array) =>
  pipeThrough(bytes, new CompressionStream('deflate-raw'));
export const inflate = (bytes: Uint8Array) =>
  pipeThrough(bytes, new DecompressionStream('deflate-raw'));
