/**
 * Build-time rendering of the guide examples: the plan drawing (the same scene the planner's
 * PNG/PDF export draws) and the share link that opens the example in the planner.
 */
import { toShareConfig } from '../../core/layout';
import { encodeShareFragment } from '../../core/share/link';
import { buildPlanScene, DEFAULT_SITE, type Scene, type SceneNode } from '../../core/render/scene';
import { sceneToSvg } from '../../core/render/svg';
import type { Example } from './examples';

/** The example's plan scene, with the site name (no export date) in the footer. */
export const exampleScene = (example: Example): Scene => {
  const scene = buildPlanScene({
    layout: example.layout,
    unitSystem: example.unitSystem,
    title: example.name,
  });
  const undated = (node: SceneNode): SceneNode =>
    node.kind === 'group' && node.role === 'footer'
      ? {
          ...node,
          children: node.children.map((c) =>
            c.kind === 'text' && c.anchor === 'end' ? { ...c, text: DEFAULT_SITE } : c,
          ),
        }
      : node;
  return { ...scene, nodes: scene.nodes.map(undated) };
};

/** The plan as an inline SVG that scales to its container (viewBox only, no fixed size). */
export const exampleSvg = (example: Example): string =>
  sceneToSvg(exampleScene(example)).replace(
    /^<svg([^>]*?) width="[\d.]+" height="[\d.]+"/,
    '<svg$1',
  );

/** `s=...`: the share-link fragment that opens this example as a new plan. */
export const exampleShareFragment = (example: Example): Promise<string> =>
  encodeShareFragment(toShareConfig(example.layout, example.name, example.unitSystem), {
    compress: true,
  });
