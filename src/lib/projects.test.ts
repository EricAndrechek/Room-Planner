import { describe, expect, it } from 'vitest';
import { changePiece, resizeRoom } from './edits';
import { samePlan, starterPlan, withDoc } from './plans';
import {
  buildExportFile,
  createProject,
  deleteProjects,
  duplicateProject,
  exportFileName,
  findDuplicateProject,
  generateProjectId,
  parseProjectsImport,
  renameProject,
  updateProjectPlan,
} from './projects';
import { defaultLayout } from '../core/testing/v3/layout';

const now = new Date('2026-03-04T05:06:07.000Z');

describe('projects', () => {
  it('ids keep the original project-<ms>-<9 chars> shape', () => {
    expect(generateProjectId(123, () => 0.5)).toMatch(/^project-123-[0-9a-z]{1,9}$/);
  });

  it('create / update / rename / duplicate / delete', () => {
    const a = createProject('A', starterPlan(), now, 'furniture');
    expect(a).toMatchObject({
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ui: { designMode: 'furniture' },
    });
    expect(a.plan.name).toBe('A');

    const later = new Date('2026-03-05T00:00:00.000Z');
    const plan = resizeRoom(starterPlan(), { width: 20, height: 10 });
    const updated = updateProjectPlan([a], a.id, plan, 'room-setup', later);
    // The plan is replaced, its name stays the project's.
    expect(updated[0]).toMatchObject({
      plan: { ...plan, name: 'A' },
      ui: { designMode: 'room-setup' },
      updatedAt: later.toISOString(),
      createdAt: a.createdAt,
    });

    expect(renameProject(updated, a.id, 'Kitchen 🍳', later)[0]!.plan.name).toBe('Kitchen 🍳');

    const copy = duplicateProject(updated[0]!, later);
    expect(copy.plan.name).toBe('A (Copy)');
    expect(copy.id).not.toBe(a.id);
    expect(samePlan(copy.plan, plan)).toBe(true);
    expect(copy.plan).not.toBe(updated[0]!.plan);

    expect(deleteProjects([a, copy], [a.id])).toEqual([copy]);
  });

  it('finds the same plan regardless of its name, mode and units', () => {
    const p = createProject('A', withDoc(starterPlan(), 'A', 'm'), now, 'furniture');
    expect(findDuplicateProject([p], starterPlan())?.id).toBe(p.id);
    expect(
      findDuplicateProject([p], resizeRoom(starterPlan(), { width: 1, height: 1 })),
    ).toBeUndefined();
    // Lengths count as a link rounds them (4 decimals of a foot).
    const nudged = changePiece(starterPlan(), 'item-1', { x: 3.5 + 1e-6 });
    expect(findDuplicateProject([p], nudged)?.id).toBe(p.id);
  });

  it('export file + name', () => {
    const p = createProject('My Room #1', starterPlan(), now);
    expect(buildExportFile([p], now)).toEqual({
      version: 1,
      exportedAt: now.toISOString(),
      projects: [
        {
          id: p.id,
          name: 'My Room #1',
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          ui: p.ui,
          data: p.plan,
        },
      ],
    });
    expect(buildExportFile([p], now).projects[0]!.data.version).toBe(4);
    expect(exportFileName([p], now)).toBe('My_Room__1.json');
    expect(exportFileName([p, p], now)).toBe('floor_plans_export_2026-03-04.json');
  });

  it('imports an export file with fresh ids', () => {
    const p = createProject('Den', withDoc(starterPlan(), 'Den', 'cm'), now, 'furniture');
    const text = JSON.stringify(buildExportFile([p], now));
    const imported = parseProjectsImport(text, 0, new Date('2026-04-01T00:00:00.000Z'));
    expect(imported).toHaveLength(1);
    expect(imported[0]!.id).not.toBe(p.id);
    expect(imported[0]).toMatchObject({
      createdAt: p.createdAt,
      updatedAt: '2026-04-01T00:00:00.000Z',
      ui: { designMode: 'furniture' },
    });
    expect(imported[0]!.plan).toEqual(p.plan);
  });

  it('imports a v3 export file (lengths in feet, mode and units in the data)', () => {
    const file = {
      version: 1,
      exportedAt: now.toISOString(),
      projects: [
        {
          id: 'project-1',
          name: 'Old',
          data: { ...defaultLayout(), designMode: 'furniture', unitSystem: 'cm' },
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
    };
    const [p] = parseProjectsImport(JSON.stringify(file), 0, now);
    expect(p!.plan.name).toBe('Old');
    expect(p!.ui).toEqual({ designMode: 'furniture' });
    expect(p!.plan.settings).toEqual({ unitSystem: 'cm' });
    expect(samePlan(p!.plan, starterPlan())).toBe(true);
  });

  it('imports a bare layout config as one plan', () => {
    const imported = parseProjectsImport(JSON.stringify(defaultLayout()), 2, now);
    expect(imported[0]!.plan.name).toBe('Imported Plan 3');
    expect(samePlan(imported[0]!.plan, starterPlan())).toBe(true);
  });

  it('rejects unrecognizable input', () => {
    expect(() => parseProjectsImport('nope', 0)).toThrow();
    expect(() => parseProjectsImport('{"hello":1}', 0)).toThrow();
    expect(() => parseProjectsImport('null', 0)).toThrow();
    expect(() =>
      parseProjectsImport(JSON.stringify({ version: 1, projects: [{ data: { version: 4 } }] }), 0),
    ).toThrow();
  });
});
