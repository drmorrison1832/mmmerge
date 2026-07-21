import { describe, expect, it, vi } from 'vitest';
import { resolveFolderPath } from './folderResolver.js';

type MockFolder = { id: string; name: string; parentId: string };

/** Client Drive simulé en mémoire : arborescence de dossiers { id, name, parentId }. */
function createMockDrive(initialFolders: MockFolder[] = []) {
  const folders = [...initialFolders];
  let nextId = 1;

  const list = vi.fn(async ({ q }: { q: string }) => {
    const match = q.match(/name = '(.*)' and '(.*)' in parents/);
    if (!match) throw new Error(`Requête Drive inattendue dans le test : ${q}`);
    const [, escapedName, parentId] = match;
    const name = escapedName.replace(/\\'/g, "'");
    const found = folders.filter((f) => f.name === name && f.parentId === parentId);
    return { data: { files: found.map((f) => ({ id: f.id, name: f.name })) } };
  });

  const create = vi.fn(async ({ requestBody }: { requestBody: { name: string; parents: string[] } }) => {
    const id = `new-${nextId++}`;
    folders.push({ id, name: requestBody.name, parentId: requestBody.parents[0] });
    return { data: { id } };
  });

  const drive = { files: { list, create } } as unknown as import('googleapis').drive_v3.Drive;
  return { drive, folders, list, create };
}

describe('resolveFolderPath', () => {
  it('descend une arborescence existante et retourne l\'ID du dernier segment', async () => {
    const { drive } = createMockDrive([
      { id: 'contrats-id', name: 'Contrats', parentId: 'root' },
      { id: 'annee-id', name: '2026', parentId: 'contrats-id' },
    ]);

    const result = await resolveFolderPath('gdocs[0]', drive, 'Contrats/2026', {}, 'd/M/yyyy', true, new Map());
    expect(result).toBe('annee-id');
  });

  it('résout les balises du chemin via renderTemplateString', async () => {
    const { drive } = createMockDrive([{ id: 'contrats-id', name: 'Contrats', parentId: 'root' }]);

    const result = await resolveFolderPath(
      'gdocs[0]',
      drive,
      'Contrats/{{Annee}}',
      { Annee: '2026' },
      'd/M/yyyy',
      true,
      new Map(),
    );

    expect(result).toBe('new-1'); // "2026" créé automatiquement sous Contrats
  });

  it('crée automatiquement un segment manquant si autoCreate=true', async () => {
    const { drive, create } = createMockDrive([]);
    const result = await resolveFolderPath('gdocs[0]', drive, 'Nouveau', {}, 'd/M/yyyy', true, new Map());

    expect(result).toBe('new-1');
    expect(create).toHaveBeenCalledOnce();
  });

  it('lève une erreur si un segment est introuvable et autoCreate=false', async () => {
    const { drive } = createMockDrive([]);
    await expect(resolveFolderPath('gdocs[0]', drive, 'Absent', {}, 'd/M/yyyy', false, new Map())).rejects.toThrow(
      /introuvable/,
    );
  });

  it('lève une erreur si plusieurs dossiers identiques existent (ambiguïté)', async () => {
    const { drive } = createMockDrive([
      { id: 'a', name: 'Doublon', parentId: 'root' },
      { id: 'b', name: 'Doublon', parentId: 'root' },
    ]);
    await expect(resolveFolderPath('gdocs[0]', drive, 'Doublon', {}, 'd/M/yyyy', true, new Map())).rejects.toThrow(
      /ambigu/,
    );
  });

  it('met en cache le résultat pour un même chemin résolu (pas de second appel Drive)', async () => {
    const { drive, list, create } = createMockDrive([{ id: 'contrats-id', name: 'Contrats', parentId: 'root' }]);
    const cache = new Map<string, string>();

    await resolveFolderPath('gdocs[0]', drive, 'Contrats', {}, 'd/M/yyyy', true, cache);
    list.mockClear();
    create.mockClear();
    const second = await resolveFolderPath('gdocs[0]', drive, 'Contrats', {}, 'd/M/yyyy', true, cache);

    expect(second).toBe('contrats-id');
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('lève une erreur si le chemin résolu est une chaîne vide', async () => {
    const { drive } = createMockDrive([]);
    await expect(resolveFolderPath('gdocs[0]', drive, '  ', {}, 'd/M/yyyy', true, new Map())).rejects.toThrow(
      /vide/,
    );
  });
});
