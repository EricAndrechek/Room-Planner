import { describe, expect, it } from 'vitest';
import { defaultLayout } from './layout';
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
  updateProjectData,
} from './projects';

const now = new Date('2026-03-04T05:06:07.000Z');

describe('projects', () => {
  it('ids keep the original project-<ms>-<9 chars> shape', () => {
    expect(generateProjectId(123, () => 0.5)).toMatch(/^project-123-[0-9a-z]{1,9}$/);
  });

  it('create / update / rename / duplicate / delete', () => {
    const a = createProject('A', defaultLayout(), now);
    expect(a).toMatchObject({ name: 'A', createdAt: now.toISOString(), updatedAt: now.toISOString() });

    const later = new Date('2026-03-05T00:00:00.000Z');
    const data = { ...defaultLayout(), roomDims: { width: 20, height: 10 } };
    const updated = updateProjectData([a], a.id, data, later);
    expect(updated[0]).toMatchObject({ data, updatedAt: later.toISOString(), createdAt: a.createdAt });

    expect(renameProject(updated, a.id, 'Kitchen 🍳', later)[0]!.name).toBe('Kitchen 🍳');

    const copy = duplicateProject(updated[0]!, later);
    expect(copy.name).toBe('A (Copy)');
    expect(copy.id).not.toBe(a.id);
    expect(copy.data).toEqual(data);
    expect(copy.data).not.toBe(data);

    expect(deleteProjects([a, copy], [a.id])).toEqual([copy]);
  });

  it('finds an identical layout regardless of stored mode/units', () => {
    const p = createProject('A', { ...defaultLayout(), designMode: 'furniture', unitSystem: 'm' }, now);
    expect(findDuplicateProject([p], defaultLayout())?.id).toBe(p.id);
    expect(
      findDuplicateProject([p], { ...defaultLayout(), roomDims: { width: 1, height: 1 } }),
    ).toBeUndefined();
  });

  it('export file + name', () => {
    const p = createProject('My Room #1', defaultLayout(), now);
    expect(buildExportFile([p], now)).toEqual({ version: 1, exportedAt: now.toISOString(), projects: [p] });
    expect(exportFileName([p], now)).toBe('My_Room__1.json');
    expect(exportFileName([p, p], now)).toBe('floor_plans_export_2026-03-04.json');
  });

  it('imports an export file with fresh ids', () => {
    const p = createProject('Den', defaultLayout(), now);
    const text = JSON.stringify(buildExportFile([p], now));
    const imported = parseProjectsImport(text, 0, new Date('2026-04-01T00:00:00.000Z'));
    expect(imported).toHaveLength(1);
    expect(imported[0]!.id).not.toBe(p.id);
    expect(imported[0]).toMatchObject({ name: 'Den', createdAt: p.createdAt, updatedAt: '2026-04-01T00:00:00.000Z' });
    expect(imported[0]!.data).toEqual(p.data);
  });

  it('imports a bare layout config as one plan', () => {
    const imported = parseProjectsImport(JSON.stringify(defaultLayout()), 2, now);
    expect(imported[0]!.name).toBe('Imported Plan 3');
    expect(imported[0]!.data).toEqual(defaultLayout());
  });

  it('rejects unrecognizable input', () => {
    expect(() => parseProjectsImport('nope', 0)).toThrow();
    expect(() => parseProjectsImport('{"hello":1}', 0)).toThrow();
    expect(() => parseProjectsImport('null', 0)).toThrow();
  });
});
