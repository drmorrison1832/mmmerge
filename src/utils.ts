/**
 * Utilitaires partagés. Voir architecture.md §7.
 */
import type { Config, Filter } from './config/schema.js';

/** Extrait l'identifiant de fichier Drive d'une URL Docs ou Drive (motif commun /d/<id>/...). */
export function extractDriveFileId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error(`Impossible d'extraire l'identifiant Drive depuis l'URL "${url}".`);
  }
  return match[1];
}

/** Retrouve la config d'une instance à partir de son identifiant de position (ex: "pdf[0]"). */
export function resolveInstanceByRef(
  ref: string,
  profile: Config,
): { disable?: boolean; filter?: Filter; name?: string } | undefined {
  const match = ref.match(/^(gdocs|pdf|mail)\[(\d+)\]$/);
  if (!match) return undefined;
  const [, arrayName, indexStr] = match;
  return profile[arrayName as 'gdocs' | 'pdf' | 'mail']?.[Number(indexStr)];
}
