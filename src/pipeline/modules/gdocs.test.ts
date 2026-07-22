import { describe, expect, it, vi } from 'vitest';
import type { docs_v1, drive_v3 } from 'googleapis';
import { runGdocsInstance } from './gdocs.js';
import type { PipelineDeps } from '../deps.js';
import type { GdocsInstance } from '../../config/schema.js';
import type { RowContext } from '../rowContext.js';

function createMockDocs() {
  const body: docs_v1.Schema$Body = {
    content: [{ paragraph: { elements: [{ textRun: { content: 'Bonjour {{Nom}}' } }] } }],
  };
  const get = vi.fn(async () => ({ data: { body } }));
  const batchUpdate = vi.fn(async () => ({ data: {} }));
  const docs = { documents: { get, batchUpdate } } as unknown as docs_v1.Docs;
  return { docs, get, batchUpdate };
}

function createMockDrive() {
  const copy = vi.fn(async () => ({ data: { id: 'new-doc-id' } }));
  const permissionsCreate = vi.fn(async () => ({ data: {} }));
  const drive = { files: { copy }, permissions: { create: permissionsCreate } } as unknown as drive_v3.Drive;
  return { drive, copy, permissionsCreate };
}

function createDeps(overrides: Partial<PipelineDeps> = {}): { deps: PipelineDeps; updateOutput: ReturnType<typeof vi.fn> } {
  const { docs } = createMockDocs();
  const { drive } = createMockDrive();
  const updateOutput = vi.fn(async () => {});
  const deps = {
    docs,
    drive,
    gmail: {} as PipelineDeps['gmail'],
    sheetsWriter: { updateOutput } as unknown as PipelineDeps['sheetsWriter'],
    folderCache: new Map(),
    defaultDateFormat: 'd/M/yyyy',
    autoCreateFolders: true,
    dryRun: false,
    verbose: false,
    ...overrides,
  };
  return { deps, updateOutput };
}

function baseConfig(overrides: Partial<GdocsInstance> = {}): GdocsInstance {
  return {
    template_id: 'template-id',
    output_folder_id: 'folder-id',
    output_filename: 'CDDU {{Nom}}',
    ...overrides,
  };
}

function baseContext(): RowContext {
  return { rowNumber: 5, rawData: { Nom: 'Dupont' }, outputs: {} };
}

describe('runGdocsInstance', () => {
  it('copie le template, remplit les balises, écrit outputs et appelle updateOutput', async () => {
    const { docs, get, batchUpdate } = createMockDocs();
    const { drive, copy } = createMockDrive();
    const { deps, updateOutput } = createDeps({ docs, drive });
    const context = baseContext();

    await runGdocsInstance('gdocs[0]', baseConfig(), context, deps);

    expect(copy).toHaveBeenCalledWith({
      fileId: 'template-id',
      requestBody: { name: 'CDDU Dupont', parents: ['folder-id'] },
    });
    expect(get).toHaveBeenCalledWith({ documentId: 'new-doc-id' });
    expect(batchUpdate).toHaveBeenCalledOnce();

    expect(context.outputs['gdocs[0]']).toEqual({
      filename: 'CDDU Dupont',
      url: 'https://docs.google.com/document/d/new-doc-id/edit',
      createdAt: expect.any(String),
    });
    expect(updateOutput).toHaveBeenCalledWith(5, 'gdocs[0]', context.outputs['gdocs[0]']);
  });

  it('appelle resolveShareSettings quand share est configuré, après updateOutput', async () => {
    const { drive, permissionsCreate } = createMockDrive();
    const { deps, updateOutput } = createDeps({ drive });
    const context = baseContext();

    await runGdocsInstance(
      'gdocs[0]',
      baseConfig({ share: { link: { permission: 'reader' } } }),
      context,
      deps,
    );

    expect(permissionsCreate).toHaveBeenCalledWith({
      fileId: 'new-doc-id',
      requestBody: { type: 'anyone', role: 'reader' },
    });

    const updateOutputOrder = updateOutput.mock.invocationCallOrder[0];
    const shareOrder = permissionsCreate.mock.invocationCallOrder[0];
    expect(updateOutputOrder).toBeLessThan(shareOrder);
  });

  it("n'appelle pas resolveShareSettings quand share est absent", async () => {
    const { drive, permissionsCreate } = createMockDrive();
    const { deps } = createDeps({ drive });

    await runGdocsInstance('gdocs[0]', baseConfig(), baseContext(), deps);

    expect(permissionsCreate).not.toHaveBeenCalled();
  });

  it("n'appelle aucune API Google en mode dry-run, écrit une sortie synthétique", async () => {
    const { drive, copy } = createMockDrive();
    const { deps, updateOutput } = createDeps({ drive, dryRun: true });
    const context = baseContext();

    await runGdocsInstance('gdocs[0]', baseConfig(), context, deps);

    expect(copy).not.toHaveBeenCalled();
    expect(context.outputs['gdocs[0]']).toEqual({
      filename: 'CDDU Dupont',
      url: '(dry-run)',
      createdAt: expect.any(String),
    });
    expect(updateOutput).toHaveBeenCalledWith(5, 'gdocs[0]', context.outputs['gdocs[0]']);
  });
});
