/**
 * Test reference, frozen: how the v3 app read a plans file (lib/projects.ts before the app held
 * plans).
 */
import { normalizeLayout } from './layout';
import type { Project } from './storage';

type ProjectData = Project['data'];

const generateProjectId = (now: number = Date.now(), random: () => number = Math.random): string =>
  `project-${now}-${random().toString(36).substring(2, 11)}`;

/**
 * Parse an exported projects file (or a bare single-layout config) into new
 * projects with fresh ids. Throws on anything unrecognizable, and a `NewerPlanError` for a plan
 * made by a newer Room Planner.
 */
export const parseProjectsImport = (
  text: string,
  existingCount: number,
  now: Date = new Date(),
): Project[] => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid format');
  const obj = parsed as Record<string, unknown>;
  const iso = now.toISOString();

  let incoming: Partial<Project>[];
  if (Array.isArray(obj.projects)) {
    incoming = obj.projects.filter(
      (p): p is Partial<Project> => typeof p === 'object' && p !== null,
    );
  } else if (obj.roomDims && obj.items) {
    incoming = [
      {
        name: `Imported Plan ${existingCount + 1}`,
        data: parsed as ProjectData,
        createdAt: iso,
      },
    ];
  } else {
    throw new Error('Invalid format');
  }

  return incoming.map((p, i) => ({
    ...p,
    id: generateProjectId(now.getTime() + i),
    name: p.name || 'Imported Plan',
    data: { ...(p.data ?? {}), ...normalizeLayout(p.data) } as ProjectData,
    createdAt: p.createdAt || iso,
    updatedAt: iso,
  }));
};
