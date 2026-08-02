/**
 * Génération des instances gDocs + resolveShareSettings. Voir architecture.md §3, §7.
 */
import type { RowContext, FileOutput } from '../rowContext.js';
import type { GdocsInstance } from '../../config/schema.js';
import { renderTemplateString } from '../../templateEngine.js';
import type { PipelineDeps } from '../deps.js';
import { loggedStep } from '../log.js';
import { resolveOutputFolderId, resolveTemplateTagsForDoc, applyTemplateTags, resolveShareSettings } from './googleDocsHelpers.js';

/** Si link_column est activé, écrit l'URL de sortie dans la colonne "<identifiant technique> output". */
async function writeLinkColumn(moduleName: string, config: GdocsInstance, rowNumber: number, url: string, deps: PipelineDeps): Promise<void> {
  if (!config.link_column) return;
  await deps.sheetsWriter.writeColumn(rowNumber, `${moduleName} output`, url);
}

export async function runGdocsInstance(
  moduleName: string,
  config: GdocsInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<void> {
  const { rawData } = context;
  const filename = renderTemplateString(moduleName, config.output_filename, rawData, context.outputs, deps.defaultDateFormat);

  if (deps.dryRun) {
    console.log(`[dry-run] ${moduleName} : générerait "${filename}" depuis le template "${config.template_id}".`);
    const output: FileOutput = { filename, url: '(dry-run)', createdAt: new Date().toISOString() };
    context.outputs[moduleName] = output;
    await deps.sheetsWriter.updateOutput(context.rowNumber, moduleName, output);
    await writeLinkColumn(moduleName, config, context.rowNumber, output.url, deps);
    return;
  }

  const logPrefix = `Ligne ${context.rowNumber} : ${moduleName}`;

  const tags = await loggedStep(deps.quiet, `${logPrefix} : lecture du template`, () =>
    resolveTemplateTagsForDoc(moduleName, deps.docs, config.template_id, rawData, deps.defaultDateFormat),
  );
  const folderId = await resolveOutputFolderId(moduleName, deps, config, rawData);

  const { data: copied } = await loggedStep(deps.quiet, `${logPrefix} : copie du template`, () =>
    deps.drive.files.copy({
      fileId: config.template_id,
      requestBody: { name: filename, parents: [folderId] },
    }),
  );
  const fileId = copied.id!;

  await loggedStep(deps.quiet, `${logPrefix} : remplissage des balises`, () => applyTemplateTags(deps.docs, fileId, tags));

  const output: FileOutput = {
    filename,
    url: `https://docs.google.com/document/d/${fileId}/edit`,
    createdAt: new Date().toISOString(),
  };
  context.outputs[moduleName] = output;
  await deps.sheetsWriter.updateOutput(context.rowNumber, moduleName, output);
  await writeLinkColumn(moduleName, config, context.rowNumber, output.url, deps);

  if (config.share) {
    await resolveShareSettings(
      moduleName,
      deps.drive,
      fileId,
      config.share,
      rawData,
      deps.defaultDateFormat,
      context.rowNumber,
      deps.quiet,
    );
  }
}
