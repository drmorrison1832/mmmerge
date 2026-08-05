import { describe, expect, it, vi } from 'vitest';
import type { docs_v1, drive_v3 } from 'googleapis';
import { runPdfInstance } from './pdf.js';
import type { PipelineDeps } from '../deps.js';
import type { PdfInstance } from '../../config/schema.js';
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

const FAKE_PDF_STREAM = Symbol('fake-pdf-stream');

function createMockDrive() {
  const copy = vi.fn(async () => ({ data: { id: 'temp-doc-id' } }));
  const exportFn = vi.fn(async () => ({ data: FAKE_PDF_STREAM }));
  const create = vi.fn(async () => ({ data: { id: 'final-pdf-id' } }));
  const del = vi.fn(async () => ({ data: {} }));
  const drive = {
    files: { copy, export: exportFn, create, delete: del },
  } as unknown as drive_v3.Drive;
  return { drive, copy, exportFn, create, del };
}

function createDeps(overrides: Partial<PipelineDeps> = {}): {
  deps: PipelineDeps;
  updateOutput: ReturnType<typeof vi.fn>;
  writeColumn: ReturnType<typeof vi.fn>;
} {
  const { docs } = createMockDocs();
  const { drive } = createMockDrive();
  const updateOutput = vi.fn(async () => {});
  const writeColumn = vi.fn(async () => {});
  const deps: PipelineDeps = {
    docs,
    drive,
    gmail: {} as PipelineDeps['gmail'],
    sheetsWriter: { updateOutput, writeColumn } as unknown as PipelineDeps['sheetsWriter'],
    folderCache: new Map(),
    profile: { sheetId: 's', sheetTabName: 't', autoCreateFolders: true, defaultDateFormat: 'd/M/yyyy', gdocs: [], pdf: [], mail: [], columns: [] },
    defaultDateFormat: 'd/M/yyyy',
    autoCreateFolders: true,
    dryRun: false,
    quiet: true,
    ...overrides,
  };
  return { deps, updateOutput, writeColumn };
}

function baseConfig(overrides: Partial<PdfInstance> = {}): PdfInstance {
  return {
    disable: false,
    template_id: 'template-id',
    output_folder_id: 'folder-id',
    output_filename: 'CDDU {{Nom}}',
    ...overrides,
  };
}

function baseContext(): RowContext {
  return { rowNumber: 5, rawData: { Nom: 'Dupont' }, outputs: {} };
}

describe('runPdfInstance', () => {
  it('copie un Doc temporaire, remplit les balises, exporte, crée le PDF final et supprime le temporaire', async () => {
    const { docs, get, batchUpdate } = createMockDocs();
    const { drive, copy, exportFn, create, del } = createMockDrive();
    const { deps, updateOutput } = createDeps({ docs, drive });
    const context = baseContext();

    await runPdfInstance('pdf[0]', baseConfig(), context, deps);

    expect(copy).toHaveBeenCalledWith({
      fileId: 'template-id',
      requestBody: { name: '[tmp] CDDU Dupont' },
    });
    expect(get).toHaveBeenCalledWith({ documentId: 'template-id' });
    expect(batchUpdate).toHaveBeenCalledOnce();

    expect(exportFn).toHaveBeenCalledWith(
      { fileId: 'temp-doc-id', mimeType: 'application/pdf' },
      { responseType: 'stream' },
    );

    expect(create).toHaveBeenCalledWith({
      requestBody: { name: 'CDDU Dupont.pdf', parents: ['folder-id'] },
      media: { mimeType: 'application/pdf', body: FAKE_PDF_STREAM },
    });

    expect(del).toHaveBeenCalledWith({ fileId: 'temp-doc-id' });

    expect(context.outputs['pdf[0]']).toEqual({
      filename: 'CDDU Dupont.pdf',
      url: 'https://drive.google.com/file/d/final-pdf-id/view',
      createdAt: expect.any(String),
    });
    expect(updateOutput).toHaveBeenCalledWith(5, 'pdf[0]', context.outputs['pdf[0]']);
  });

  it('supprime le temporaire avant l\'écriture incrémentale (ordre architecture.md §7)', async () => {
    const { drive, del } = createMockDrive();
    const { deps, updateOutput } = createDeps({ drive });

    await runPdfInstance('pdf[0]', baseConfig(), baseContext(), deps);

    const deleteOrder = del.mock.invocationCallOrder[0];
    const updateOutputOrder = updateOutput.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(updateOutputOrder);
  });

  it("ne copie pas le template si une balise du template est invalide (pas de fichier orphelin)", async () => {
    const body: docs_v1.Schema$Body = {
      content: [{ paragraph: { elements: [{ textRun: { content: 'Bonjour {{Nom:boolean}}' } }] } }],
    };
    const get = vi.fn(async () => ({ data: { body } }));
    const docs = { documents: { get, batchUpdate: vi.fn() } } as unknown as docs_v1.Docs;
    const { drive, copy } = createMockDrive();
    const { deps } = createDeps({ docs, drive });

    await expect(runPdfInstance('pdf[0]', baseConfig(), baseContext(), deps)).rejects.toThrow(
      /type "boolean" inconnu/,
    );

    expect(copy).not.toHaveBeenCalled();
  });

  it("n'appelle aucune API Google en mode dry-run, écrit une sortie synthétique", async () => {
    const { drive, copy } = createMockDrive();
    const { deps, updateOutput } = createDeps({ drive, dryRun: true });
    const context = baseContext();

    await runPdfInstance('pdf[0]', baseConfig(), context, deps);

    expect(copy).not.toHaveBeenCalled();
    expect(context.outputs['pdf[0]']).toEqual({
      filename: 'CDDU Dupont.pdf',
      url: '(dry-run)',
      createdAt: expect.any(String),
    });
    expect(updateOutput).toHaveBeenCalledWith(5, 'pdf[0]', context.outputs['pdf[0]']);
  });

  it('ajoute ".pdf" au nom de fichier final, mais pas au nom du document temporaire', async () => {
    const { drive, copy, create } = createMockDrive();
    const { deps } = createDeps({ drive });

    await runPdfInstance('pdf[0]', baseConfig(), baseContext(), deps);

    expect(copy).toHaveBeenCalledWith({
      fileId: 'template-id',
      requestBody: { name: '[tmp] CDDU Dupont' },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ name: 'CDDU Dupont.pdf' }) }),
    );
  });

  it('ne double pas l\'extension si "output_filename" se termine déjà par .pdf (insensible à la casse)', async () => {
    const { drive, create } = createMockDrive();
    const { deps } = createDeps({ drive });
    const config = baseConfig({ output_filename: 'CDDU {{Nom}}.PDF' });

    await runPdfInstance('pdf[0]', config, baseContext(), deps);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ name: 'CDDU Dupont.PDF' }) }),
    );
  });

  it("n'écrit dans aucune colonne quand link_column est absent (défaut)", async () => {
    const { deps, writeColumn } = createDeps();

    await runPdfInstance('pdf[0]', baseConfig(), baseContext(), deps);

    expect(writeColumn).not.toHaveBeenCalled();
  });

  it("écrit l'URL de sortie dans la colonne nommée par link_column", async () => {
    const { deps, writeColumn } = createDeps();

    await runPdfInstance('pdf[0]', baseConfig({ link_column: 'Lien contrat' }), baseContext(), deps);

    expect(writeColumn).toHaveBeenCalledWith(5, 'Lien contrat', 'https://drive.google.com/file/d/final-pdf-id/view');
  });

  it('écrit aussi la colonne en mode dry-run (URL synthétique)', async () => {
    const { deps, writeColumn } = createDeps({ dryRun: true });

    await runPdfInstance('pdf[0]', baseConfig({ link_column: 'Lien contrat' }), baseContext(), deps);

    expect(writeColumn).toHaveBeenCalledWith(5, 'Lien contrat', '(dry-run)');
  });
});
