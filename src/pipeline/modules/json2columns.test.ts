import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runJson2ColumnsInstance } from './json2columns.js';
import type { PipelineDeps } from '../deps.js';
import type { Json2ColumnsInstance } from '../../config/schema.js';
import type { RowContext } from '../rowContext.js';

let tmpFiles: string[] = [];
afterEach(() => {
  for (const dir of tmpFiles) rmSync(dir, { recursive: true, force: true });
  tmpFiles = [];
});

function writeJsonFixture(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mmmerge-json2columns-test-'));
  tmpFiles.push(dir);
  const path = join(dir, 'data.json');
  writeFileSync(path, JSON.stringify(content), 'utf-8');
  return path;
}

function createDeps(overrides: Partial<PipelineDeps> = {}): {
  deps: PipelineDeps;
  hasColumn: ReturnType<typeof vi.fn>;
  writeColumns: ReturnType<typeof vi.fn>;
} {
  const hasColumn = vi.fn(() => true);
  const writeColumns = vi.fn(async () => {});
  const deps: PipelineDeps = {
    docs: {} as PipelineDeps['docs'],
    drive: {} as PipelineDeps['drive'],
    gmail: {} as PipelineDeps['gmail'],
    sheetsWriter: { hasColumn, writeColumns } as unknown as PipelineDeps['sheetsWriter'],
    folderCache: new Map(),
    profile: { sheetId: 's', sheetTabName: 't', autoCreateFolders: true, defaultDateFormat: 'd/M/yyyy', gdocs: [], pdf: [], mail: [], columns: [], json2columns: [] },
    defaultDateFormat: 'd/M/yyyy',
    autoCreateFolders: true,
    dryRun: false,
    quiet: true,
    ...overrides,
  };
  return { deps, hasColumn, writeColumns };
}

function baseConfig(overrides: Partial<Json2ColumnsInstance> = {}): Json2ColumnsInstance {
  return {
    disable: false,
    file: writeJsonFixture({ 'Dupont-1': { Statut: 'Actif', Type: 'CDD' } }),
    key_column: 'Matricule',
    ...overrides,
  };
}

function baseContext(): RowContext {
  return { rowNumber: 5, rawData: { Matricule: 'Dupont-1' }, outputs: {} };
}

describe('runJson2ColumnsInstance', () => {
  it('trouve la clé, écrit les colonnes et les rend disponibles via rawData', async () => {
    const { deps, writeColumns } = createDeps();
    const context = baseContext();

    const enriched = await runJson2ColumnsInstance('json2columns[0]', baseConfig(), context, deps);

    expect(enriched).toBe(true);
    expect(writeColumns).toHaveBeenCalledWith(5, { Statut: 'Actif', Type: 'CDD' });
    expect(context.rawData.Statut).toBe('Actif');
    expect(context.rawData.Type).toBe('CDD');
  });

  it('convertit les valeurs non-chaînes en chaînes (nombre, booléen)', async () => {
    const { deps, writeColumns } = createDeps();
    const config = baseConfig({ file: writeJsonFixture({ 'Dupont-1': { Anciennete: 5, Actif: true } }) });

    await runJson2ColumnsInstance('json2columns[0]', config, baseContext(), deps);

    expect(writeColumns).toHaveBeenCalledWith(5, { Anciennete: '5', Actif: 'true' });
  });

  it("ignore la ligne (avec un avertissement) si la clé n'est pas trouvée dans le fichier", async () => {
    const { deps, writeColumns } = createDeps();
    const config = baseConfig({ file: writeJsonFixture({ 'Autre-Cle': {} }) });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const enriched = await runJson2ColumnsInstance('json2columns[0]', config, baseContext(), deps);

    expect(enriched).toBe(false);
    expect(writeColumns).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('introuvable dans'));
    warnSpy.mockRestore();
  });

  it('lève une erreur si la colonne clé est absente du tableau', async () => {
    const { deps } = createDeps();
    const config = baseConfig({ key_column: 'Inconnue' });

    await expect(runJson2ColumnsInstance('json2columns[0]', config, baseContext(), deps)).rejects.toThrow(
      /Colonne clé "Inconnue" absente/,
    );
  });

  it("lève une erreur listant toutes les colonnes cibles introuvables dans le Sheet", async () => {
    const { deps, hasColumn } = createDeps();
    hasColumn.mockImplementation((column: string) => column !== 'Statut' && column !== 'Type');
    const config = baseConfig();

    await expect(runJson2ColumnsInstance('json2columns[0]', config, baseContext(), deps)).rejects.toThrow(
      /Statut, Type/,
    );
  });

  it("n'écrit rien si au moins une colonne cible est introuvable (tout ou rien)", async () => {
    const { deps, hasColumn, writeColumns } = createDeps();
    hasColumn.mockImplementation((column: string) => column !== 'Type');

    await expect(runJson2ColumnsInstance('json2columns[0]', baseConfig(), baseContext(), deps)).rejects.toThrow();
    expect(writeColumns).not.toHaveBeenCalled();
  });

  it('lève une erreur explicite si le fichier est introuvable', async () => {
    const { deps } = createDeps();
    const config = baseConfig({ file: '/does/not/exist.json' });

    await expect(runJson2ColumnsInstance('json2columns[0]', config, baseContext(), deps)).rejects.toThrow(
      /introuvable ou illisible/,
    );
  });

  it('relit le fichier à chaque appel (pas de cache)', async () => {
    const { deps, writeColumns } = createDeps();
    const path = writeJsonFixture({ 'Dupont-1': { Statut: 'Actif' } });
    const config = baseConfig({ file: path });

    await runJson2ColumnsInstance('json2columns[0]', config, baseContext(), deps);
    writeFileSync(path, JSON.stringify({ 'Dupont-1': { Statut: 'Inactif' } }), 'utf-8');
    await runJson2ColumnsInstance('json2columns[0]', config, baseContext(), deps);

    expect(writeColumns).toHaveBeenNthCalledWith(1, 5, { Statut: 'Actif' });
    expect(writeColumns).toHaveBeenNthCalledWith(2, 5, { Statut: 'Inactif' });
  });
});
