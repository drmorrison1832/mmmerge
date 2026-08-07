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
import type { Json2ColumnsInstance } from '../../config/schema.js';
import type { PipelineDeps } from '../deps.js';

type Json2ColumnsTable = Record<string, Record<string, unknown>>;

function loadJson2ColumnsTable(moduleName: string, filePath: string): Json2ColumnsTable {
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

export async function runJson2ColumnsInstance(
  moduleName: string,
  config: Json2ColumnsInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<boolean> {
  if (!(config.key_column in context.rawData)) {
    throw new ModuleError(moduleName, `Colonne clé "${config.key_column}" absente du tableau.`);
  }
  const keyValue = context.rawData[config.key_column];

  const table = loadJson2ColumnsTable(moduleName, config.file);
  const entry = table[keyValue];
  if (!entry) {
    console.warn(
      `Ligne ${context.rowNumber} : ${moduleName} : clé "${keyValue}" introuvable dans "${config.file}", ligne ignorée.`,
    );
    return false;
  }

  const rawValues: Record<string, string> = {};
  const writeValues: Record<string, string | number | boolean> = {};
  for (const [column, value] of Object.entries(entry)) {
    rawValues[column] = String(value);
    writeValues[column] = typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
  }

  const missingColumns = Object.keys(rawValues).filter((column) => !deps.sheetsWriter.hasColumn(column));
  if (missingColumns.length > 0) {
    throw new ModuleError(moduleName, `Colonne(s) introuvable(s) dans le Sheet : ${missingColumns.join(', ')}.`);
  }

  for (const [column, value] of Object.entries(rawValues)) {
    context.rawData[column] = value;
  }

  await deps.sheetsWriter.writeColumns(context.rowNumber, writeValues);
  return true;
}
