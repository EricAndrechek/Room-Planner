import type { ConsoleMessage } from '@playwright/test';

// Third-party analytics the site loads but tolerates losing: PostHog, and the Cloudflare Web
// Analytics beacon the andrechek.com zone injects. Ad/DNS blockers often refuse these, which
// surfaces as a console "Failed to load resource" error — expected, not a site bug.
const ANALYTICS_HOST = /(^|\.)(posthog\.com|cloudflareinsights\.com)$/;

/**
 * PostHog finds the widest cookie domain it may use by trying to set a throwaway `dmn_chk_<uuid>`
 * cookie on each parent domain, starting at the public suffix (`.com`). Browsers refuse that one;
 * Firefox logs the refusal as an error. Harmless and expected: PostHog then uses the next level.
 */
const POSTHOG_DOMAIN_PROBE = /Cookie “dmn_chk_[\w-]+” has been rejected for invalid domain/;

/** True when a console error is just a blocked/failed request to a tolerated analytics host. */
export function isBlockedAnalytics(m: ConsoleMessage): boolean {
  if (POSTHOG_DOMAIN_PROBE.test(m.text())) return true;
  // Firefox reports a blocked/tampered beacon as "[JavaScript Error: Cross-Origin Request Blocked ...
  // https://static.cloudflareinsights.com/..." or an SRI mismatch, with no resource location.
  if (
    /cross-origin request blocked|integrity attribute/i.test(m.text()) &&
    /(posthog\.com|cloudflareinsights\.com)/.test(m.text())
  )
    return true;
  if (!/^Failed to load resource/.test(m.text())) return false;
  try {
    return ANALYTICS_HOST.test(new URL(m.location().url).hostname);
  } catch {
    return false;
  }
}

/** Console messages that count as problems: errors and CSP violations, minus blocked analytics. */
export function isProblem(m: ConsoleMessage): boolean {
  const csp = /content[- ]security[- ]policy|refused to/i.test(m.text());
  if (csp) return true; // a CSP violation is always a problem, even for analytics hosts
  return m.type() === 'error' && !isBlockedAnalytics(m);
}
