import { describe, expect, it, vi } from 'vitest';
import type { docs_v1, drive_v3 } from 'googleapis';
import {
  resolveOutputFolderId,
  resolveTemplateTagsForDoc,
  applyTemplateTags,
  driveRole,
  resolveShareSettings,
} from './googleDocsHelpers.js';
import type { PipelineDeps } from '../deps.js';

function paragraphOf(text: string): docs_v1.Schema$StructuralElement {
  return { paragraph: { elements: [{ textRun: { content: text } }] } };
}

function tableOf(cellTexts: string[][]): docs_v1.Schema$StructuralElement {
  return {
    table: {
      tableRows: cellTexts.map((row) => ({
        tableCells: row.map((cellText) => ({ content: [paragraphOf(cellText)] })),
      })),
    },
  };
}

function createMockDocs(bodyContent: docs_v1.Schema$StructuralElement[]) {
  const get = vi.fn(async () => ({ data: { body: { content: bodyContent } } }));
  const batchUpdate = vi.fn(async () => ({ data: {} }));
  const docs = { documents: { get, batchUpdate } } as unknown as docs_v1.Docs;
  return { docs, get, batchUpdate };
}

function createMockDrive() {
  const list = vi.fn(async () => ({ data: { files: [{ id: 'existing-folder', name: 'Contrats' }] } }));
  const create = vi.fn();
  const permissionsCreate = vi.fn(async () => ({ data: {} }));
  const drive = {
    files: { list, create },
    permissions: { create: permissionsCreate },
  } as unknown as drive_v3.Drive;
  return { drive, list, create, permissionsCreate };
}

describe('resolveTemplateTagsForDoc', () => {
  it('résout les balises trouvées dans un paragraphe simple', async () => {
    const { docs, get } = createMockDocs([paragraphOf('Bonjour {{Nom}}')]);
    const tags = await resolveTemplateTagsForDoc('gdocs[0]', docs, 'doc-id', { Nom: 'Marie' }, 'd/M/yyyy');

    expect(get).toHaveBeenCalledWith({ documentId: 'doc-id' });
    expect(tags).toEqual([{ fullMatch: '{{Nom}}', value: 'Marie' }]);
  });

  it('trouve les balises imbriquées dans un tableau', async () => {
    const { docs } = createMockDocs([tableOf([['{{Ville}}', 'autre cellule']])]);
    const tags = await resolveTemplateTagsForDoc('gdocs[0]', docs, 'doc-id', { Ville: 'Lyon' }, 'd/M/yyyy');

    expect(tags).toEqual([{ fullMatch: '{{Ville}}', value: 'Lyon' }]);
  });

  it('lève une erreur si une balise est invalide, sans avoir rien copié ni modifié', async () => {
    const { docs } = createMockDocs([paragraphOf('Bonjour {{heures:boolean}}')]);

    await expect(
      resolveTemplateTagsForDoc('gdocs[0]', docs, 'doc-id', { heures: '3' }, 'd/M/yyyy'),
    ).rejects.toThrow(/type "boolean" inconnu/);
  });
});

describe('applyTemplateTags', () => {
  it('remplace les balises déjà résolues via batchUpdate', async () => {
    const { docs, batchUpdate } = createMockDocs([]);
    await applyTemplateTags(docs, 'doc-id', [{ fullMatch: '{{Nom}}', value: 'Marie' }]);

    expect(batchUpdate).toHaveBeenCalledWith({
      documentId: 'doc-id',
      requestBody: {
        requests: [
          { replaceAllText: { containsText: { text: '{{Nom}}', matchCase: true }, replaceText: 'Marie' } },
        ],
      },
    });
  });

  it("n'appelle pas batchUpdate si la liste de balises est vide", async () => {
    const { docs, batchUpdate } = createMockDocs([]);
    await applyTemplateTags(docs, 'doc-id', []);

    expect(batchUpdate).not.toHaveBeenCalled();
  });
});

describe('resolveOutputFolderId', () => {
  const baseDeps = { defaultDateFormat: 'd/M/yyyy', autoCreateFolders: true, folderCache: new Map() } as PipelineDeps;

  it('retourne output_folder_id directement sans appeler Drive', async () => {
    const { drive, list } = createMockDrive();
    const id = await resolveOutputFolderId('gdocs[0]', { ...baseDeps, drive }, { output_folder_id: 'literal-id' }, {});

    expect(id).toBe('literal-id');
    expect(list).not.toHaveBeenCalled();
  });

  it('résout output_folder via folderResolver quand output_folder_id est absent', async () => {
    const { drive } = createMockDrive();
    const id = await resolveOutputFolderId('gdocs[0]', { ...baseDeps, drive }, { output_folder: 'Contrats' }, {});

    expect(id).toBe('existing-folder');
  });
});

describe('driveRole', () => {
  it('traduit editor en writer, laisse reader/commenter inchangés', () => {
    expect(driveRole('editor')).toBe('writer');
    expect(driveRole('reader')).toBe('reader');
    expect(driveRole('commenter')).toBe('commenter');
  });
});

describe('resolveShareSettings', () => {
  it('crée une permission "anyone" pour share.link', async () => {
    const { drive, permissionsCreate } = createMockDrive();
    await resolveShareSettings('gdocs[0]', drive, 'file-id', { link: { permission: 'reader' } }, {}, 'd/M/yyyy');

    expect(permissionsCreate).toHaveBeenCalledWith({
      fileId: 'file-id',
      requestBody: { type: 'anyone', role: 'reader' },
    });
  });

  it('résout les balises des adresses email et crée une permission par adresse', async () => {
    const { drive, permissionsCreate } = createMockDrive();
    await resolveShareSettings(
      'gdocs[0]',
      drive,
      'file-id',
      { email: { addresses: ['{{Email}}', 'fixe@example.com'], permission: 'editor' } },
      { Email: 'marie@example.com' },
      'd/M/yyyy',
    );

    expect(permissionsCreate).toHaveBeenCalledTimes(2);
    expect(permissionsCreate).toHaveBeenNthCalledWith(1, {
      fileId: 'file-id',
      requestBody: { type: 'user', emailAddress: 'marie@example.com', role: 'writer' },
    });
    expect(permissionsCreate).toHaveBeenNthCalledWith(2, {
      fileId: 'file-id',
      requestBody: { type: 'user', emailAddress: 'fixe@example.com', role: 'writer' },
    });
  });
});
