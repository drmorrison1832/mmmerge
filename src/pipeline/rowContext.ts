/**
 * Structures de données en mémoire faisant transiter les résultats d'une ligne
 * à travers les modules du pipeline. Voir architecture.md §4.
 */

/** Sortie d'une instance gDocs ou PDF. `createdAt` est en ISO 8601. */
export type FileOutput = {
  filename: string;
  url: string;
  createdAt: string;
};

/**
 * Sortie d'une instance Mail. `createdAt` est en ISO 8601.
 * `draftOnly` distingue un brouillon (`url` = lien de composition, potentiellement
 * fragile — voir architecture.md §3) d'un mail réellement envoyé (`url` stable).
 */
export type MailOutput = {
  to: string;
  subject: string;
  url: string;
  draftOnly: boolean;
  attachments: string[];
  createdAt: string;
};

/** État d'une ligne en cours de traitement, muté séquentiellement par chaque module. */
export type RowContext = {
  rowNumber: number;
  rawData: Record<string, string>;
  /** Clé = identifiant technique d'instance ('gdocs[0]', 'pdf[1]', 'mail[0]', ...). */
  outputs: Record<string, FileOutput | MailOutput>;
  error?: { module: string; message: string };
};

/** Erreur métier levée par un module, portant l'identifiant de l'instance en cause. */
export class ModuleError extends Error {
  constructor(
    public readonly module: string,
    message: string,
  ) {
    super(message);
    this.name = 'ModuleError';
  }
}
