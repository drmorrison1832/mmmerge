/**
 * Dépendances partagées par tous les modules du pipeline (gdocs, pdf, mail),
 * construites une seule fois par l'orchestrateur pour toute l'exécution.
 */
import type { docs_v1, drive_v3, gmail_v1 } from 'googleapis';
import type { SheetsWriter } from '../sheetsWriter.js';

export type PipelineDeps = {
  docs: docs_v1.Docs;
  drive: drive_v3.Drive;
  gmail: gmail_v1.Gmail;
  sheetsWriter: SheetsWriter;
  /** Cache par exécution (pas par ligne) — voir architecture.md §7. */
  folderCache: Map<string, string>;
  defaultDateFormat: string;
  autoCreateFolders: boolean;
};
