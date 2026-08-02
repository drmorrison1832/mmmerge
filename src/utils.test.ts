import { describe, expect, it } from 'vitest';
import { extractDriveFileId, resolveInstanceByRef } from './utils.js';
import type { Config } from './config/schema.js';

describe('extractDriveFileId', () => {
  it("extrait l'identifiant d'une URL Google Docs", () => {
    expect(extractDriveFileId('https://docs.google.com/document/d/abc123/edit')).toBe('abc123');
  });

  it("extrait l'identifiant d'une URL Google Drive (fichier)", () => {
    expect(extractDriveFileId('https://drive.google.com/file/d/def456/view')).toBe('def456');
  });

  it('lève une erreur explicite si aucun identifiant ne peut être extrait', () => {
    expect(() => extractDriveFileId('https://example.com/rien-a-voir')).toThrow(/Impossible d'extraire/);
  });
});

describe('resolveInstanceByRef', () => {
  const profile: Config = {
    sheetId: 's',
    sheetTabName: 'Feuille 1',
    autoCreateFolders: true,
    defaultDateFormat: 'd/M/yyyy',
    gdocs: [],
    pdf: [
      {
        disable: false,
        filter: { match: 'all', conditions: [{ label: 'Type', criterium: 'equals', value: 'CDD' }] },
        template_id: 't',
        output_folder_id: 'f',
        output_filename: 'n',
      },
    ],
    mail: [],
  };

  it('retrouve une instance existante par sa référence', () => {
    const instance = resolveInstanceByRef('pdf[0]', profile);
    expect(instance?.filter?.match).toBe('all');
  });

  it('retourne undefined pour un index hors bornes', () => {
    expect(resolveInstanceByRef('pdf[5]', profile)).toBeUndefined();
  });

  it('retourne undefined pour une référence mal formée', () => {
    expect(resolveInstanceByRef('pdf', profile)).toBeUndefined();
    expect(resolveInstanceByRef('inconnu[0]', profile)).toBeUndefined();
  });
});
