/**
 * Share links.
 *
 * New links carry the layout in the URL *fragment*, so it is never sent to a
 * server and doesn't end up in access logs:
 *
 *   https://site/#s=<base64url(deflate-raw(utf8(JSON)))>   (CompressionStream)
 *   https://site/#j=<base64url(utf8(JSON))>                (fallback when the
 *                                                           browser lacks
 *                                                           CompressionStream)
 *
 * The JSON is the same portable {@link ShareConfig} the JSON export box shows.
 * UTF-8 is used throughout, so emoji / non-Latin names round-trip (the old
 * `btoa(JSON)` encoder threw on them and silently produced an empty link).
 *
 * Legacy links `?config=<btoa(JSON)>` are still decoded exactly as before.
 */
import { isShareConfig, type ShareConfig } from './layout';

export const HASH_KEY_DEFLATE = 's';
export const HASH_KEY_PLAIN = 'j';
export const LEGACY_QUERY_KEY = 'config';

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

const deflate = (bytes: Uint8Array) => pipeThrough(bytes, new CompressionStream('deflate-raw'));
const inflate = (bytes: Uint8Array) => pipeThrough(bytes, new DecompressionStream('deflate-raw'));

// --- new (fragment) format ---------------------------------------------------------

/** Encode a config into a URL fragment payload, e.g. `s=...` (no leading `#`). */
export const encodeShareFragment = async (
  config: ShareConfig,
  { compress = supportsCompression() }: { compress?: boolean } = {},
): Promise<string> => {
  const json = new TextEncoder().encode(JSON.stringify(config));
  if (compress) return `${HASH_KEY_DEFLATE}=${bytesToBase64Url(await deflate(json))}`;
  return `${HASH_KEY_PLAIN}=${bytesToBase64Url(json)}`;
};

const parseConfig = (json: string): ShareConfig | null => {
  try {
    const parsed: unknown = JSON.parse(json);
    return isShareConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Decode a fragment (with or without the leading `#`). Returns null if it isn't a share link. */
export const decodeShareFragment = async (hash: string): Promise<ShareConfig | null> => {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  try {
    const deflated = params.get(HASH_KEY_DEFLATE);
    if (deflated) {
      if (!supportsCompression()) return null;
      const bytes = await inflate(base64UrlToBytes(deflated));
      return parseConfig(new TextDecoder().decode(bytes));
    }
    const plain = params.get(HASH_KEY_PLAIN);
    if (plain) return parseConfig(new TextDecoder().decode(base64UrlToBytes(plain)));
  } catch {
    return null;
  }
  return null;
};

// --- legacy (?config=) format ---------------------------------------------------------

/**
 * The original encoder: `btoa(JSON.stringify(config))`. Kept only for tests and
 * to document the format; it throws on non-Latin-1 text, which is why it was
 * replaced.
 */
export const encodeLegacyConfig = (config: ShareConfig): string => btoa(JSON.stringify(config));

/**
 * Decode `?config=` exactly like the original (`JSON.parse(atob(str))`, so
 * Latin-1 names come back the same). One tolerance added: a `+` that a chat
 * app left unescaped arrives as a space; turn it back into `+`.
 */
export const decodeLegacyConfig = (value: string): ShareConfig | null => {
  try {
    return parseConfig(atob(value.replace(/ /g, '+')));
  } catch {
    return null;
  }
};

// --- URL helpers ------------------------------------------------------------------

export interface SharedLayoutLink {
  config: ShareConfig;
  legacy: boolean;
}

export const hasShareLink = (href: string): boolean => {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return (
    url.searchParams.has(LEGACY_QUERY_KEY) || hash.has(HASH_KEY_DEFLATE) || hash.has(HASH_KEY_PLAIN)
  );
};

/** Read a shared layout from a URL: the new fragment format first, then legacy `?config=`. */
export const readShareLink = async (href: string): Promise<SharedLayoutLink | null> => {
  const url = new URL(href);
  if (url.hash) {
    const config = await decodeShareFragment(url.hash);
    if (config) return { config, legacy: false };
  }
  const legacy = url.searchParams.get(LEGACY_QUERY_KEY);
  if (legacy) {
    const config = decodeLegacyConfig(legacy);
    if (config) return { config, legacy: true };
  }
  return null;
};

/** The current URL with any share payload removed (used after importing it). */
export const stripShareLink = (href: string): string => {
  const url = new URL(href);
  url.searchParams.delete(LEGACY_QUERY_KEY);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  if (hash.has(HASH_KEY_DEFLATE) || hash.has(HASH_KEY_PLAIN)) url.hash = '';
  return url.toString();
};

/** Build a share URL for `config` on top of `baseHref` (query/fragment replaced). */
export const buildShareUrl = async (
  baseHref: string,
  config: ShareConfig,
  options?: { compress?: boolean },
): Promise<string> => {
  const url = new URL(stripShareLink(baseHref));
  url.hash = await encodeShareFragment(config, options);
  return url.toString();
};
