import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../../scripts/llms-full.mjs';

const ORIGIN = 'https://example.com';

describe('llms-full.txt HTML -> Markdown', () => {
  it('keeps headings, paragraphs, lists, tables, emphasis and absolute links', () => {
    const html = `<html><body><header>Skip me</header><main id="main">
      <nav aria-label="Breadcrumb"><a href="/">Home</a></nav>
      <h1>Title &amp; more</h1><p>Some <strong>bold</strong>, <em>em</em> and <kbd>R</kbd>.
      See the <a href="/faq/" class="x">FAQ</a>.</p>
      <ul><li>One</li> <li>Two</li> <li>Three</li></ul>
      <table><caption>Sizes</caption><thead><tr><th scope="col">Bed</th><th>Size</th></tr></thead>
      <tbody><tr><th scope="row">Queen</th><td>60 × 80 in</td></tr></tbody></table>
      <figure><svg><text>Not this</text></svg><figcaption><h3>Plan</h3>
      <a href="/#s=abc" data-button data-open-example="x">Open<span class="sr-only"> (Plan)</span></a></figcaption></figure>
      <script>ignored()</script>
    </main><footer>Not this either</footer></body></html>`;
    expect(htmlToMarkdown(html, ORIGIN)).toBe(
      [
        '# Title & more',
        '',
        'Some **bold**, *em* and `R`. See the [FAQ](https://example.com/faq/).',
        '',
        '- One',
        '- Two',
        '- Three',
        '',
        'Sizes',
        '',
        '| Bed | Size |',
        '| --- | --- |',
        '| Queen | 60 × 80 in |',
        '',
        '### Plan',
      ].join('\n'),
    );
  });
});
