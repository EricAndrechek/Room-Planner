// Builds the MCP plan viewer (worker/viewer/): bundles app.ts, which draws the plan with the
// same core code as the app's export, into the viewer.html template, and writes
// worker/viewer/dist/viewer.html, which the Worker serves as a `ui://` resource.
//
// Runs before every build: `pnpm build` and `build:ci`, Wrangler's custom build (wrangler.jsonc
// `build.command`, so `wrangler dev`, `deploy` and `preview` always carry a fresh view), and
// Vitest (vitest.config.ts).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'worker', 'viewer');
const PLACEHOLDER = '/* VIEWER_SCRIPT */';

/** The finished viewer HTML. */
export async function viewerHtml() {
  const result = await build({
    entryPoints: [join(dir, 'app.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  // `</script` inside the bundle would end the element early.
  const js = result.outputFiles[0].text.trim().replace(/<\/(script)/gi, '<\\/$1');
  const template = readFileSync(join(dir, 'viewer.html'), 'utf8');
  if (!template.includes(PLACEHOLDER)) throw new Error(`viewer.html lacks ${PLACEHOLDER}`);
  return template.replace(PLACEHOLDER, () => js);
}

export const VIEWER_OUT = join(dir, 'dist', 'viewer.html');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = await viewerHtml();
  mkdirSync(dirname(VIEWER_OUT), { recursive: true });
  writeFileSync(VIEWER_OUT, html);
  console.log(
    `build-viewer: ${VIEWER_OUT.slice(root.length + 1)} (${(html.length / 1024).toFixed(1)} KB)`,
  );
}
