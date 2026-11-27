import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Serious and critical axe violations (WCAG 2.x A/AA + best practices), one line per rule with its
 * first nodes. Furniture pieces on the plan are left out of `target-size` only: they are drawn to
 * scale, so a 1 ft stool is small at a phone's zoom (WCAG 2.5.8's "essential" exception), and each
 * has a full-size card in the Items list. Every other check covers them as usual. `skipRules`
 * leaves rules out for a scan that explains why.
 */
export async function seriousViolations(page: Page, skipRules: string[] = []): Promise<string[]> {
  const rest = await new AxeBuilder({ page })
    .withTags(TAGS)
    .disableRules(['target-size', ...skipRules])
    .analyze();
  const sized = skipRules.includes('target-size')
    ? []
    : (
        await new AxeBuilder({ page })
          .withRules(['target-size'])
          .exclude('[data-item-id]')
          .analyze()
      ).violations;
  return [...rest.violations, ...sized]
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.length} node(s)\n` +
        v.nodes
          .slice(0, 4)
          .map((n) => `   ${n.target.join(' ')}\n   ${n.failureSummary?.split('\n')[1] ?? ''}`)
          .join('\n'),
    );
}
