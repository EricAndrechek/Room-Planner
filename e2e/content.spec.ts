import { expect, test, type Page } from '@playwright/test';
import { storedPieces } from './storage';

// The static content pages (guides, FAQ, help): metadata, structured data, internal links, and the
// guides' "Open this layout in the planner" share links.

const GUIDES = [
  '/guides/bedroom-layout/',
  '/guides/living-room-layout/',
  '/guides/studio-and-dorm-layout/',
  '/guides/home-office-layout/',
];
const CONTENT_PAGES = ['/guides/', ...GUIDES, '/faq/', '/help/'];

type Node = Record<string, unknown> & { '@type': string };

/** Every JSON-LD block on the page parsed (throws on invalid JSON), flattened to its nodes. */
async function jsonLdNodes(page: Page): Promise<Node[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((b) => {
    const data = JSON.parse(b);
    expect(data['@context']).toBe('https://schema.org');
    return (data['@graph'] ?? [data]) as Node[];
  });
}

/** Text of an HTML fragment as the browser shows it. */
const htmlText = (page: Page, html: string) =>
  page.evaluate((h) => {
    const div = document.createElement('div');
    div.innerHTML = h;
    return div.textContent ?? '';
  }, html);

for (const path of CONTENT_PAGES) {
  test(`${path}: title, description, canonical, one h1, social card and valid JSON-LD`, async ({
    page,
    request,
  }) => {
    const res = await page.goto(path);
    expect(res!.status()).toBe(200);
    await expect(page).toHaveTitle(/Room Planner/);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description!.length).toBeGreaterThan(70);
    expect(description!.length).toBeLessThanOrEqual(200);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`${path.replace(/\//g, '\\/')}$`),
    );
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    // The social card exists (fetched from this server, whatever origin the meta tag names).
    const og = new URL((await page.locator('meta[property="og:image"]').getAttribute('content'))!);
    const img = await request.get(og.pathname);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/png');

    const nodes = await jsonLdNodes(page);
    const types = nodes.map((n) => n['@type']);
    expect(types).toContain('WebSite');
    const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList')!;
    {
      const items = crumbs.itemListElement as { position: number; name: string; item: string }[];
      expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i + 1));
      expect(new URL(items.at(-1)!.item).pathname).toBe(path);
      // The visible trail matches.
      const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect(trail.getByRole('listitem')).toHaveText(
        items.map((i, n) => (n === 0 ? i.name : new RegExp(i.name.replace(/[&]/g, '.')))),
      );
    }
    if (GUIDES.includes(path)) {
      const article = nodes.find((n) => n['@type'] === 'Article')!;
      expect(article.headline).toBe(await page.locator('h1').textContent());
      expect(new URL(article.image as string).pathname).toBe(og.pathname);
    }
  });
}

test('every internal link on the content pages resolves', async ({ page, request }) => {
  const seen = new Set<string>();
  for (const path of CONTENT_PAGES) {
    await page.goto(path);
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
    for (const href of hrefs) seen.add(href.split('#')[0]);
  }
  expect(seen).toContain('/faq/');
  for (const href of seen) {
    expect((await request.get(href)).status(), href).toBe(200);
  }
});

test('FAQ: FAQPage JSON-LD matches the visible questions and answers exactly', async ({ page }) => {
  await page.goto('/faq/');
  const faq = (await jsonLdNodes(page)).find((n) => n['@type'] === 'FAQPage')!;
  const entities = faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
  const sections = page.locator('[data-faq]');
  await expect(sections).toHaveCount(entities.length);
  expect(entities.length).toBeGreaterThanOrEqual(8);
  for (const [i, q] of entities.entries()) {
    await expect(sections.nth(i).getByRole('heading')).toHaveText(q.name);
    expect(await sections.nth(i).locator('p').textContent()).toBe(
      await htmlText(page, q.acceptedAnswer.text),
    );
  }
});

test('home page: WebApplication JSON-LD lists the features shown in the static text', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  const app = (await jsonLdNodes(page)).find((n) => n['@type'] === 'WebApplication')!;
  expect(app).toMatchObject({
    isAccessibleForFree: true,
    offers: { price: '0' },
    applicationCategory: 'DesignApplication',
  });
  const features = app.featureList as string[];
  expect(features.length).toBeGreaterThan(5);
  for (const f of features) await expect(page.getByText(f, { exact: true })).toBeVisible();
  for (const name of ['Room layout guides', 'FAQ'])
    await expect(page.getByRole('link', { name })).toBeVisible();
  await context.close();
});

test('guide example: the drawing is inline, and "Open this layout" opens it as a new plan', async ({
  page,
}) => {
  await page.goto('/guides/bedroom-layout/');
  const figure = page.locator('figure[data-example="queen-bedroom-10x12"]');
  await expect(figure.locator('svg[role="img"]')).toHaveAttribute(
    'aria-label',
    'Floor plan: Queen bed in a 10 × 12 ft bedroom',
  );
  const link = figure.getByRole('link', { name: /^Open this layout in the planner/ });
  await expect(link).toHaveAttribute('href', /^\/#s=[A-Za-z0-9_-]+$/);

  await link.click();
  await page.waitForSelector('html[data-planner-ready]');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Queen bed in a 10 × 12 ft bedroom' }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  const items = await storedPieces(page);
  expect(items.map((i: { label: string }) => i.label)).toEqual([
    'Queen bed',
    'Nightstand',
    'Nightstand',
    'Dresser',
  ]);
  // No warnings on an example (the unit tests check the geometry; this checks the real app agrees).
  await expect(page.getByText(/Overlapping|Outside room|Blocks door/)).toHaveCount(0);
});

test('llms.txt, llms-full.txt and the sitemap list the new pages', async ({ request }) => {
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toMatch(/^# Room Planner\n\n> /);
  for (const path of [...GUIDES, '/faq/', '/help/']) expect(llms).toContain(`${path})`);

  const full = await (await request.get('/llms-full.txt')).text();
  expect(full).toContain('# Frequently asked questions');
  expect(full).toContain('| Queen | 60 × 80 in (152 × 203 cm) |');
  expect(full).not.toMatch(/<[a-z]/i); // no HTML left (the page markers are <!-- comments -->)
  expect(full).not.toContain('#s=');

  const sitemap = await (await request.get('/sitemap-0.xml')).text();
  for (const path of ['/', ...CONTENT_PAGES]) {
    expect(sitemap).toMatch(
      new RegExp(`<loc>[^<]*${path.replace(/\//g, '\\/')}</loc><lastmod>\\d{4}-\\d\\d-\\d\\dT`),
    );
  }
});
