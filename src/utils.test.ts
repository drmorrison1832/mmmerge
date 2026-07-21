import { describe, expect, it } from 'vitest';
import { extractDriveFileId } from './utils.js';

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
