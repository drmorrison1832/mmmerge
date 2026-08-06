/**
 * Enrichit une ligne à partir d'un fichier JSON externe, indexé par la valeur d'une
 * colonne clé (key_column). Voir architecture.md §3.
 *
 * Exécuté avant columns[]/gdocs[]/pdf[]/mail[] : les colonnes renseignées sont
 * immédiatement disponibles via {{ColonneCible}} pour les instances suivantes de
 * la même ligne. Fichier relu à chaque ligne (pas de cache), comme
 * mail[].template_html_path.
 */
import { readFileSync } from 'node:fs';
import type { RowContext } from '../rowContext.js';
import { ModuleError } from '../rowContext.js';
import type { LookupInstance } from '../../config/schema.js';
import type { PipelineDeps } from '../deps.js';

type LookupTable = Record<string, Record<string, unknown>>;

function loadLookupTable(moduleName: string, filePath: string): LookupTable {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    throw new ModuleError(moduleName, `Fichier "${filePath}" introuvable ou illisible.`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ModuleError(moduleName, `Fichier "${filePath}" : JSON invalide.`);
  }
}

export async function runLookupInstance(
  moduleName: string,
  config: LookupInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<boolean> {
  if (!(config.key_column in context.rawData)) {
    throw new ModuleError(moduleName, `Colonne clé "${config.key_column}" absente du tableau.`);
  }
  const keyValue = context.rawData[config.key_column];

  const table = loadLookupTable(moduleName, config.file);
  const entry = table[keyValue];
  if (!entry) {
    console.warn(
      `Ligne ${context.rowNumber} : ${moduleName} : clé "${keyValue}" introuvable dans "${config.file}", ligne ignorée.`,
    );
    return false;
  }

  const values: Record<string, string> = {};
  for (const [column, value] of Object.entries(entry)) {
    values[column] = String(value);
  }

  const missingColumns = Object.keys(values).filter((column) => !deps.sheetsWriter.hasColumn(column));
  if (missingColumns.length > 0) {
    throw new ModuleError(moduleName, `Colonne(s) introuvable(s) dans le Sheet : ${missingColumns.join(', ')}.`);
  }

  for (const [column, value] of Object.entries(values)) {
    context.rawData[column] = value;
  }

  await deps.sheetsWriter.writeColumns(context.rowNumber, values);
  return true;
}
