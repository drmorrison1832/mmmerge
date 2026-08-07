/**
 * Logique partagée par les instances gDocs et PDF : résolution du dossier de sortie
 * et remplissage des balises d'un Google Doc. Voir architecture.md §3, §7.
 */
import type { docs_v1, drive_v3 } from 'googleapis';
import { resolveTemplateTags, renderTemplateString, type ResolvedTag } from '../../templateEngine.js';
import { resolveConfiguredFolderId } from '../../folderResolver.js';
import { loggedStep } from '../log.js';
import type { PipelineDeps } from '../deps.js';

type OutputFolderConfig = { output_folder?: string; output_folder_id?: string; output_subfolder?: string };

export async function resolveOutputFolderId(
  moduleName: string,
  deps: PipelineDeps,
  config: OutputFolderConfig,
  rawData: Record<string, string>,
): Promise<string> {
  return resolveConfiguredFolderId(
    moduleName,
    deps.drive,
    { folder: config.output_folder, folderId: config.output_folder_id, subfolder: config.output_subfolder },
    rawData,
    deps.defaultDateFormat,
    deps.autoCreateFolders,
    deps.folderCache,
    deps.quiet,
  );
}

/** Aplatit le contenu d'un Google Doc (paragraphes, tableaux imbriqués) en texte brut. */
function extractPlainText(elements: docs_v1.Schema$StructuralElement[]): string {
  let text = '';
  for (const element of elements) {
    if (element.paragraph) {
      for (const paragraphElement of element.paragraph.elements ?? []) {
        text += paragraphElement.textRun?.content ?? '';
      }
    }
    if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          text += extractPlainText(cell.content ?? []);
        }
      }
    }
  }
  return text;
}

/**
 * Lit un document (le template lui-même, avant toute copie) et résout ses balises.
 * Lève une ModuleError si une balise est invalide — à appeler avant de copier le
 * template sur Drive, pour ne jamais créer de fichier orphelin en cas d'erreur.
 */
export async function resolveTemplateTagsForDoc(
  moduleName: string,
  docs: docs_v1.Docs,
  documentId: string,
  rawData: Record<string, string>,
  defaultDateFormat: string,
): Promise<ResolvedTag[]> {
  const { data } = await docs.documents.get({ documentId });
  const fullText = extractPlainText(data.body?.content ?? []);
  return resolveTemplateTags(moduleName, fullText, rawData, defaultDateFormat);
}

/** Applique des balises déjà résolues (voir resolveTemplateTagsForDoc) sur un document. */
export async function applyTemplateTags(docs: docs_v1.Docs, documentId: string, tags: ResolvedTag[]): Promise<void> {
  if (tags.length === 0) return;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: tags.map((tag) => ({
        replaceAllText: {
          containsText: { text: tag.fullMatch, matchCase: true },
          replaceText: tag.value,
        },
      })),
    },
  });
}

export function driveRole(permission: 'reader' | 'commenter' | 'editor'): string {
  return permission === 'editor' ? 'writer' : permission;
}

export async function resolveShareSettings(
  moduleName: string,
  drive: drive_v3.Drive,
  fileId: string,
  shareConfig: { email?: { addresses: string[]; permission: 'reader' | 'commenter' | 'editor' }; link?: { permission: 'reader' | 'commenter' | 'editor' } },
  rawData: Record<string, string>,
  defaultDateFormat: string,
  rowNumber = 0,
  quiet = true,
): Promise<void> {
  const logPrefix = `Ligne ${rowNumber} : ${moduleName} : partage`;

  if (shareConfig.link) {
    await loggedStep(quiet, `${logPrefix} — lien public`, () =>
      drive.permissions.create({
        fileId,
        requestBody: { type: 'anyone', role: driveRole(shareConfig.link!.permission) },
      }),
    );
  }
  if (shareConfig.email) {
    for (const addressTemplate of shareConfig.email.addresses) {
      const address = renderTemplateString(moduleName, addressTemplate, rawData, {}, defaultDateFormat);
      await loggedStep(quiet, `${logPrefix} — email "${address}"`, () =>
        drive.permissions.create({
          fileId,
          requestBody: { type: 'user', emailAddress: address, role: driveRole(shareConfig.email!.permission) },
        }),
      );
    }
  }
}
