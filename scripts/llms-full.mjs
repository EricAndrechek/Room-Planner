// Builds dist/llms-full.txt (https://llmstxt.org): the text of the help page, FAQ and guides as
// Markdown, converted from the built HTML so it can never drift from what the pages say.
// Runs as an Astro integration after the build (astro.config.mjs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKDOWN_PAGES, apiCatalog, markdownPath, securityTxt } from './discovery.mjs';

/** Site paths included, in order. Guides are appended from dist/guides/. */
const PAGES = ['faq/', 'help/', 'agents/', 'privacy/', 'guides/'];

/** `_headers` rules for the files this integration writes (appended to dist/_headers). */
const DISCOVERY_HEADERS = (mdPaths) =>
  [
    '',
    '# Written by scripts/llms-full.mjs at build time: the Markdown twins of the pages, the',
    "# API catalog (RFC 9727) and security.txt (RFC 9116). The pages' Link headers come from the",
    '# Worker (worker/index.ts).',
    ...mdPaths.flatMap((p) => [
      p,
      '  Content-Type: text/markdown; charset=utf-8',
      '  Access-Control-Allow-Origin: *',
      '  Cache-Control: public, max-age=3600',
      '',
    ]),
    '/.well-known/api-catalog',
    '  Content-Type: application/linkset+json',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: public, max-age=3600',
    '',
    '/.well-known/security.txt',
    '  Content-Type: text/plain; charset=utf-8',
    '  Access-Control-Allow-Origin: *',
    '',
  ].join('\n');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#')
      return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });

/**
 * Convert the `<main>` of one of this site's pages to Markdown. Not a general converter: it knows
 * the markup these pages use (headings, paragraphs, lists, tables, links, inline emphasis).
 * @param {string} html
 * @param {string} origin e.g. `https://room-planner.andrechek.com`
 */
export function htmlToMarkdown(html, origin) {
  let s = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? '';
  // Code blocks keep their lines: set aside before whitespace is collapsed, put back as fences.
  const blocks = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    blocks.push(decode(code.replace(/<[^>]+>/g, '')).replace(/^\n+|\s+$/g, ''));
    return `<p>@@CODEBLOCK${blocks.length - 1}@@</p>`;
  });
  s = s
    // Not content: scripts, drawings (their captions say what they show), navigation, controls,
    // and the share links of the examples (long, and only useful in a browser).
    .replace(/<(script|style|svg|label|button|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<p\b[^>]*data-loading[^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '')
    .replace(/<a\b[^>]*data-open-example[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<span class="sr-only">[\s\S]*?<\/span>/gi, '')
    .replace(/<input\b[^>]*>/gi, '')
    .replace(/\s+/g, ' ');

  s = s
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const url = new URL(decode(href), `${origin}/`).toString();
      return `[${text.trim()}](${url})`;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<(code|kbd)\b[^>]*>([\s\S]*?)<\/\1>/gi, '`$2`')
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, n, t) => `\n\n${'#'.repeat(+n)} ${t.trim()}\n\n`,
    )
    .replace(/<caption\b[^>]*>([\s\S]*?)<\/caption>/gi, '\n\n$1\n\n')
    // Tables: one Markdown row per <tr>; a separator after the header row.
    .replace(/<thead\b[^>]*>([\s\S]*?)<\/thead>/gi, (_, head) => {
      const cells = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => m[1].trim());
      return `\n| ${cells.join(' | ')} |\n|${cells.map(() => ' --- |').join('')}\n`;
    })
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
      const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, '').trim(),
      );
      return `| ${cells.join(' | ')} |\n`;
    })
    .replace(/<\/?table\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|figure|figcaption|ul|ol|article|header|li)>/gi, '\n')
    .replace(/<(p|div|section|figure|figcaption|ul|ol|article|header)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return decode(s)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/(?<=\n- [^\n]*)\n\n(?=- )/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/@@CODEBLOCK(\d+)@@/g, (_, i) => `\`\`\`\n${blocks[Number(i)]}\n\`\`\``);
}

const read = (dist, path) => readFileSync(join(dist, path, 'index.html'), 'utf8');

/** Astro integration: write dist/llms-full.txt after the build. */
export function llmsFull() {
  /** @type {string | undefined} */
  let site;
  return {
    name: 'llms-full',
    hooks: {
      /** @param {{ config: { site?: string } }} options */
      'astro:config:done': ({ config }) => {
        site = config.site;
      },
      /** @param {{ dir: URL, pages: { pathname: string }[] }} options */
      'astro:build:done': ({ dir, pages }) => {
        const dist = fileURLToPath(dir);
        const origin = (site ?? 'http://localhost').replace(/\/+$/, '');
        const guides = pages
          .map((p) => p.pathname.replace(/^\/+/, ''))
          .filter((p) => /^guides\/[^/]+\/$/.test(p))
          .sort();
        const sections = [...PAGES, ...guides].map((path) => {
          const md = htmlToMarkdown(read(dist, path), origin);
          return `<!-- ${origin}/${path} -->\n\n${md}`;
        });
        const head =
          '# Room Planner: help, FAQ, AI assistants and room layout guides (full text)\n\n' +
          `> The text of ${origin}/faq/, /help/, /agents/, /privacy/ and /guides/, generated from the site at build time. ` +
          `Summary and links: ${origin}/llms.txt\n`;
        writeFileSync(join(dist, 'llms-full.txt'), `${head}\n${sections.join('\n\n---\n\n')}\n`);

        // Markdown twins of the pages (the same converter), for agents that prefer Markdown.
        const mdPaths = [];
        for (const path of [...MARKDOWN_PAGES, ...guides]) {
          const md = markdownPath(path);
          if (!md) continue;
          const title = /<title>([\s\S]*?)<\/title>/i.exec(read(dist, path))?.[1]?.trim() ?? '';
          const body = htmlToMarkdown(read(dist, path), origin);
          const source = `${origin}/${path}`;
          const text = body.startsWith('# ') ? body : `# ${title}\n\n${body}`;
          mkdirSync(dirname(join(dist, md)), { recursive: true });
          writeFileSync(join(dist, md), `${text}\n\n---\n\nSource: ${source}\n`);
          mdPaths.push(md);
        }

        // /.well-known/api-catalog and security.txt, and their headers.
        mkdirSync(join(dist, '.well-known'), { recursive: true });
        writeFileSync(
          join(dist, '.well-known', 'api-catalog'),
          `${JSON.stringify(apiCatalog(origin), null, 2)}\n`,
        );
        writeFileSync(join(dist, '.well-known', 'security.txt'), securityTxt(origin));
        const headersFile = join(dist, '_headers');
        writeFileSync(headersFile, readFileSync(headersFile, 'utf8') + DISCOVERY_HEADERS(mdPaths));
      },
    },
  };
}
