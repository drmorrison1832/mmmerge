/**
 * Utilitaires partagés. Voir architecture.md §7.
 */

/** Extrait l'identifiant de fichier Drive d'une URL Docs ou Drive (motif commun /d/<id>/...). */
export function extractDriveFileId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error(`Impossible d'extraire l'identifiant Drive depuis l'URL "${url}".`);
  }
  return match[1];
}
