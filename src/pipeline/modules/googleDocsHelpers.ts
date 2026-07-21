/**
 * Logique partagée par les instances gDocs et PDF : résolution du dossier de sortie
 * et remplissage des balises d'un Google Doc. Voir architecture.md §3, §7.
 */
import type { docs_v1, drive_v3 } from 'googleapis';
import { resolveTemplateTags, renderTemplateString } from '../../templateEngine.js';
import { resolveFolderPath } from '../../folderResolver.js';
import type { PipelineDeps } from '../deps.js';

type OutputFolderConfig = { output_folder?: string; output_folder_id?: string };

export async function resolveOutputFolderId(
  moduleName: string,
  deps: PipelineDeps,
  config: OutputFolderConfig,
  rawData: Record<string, string>,
): Promise<string> {
  if (config.output_folder_id) return config.output_folder_id;
  return resolveFolderPath(
    moduleName,
    deps.drive,
    config.output_folder!,
    rawData,
    deps.defaultDateFormat,
    deps.autoCreateFolders,
    deps.folderCache,
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

export async function fillTemplateTags(
  moduleName: string,
  docs: docs_v1.Docs,
  documentId: string,
  rawData: Record<string, string>,
  defaultDateFormat: string,
): Promise<void> {
  const { data } = await docs.documents.get({ documentId });
  const fullText = extractPlainText(data.body?.content ?? []);
  const tags = resolveTemplateTags(moduleName, fullText, rawData, defaultDateFormat);
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
): Promise<void> {
  if (shareConfig.link) {
    await drive.permissions.create({
      fileId,
      requestBody: { type: 'anyone', role: driveRole(shareConfig.link.permission) },
    });
  }
  if (shareConfig.email) {
    for (const addressTemplate of shareConfig.email.addresses) {
      const address = renderTemplateString(moduleName, addressTemplate, rawData, {}, defaultDateFormat);
      await drive.permissions.create({
        fileId,
        requestBody: { type: 'user', emailAddress: address, role: driveRole(shareConfig.email.permission) },
      });
    }
  }
}
