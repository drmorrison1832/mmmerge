/**
 * Résolution de chemins de dossiers Drive dynamiques, avec cache par exécution.
 * Voir architecture.md §7.
 */
import type { drive_v3 } from 'googleapis';
import { renderTemplateString } from './templateEngine.js';
import { ModuleError } from './pipeline/rowContext.js';
import { loggedStep } from './pipeline/log.js';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DRIVE_ROOT = 'root';

function escapeForDriveQuery(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function resolveOrCreateSegment(
  moduleName: string,
  drive: drive_v3.Drive,
  segmentName: string,
  parentId: string,
  autoCreate: boolean,
  quiet: boolean,
): Promise<string> {
  const { data } = await loggedStep(quiet, `[${moduleName}] Résolution du dossier "${segmentName}"`, () =>
    drive.files.list({
      q: `name = '${escapeForDriveQuery(segmentName)}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
      fields: 'files(id, name)',
    }),
  );
  const matches = data.files ?? [];

  if (matches.length > 1) {
    const ids = matches.map((match) => match.id).join(', ');
    throw new ModuleError(
      moduleName,
      `Dossier "${segmentName}" : plusieurs dossiers identiques trouvés (IDs : ${ids}), ambigu.`,
    );
  }

  if (matches.length === 1) {
    const id = matches[0].id;
    if (!id) throw new ModuleError(moduleName, `Dossier "${segmentName}" trouvé sans identifiant Drive.`);
    return id;
  }

  if (!autoCreate) {
    throw new ModuleError(moduleName, `Dossier "${segmentName}" introuvable (autoCreateFolders désactivé).`);
  }

  console.warn(`[${moduleName}] Création automatique du dossier "${segmentName}".`);
  const { data: created } = await drive.files.create({
    requestBody: { name: segmentName, mimeType: FOLDER_MIME_TYPE, parents: [parentId] },
    fields: 'id',
  });
  if (!created.id) throw new ModuleError(moduleName, `Échec de création du dossier "${segmentName}".`);
  return created.id;
}

export async function resolveFolderPath(
  moduleName: string,
  drive: drive_v3.Drive,
  pathTemplate: string,
  rawData: Record<string, string>,
  defaultDateFormat: string,
  autoCreate: boolean,
  cache: Map<string, string>,
  quiet = true,
  startParentId: string = DRIVE_ROOT,
): Promise<string> {
  const resolvedPath = renderTemplateString(moduleName, pathTemplate, rawData, {}, defaultDateFormat);

  // Le point de départ fait partie de la clé : deux instances partant d'ID différents peuvent
  // résoudre le même chemin relatif (ex: même nom de sous-dossier "2026-08" sous deux dossiers
  // conteneurs distincts) sans que ce soit le même dossier Drive.
  const cacheKey = `${startParentId}:${resolvedPath}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const segments = resolvedPath
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    throw new ModuleError(moduleName, `Chemin de dossier "${pathTemplate}" résolu en chaîne vide.`);
  }

  let parentId = startParentId;
  for (const segment of segments) {
    parentId = await resolveOrCreateSegment(moduleName, drive, segment, parentId, autoCreate, quiet);
  }

  cache.set(cacheKey, parentId);
  return parentId;
}

/**
 * Résout un dossier configuré via un couple (chemin de noms depuis la racine) XOR (ID fixe,
 * avec un sous-chemin dynamique optionnel résolu sous cet ID) — factorisation partagée par
 * gdocs/pdf (output_folder/output_folder_id/output_subfolder) et mail (externalFolder/
 * externalFolderId/externalSubfolder), mêmes règles de validation statique (schema.ts).
 */
export async function resolveConfiguredFolderId(
  moduleName: string,
  drive: drive_v3.Drive,
  config: { folder?: string; folderId?: string; subfolder?: string },
  rawData: Record<string, string>,
  defaultDateFormat: string,
  autoCreate: boolean,
  cache: Map<string, string>,
  quiet = true,
): Promise<string> {
  if (config.folderId) {
    if (!config.subfolder) return config.folderId;
    return resolveFolderPath(
      moduleName,
      drive,
      config.subfolder,
      rawData,
      defaultDateFormat,
      autoCreate,
      cache,
      quiet,
      config.folderId,
    );
  }
  return resolveFolderPath(moduleName, drive, config.folder!, rawData, defaultDateFormat, autoCreate, cache, quiet);
}
