import { describe, expect, it, vi } from 'vitest';
import { runColumnsInstance } from './columns.js';
import type { PipelineDeps } from '../deps.js';
import type { ColumnsInstance } from '../../config/schema.js';
import type { RowContext } from '../rowContext.js';

function createDeps(overrides: Partial<PipelineDeps> = {}): { deps: PipelineDeps; writeColumn: ReturnType<typeof vi.fn> } {
  const writeColumn = vi.fn(async () => {});
  const deps: PipelineDeps = {
    docs: {} as PipelineDeps['docs'],
    drive: {} as PipelineDeps['drive'],
    gmail: {} as PipelineDeps['gmail'],
    sheetsWriter: { writeColumn } as unknown as PipelineDeps['sheetsWriter'],
    folderCache: new Map(),
    profile: { sheetId: 's', sheetTabName: 't', autoCreateFolders: true, defaultDateFormat: 'd/M/yyyy', gdocs: [], pdf: [], mail: [], columns: [] },
    defaultDateFormat: 'd/M/yyyy',
    autoCreateFolders: true,
    dryRun: false,
    quiet: true,
    ...overrides,
  };
  return { deps, writeColumn };
}

function baseConfig(overrides: Partial<ColumnsInstance> = {}): ColumnsInstance {
  return {
    disable: false,
    template: '{{Prenom}} {{Nom}}',
    output_column: 'NomComplet',
    ...overrides,
  };
}

function baseContext(): RowContext {
  return { rowNumber: 5, rawData: { Prenom: 'Marie', Nom: 'Dupont' }, outputs: {} };
}

describe('runColumnsInstance', () => {
  it('résout le template et l\'écrit dans la colonne configurée', async () => {
    const { deps, writeColumn } = createDeps();
    const context = baseContext();

    await runColumnsInstance('columns[0]', baseConfig(), context, deps);

    expect(writeColumn).toHaveBeenCalledWith(5, 'NomComplet', 'Marie Dupont');
  });

  it('rend la valeur immédiatement disponible via rawData pour les instances suivantes de la même ligne', async () => {
    const { deps } = createDeps();
    const context = baseContext();

    await runColumnsInstance('columns[0]', baseConfig(), context, deps);

    expect(context.rawData.NomComplet).toBe('Marie Dupont');
  });

  it('propage une erreur de balise (colonne source absente) sans écrire', async () => {
    const { deps, writeColumn } = createDeps();
    const context = baseContext();

    await expect(
      runColumnsInstance('columns[0]', baseConfig({ template: '{{Inconnue}}' }), context, deps),
    ).rejects.toThrow(/colonne "Inconnue" absente/);
    expect(writeColumn).not.toHaveBeenCalled();
  });
});
