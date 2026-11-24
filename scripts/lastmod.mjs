// When each page's content last changed: the newest commit touching its source files (git
// committer date), or the build time when git can't tell (no checkout, or uncommitted new file).
// Used for the sitemap's <lastmod> (astro.config.mjs) and the guides' "Updated" date.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// The project root. Not derived from import.meta.url: Astro bundles this file into its build output.
const root = process.cwd();
const buildTime = new Date();

/** Source files whose edits count as a content change of each page, beyond the page file itself. */
const EXTRA_SOURCES = {
  '/': ['src/lib/site.ts'],
  '/help/': ['src/lib/shortcuts.ts'],
  '/guides/': ['src/lib/guides/index.ts'],
};
const GUIDE_SOURCES = ['src/lib/guides/examples.ts', 'src/lib/guides/index.ts'];

/** Repo-relative source files for a site path such as `/guides/bedroom-layout/`. */
export function sourcesFor(pathname) {
  const path = pathname.replace(/^\/+|\/+$/g, '');
  const candidates = path
    ? [`src/pages/${path}.astro`, `src/pages/${path}/index.astro`]
    : ['src/pages/index.astro'];
  const extra = EXTRA_SOURCES[`/${path}${path ? '/' : ''}`] ?? [];
  const guide = /^guides\/[^/]+$/.test(path) ? GUIDE_SOURCES : [];
  return [...candidates, ...extra, ...guide].filter((f) => existsSync(`${root}/${f}`));
}

const cache = new Map();

/** Last content change of the page at `pathname`. */
export function lastModified(pathname) {
  if (cache.has(pathname)) return cache.get(pathname);
  let date = buildTime;
  const files = sourcesFor(pathname);
  if (files.length) {
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...files], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (out) date = new Date(out);
    } catch {
      /* not a git checkout: keep the build time */
    }
  }
  cache.set(pathname, date);
  return date;
}
