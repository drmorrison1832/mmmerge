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

function createDeps(overrides: Partial<PipelineDeps> = {}): { deps: PipelineDeps; updateOutput: ReturnType<typeof vi.fn> } {
  const { docs } = createMockDocs();
  const { drive } = createMockDrive();
  const updateOutput = vi.fn(async () => {});
  const deps: PipelineDeps = {
    docs,
    drive,
    gmail: {} as PipelineDeps['gmail'],
    sheetsWriter: { updateOutput } as unknown as PipelineDeps['sheetsWriter'],
    folderCache: new Map(),
    defaultDateFormat: 'd/M/yyyy',
    autoCreateFolders: true,
    ...overrides,
  };
  return { deps, updateOutput };
}

function baseConfig(overrides: Partial<PdfInstance> = {}): PdfInstance {
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
    expect(get).toHaveBeenCalledWith({ documentId: 'temp-doc-id' });
    expect(batchUpdate).toHaveBeenCalledOnce();

    expect(exportFn).toHaveBeenCalledWith(
      { fileId: 'temp-doc-id', mimeType: 'application/pdf' },
      { responseType: 'stream' },
    );

    expect(create).toHaveBeenCalledWith({
      requestBody: { name: 'CDDU Dupont', parents: ['folder-id'] },
      media: { mimeType: 'application/pdf', body: FAKE_PDF_STREAM },
    });

    expect(del).toHaveBeenCalledWith({ fileId: 'temp-doc-id' });

    expect(context.outputs['pdf[0]']).toEqual({
      filename: 'CDDU Dupont',
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
});
