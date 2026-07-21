/**
 * Chargement de la configuration : parsing mri → fusion CLI > profil > défaut → validation Zod.
 * Voir architecture.md §6.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mri from 'mri';
import type { ZodError } from 'zod';
import { ProfileSchema, type Config } from './schema.js';

const GLOBAL_KEYS = ['sheetId', 'sheetTabName', 'autoCreateFolders', 'defaultDateFormat'];

function readProfileFile(profileName: string): Record<string, unknown> {
  const path = join(process.cwd(), 'configs', `${profileName}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`Profil "${profileName}" introuvable : fichier attendu à "${path}".`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Profil "${profileName}" : JSON invalide (${path}) — ${(err as Error).message}`);
  }
}

function extractCliOverrides(cliArgs: string[]): Record<string, unknown> {
  // sheetId/sheetTabName/defaultDateFormat doivent rester des chaînes même si leur
  // valeur ressemble à un nombre (ex: un sheetTabName "2026") — mri les convertirait sinon.
  const parsed = mri(cliArgs, { string: ['sheetId', 'sheetTabName', 'defaultDateFormat'] });
  const overrides: Record<string, unknown> = {};

  for (const key of GLOBAL_KEYS) {
    if (!(key in parsed)) continue;
    let value = parsed[key];
    if (key === 'autoCreateFolders' && typeof value === 'string') {
      value = value === 'true' ? true : value === 'false' ? false : value;
    }
    overrides[key] = value;
  }

  return overrides;
}

function formatZodError(profileName: string, error: ZodError): string {
  const details = error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
    .join('\n');
  return `Profil "${profileName}" : configuration invalide\n${details}`;
}

export function loadConfig(profileName: string, cliArgs: string[]): Config {
  const profileJson = readProfileFile(profileName);
  const cliOverrides = extractCliOverrides(cliArgs);
  const merged = { ...profileJson, ...cliOverrides };

  const result = ProfileSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(formatZodError(profileName, result.error));
  }
  return result.data;
}
