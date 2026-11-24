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
 * The JSON is a plan in the compact form (share/compact.ts; written by share/plan.ts); links
 * written before the plan format hold the v3 layout object instead, and every version is read by
 * `loadPlan`. UTF-8 is used throughout, so emoji / non-Latin names round-trip (the old
 * `btoa(JSON)` encoder threw on them and silently produced an empty link).
 *
 * Legacy links `?config=<btoa(JSON)>` are still decoded exactly as before.
 */
import { base64UrlToBytes, bytesToBase64Url, deflate, inflate, supportsCompression } from './codec';

export const HASH_KEY_DEFLATE = 's';
export const HASH_KEY_PLAIN = 'j';
export const LEGACY_QUERY_KEY = 'config';

// --- new (fragment) format ---------------------------------------------------------

/**
 * Encode a payload into a URL fragment, e.g. `s=...` (no leading `#`): a plan in the compact form
 * (an array), or any JSON.
 */
export const encodeShareFragment = async (
  config: unknown,
  { compress = supportsCompression() }: { compress?: boolean } = {},
): Promise<string> => {
  const json = new TextEncoder().encode(JSON.stringify(config));
  if (compress) return `${HASH_KEY_DEFLATE}=${bytesToBase64Url(await deflate(json))}`;
  return `${HASH_KEY_PLAIN}=${bytesToBase64Url(json)}`;
};

/**
 * What a link's payload turned out to be: absent, present but undecodable (cut off or mangled:
 * bad base64, bad deflate data, not JSON), not decodable in this browser (`#s=` without
 * DecompressionStream), or JSON of any shape (the caller decides what it is).
 */
export type DecodedPayload =
  | { status: 'none' }
  | { status: 'damaged' }
  | { status: 'unsupported' }
  | { status: 'ok'; data: unknown };

const parseJson = (json: string): DecodedPayload => {
  try {
    return { status: 'ok', data: JSON.parse(json) as unknown };
  } catch {
    return { status: 'damaged' };
  }
};

/** Decode a fragment's payload (with or without the leading `#`), whatever JSON it holds. */
export const decodeFragmentPayload = async (hash: string): Promise<DecodedPayload> => {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const deflated = params.get(HASH_KEY_DEFLATE);
  const plain = params.get(HASH_KEY_PLAIN);
  try {
    if (deflated) {
      if (!supportsCompression()) return { status: 'unsupported' };
      const bytes = await inflate(base64UrlToBytes(deflated));
      return parseJson(new TextDecoder().decode(bytes));
    }
    if (plain) return parseJson(new TextDecoder().decode(base64UrlToBytes(plain)));
  } catch {
    return { status: 'damaged' };
  }
  // `#s=` or `#j=` with nothing after it.
  return params.has(HASH_KEY_DEFLATE) || params.has(HASH_KEY_PLAIN)
    ? { status: 'damaged' }
    : { status: 'none' };
};

// --- legacy (?config=) format ---------------------------------------------------------

/**
 * Decode `?config=` exactly like the original (`JSON.parse(atob(str))`, so
 * Latin-1 names come back the same). One tolerance added: a `+` that a chat
 * app left unescaped arrives as a space; turn it back into `+`.
 */
export const decodeLegacyPayload = (value: string): DecodedPayload => {
  try {
    return parseJson(atob(value.replace(/ /g, '+')));
  } catch {
    return { status: 'damaged' };
  }
};

// --- URL helpers ------------------------------------------------------------------

export const hasShareLink = (href: string): boolean => {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return (
    url.searchParams.has(LEGACY_QUERY_KEY) || hash.has(HASH_KEY_DEFLATE) || hash.has(HASH_KEY_PLAIN)
  );
};

export type SharePayload =
  | { status: 'none' }
  | { status: 'unsupported' }
  | { status: 'damaged'; legacy: boolean }
  | { status: 'ok'; data: unknown; legacy: boolean };

/**
 * The payload of whatever share link `href` carries, in any format and of any version: the
 * fragment first, then legacy `?config=` (also when the fragment is damaged).
 */
export const readSharePayload = async (href: string): Promise<SharePayload> => {
  const url = new URL(href);
  const fragment = url.hash ? await decodeFragmentPayload(url.hash) : { status: 'none' as const };
  if (fragment.status === 'ok') return { ...fragment, legacy: false };
  const legacy = url.searchParams.get(LEGACY_QUERY_KEY);
  if (legacy !== null) {
    const decoded = legacy ? decodeLegacyPayload(legacy) : { status: 'damaged' as const };
    if (decoded.status === 'ok') return { ...decoded, legacy: true };
    if (fragment.status !== 'unsupported') return { status: 'damaged', legacy: true };
  }
  if (fragment.status === 'damaged') return { status: 'damaged', legacy: false };
  return { status: fragment.status };
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
  config: unknown,
  options?: { compress?: boolean },
): Promise<string> => {
  const url = new URL(stripShareLink(baseHref));
  url.hash = await encodeShareFragment(config, options);
  return url.toString();
};
