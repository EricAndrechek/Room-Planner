/**
 * Test reference, frozen: how the v3 app read share links (core/share/link.ts before the app held
 * plans): only an object with `roomDims` and a list of `items` was a layout.
 */
import { isShareConfig, type ShareConfig } from './layout';
import {
  decodeFragmentPayload,
  decodeLegacyPayload,
  HASH_KEY_DEFLATE,
  HASH_KEY_PLAIN,
  LEGACY_QUERY_KEY,
  type DecodedPayload,
} from '../../share/link';

const asConfig = (d: DecodedPayload): ShareConfig | null =>
  d.status === 'ok' && isShareConfig(d.data) ? d.data : null;

/** Decode a fragment (with or without the leading `#`). Null if it isn't a v3 share link. */
export const decodeShareFragment = async (hash: string): Promise<ShareConfig | null> =>
  asConfig(await decodeFragmentPayload(hash));

/** The original encoder: `btoa(JSON.stringify(config))` (throws on non-Latin-1 text). */
export const encodeLegacyConfig = (config: ShareConfig): string => btoa(JSON.stringify(config));

export const decodeLegacyConfig = (value: string): ShareConfig | null =>
  asConfig(decodeLegacyPayload(value));

export interface SharedLayoutLink {
  config: ShareConfig;
  legacy: boolean;
}

/** Read a shared layout from a URL: the fragment first, then legacy `?config=`. */
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

export { HASH_KEY_DEFLATE, HASH_KEY_PLAIN };
