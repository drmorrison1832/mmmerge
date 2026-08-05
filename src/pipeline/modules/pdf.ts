/**
 * Génération des instances PDF (cycle Doc temporaire → export → suppression).
 * Voir architecture.md §3, §7.
 */
import type { RowContext, FileOutput } from '../rowContext.js';
import type { PdfInstance } from '../../config/schema.js';
import { renderTemplateString } from '../../templateEngine.js';
import type { PipelineDeps } from '../deps.js';
import { loggedStep } from '../log.js';
import { resolveOutputFolderId, resolveTemplateTagsForDoc, applyTemplateTags } from './googleDocsHelpers.js';

/** Ajoute l'extension .pdf si absente (comparaison insensible à la casse) — jamais de doublon (.pdf.pdf). */
function ensurePdfExtension(filename: string): string {
  return /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`;
}

/** Si link_column est configuré, écrit l'URL de sortie dans cette colonne. */
async function writeLinkColumn(config: PdfInstance, rowNumber: number, url: string, deps: PipelineDeps): Promise<void> {
  if (!config.link_column) return;
  await deps.sheetsWriter.writeColumn(rowNumber, config.link_column, url);
}

export async function runPdfInstance(
  moduleName: string,
  config: PdfInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<void> {
  const { rawData } = context;
  const renderedFilename = renderTemplateString(
    moduleName,
    config.output_filename,
    rawData,
    context.outputs,
    deps.defaultDateFormat,
  );
  const filename = ensurePdfExtension(renderedFilename);

  if (deps.dryRun) {
    console.log(`[dry-run] ${moduleName} : générerait "${filename}" depuis le template "${config.template_id}".`);
    const output: FileOutput = { filename, url: '(dry-run)', createdAt: new Date().toISOString() };
    context.outputs[moduleName] = output;
    await deps.sheetsWriter.updateOutput(context.rowNumber, moduleName, output);
    await writeLinkColumn(config, context.rowNumber, output.url, deps);
    return;
  }

  const logPrefix = `Ligne ${context.rowNumber} : ${moduleName}`;

  const tags = await loggedStep(deps.quiet, `${logPrefix} : lecture du template`, () =>
    resolveTemplateTagsForDoc(moduleName, deps.docs, config.template_id, rawData, deps.defaultDateFormat),
  );
  const folderId = await resolveOutputFolderId(moduleName, deps, config, rawData);

  const { data: tempCopy } = await loggedStep(deps.quiet, `${logPrefix} : copie temporaire du template`, () =>
    deps.drive.files.copy({
      fileId: config.template_id,
      requestBody: { name: `[tmp] ${renderedFilename}` },
    }),
  );
  const tempDocId = tempCopy.id!;

  await loggedStep(deps.quiet, `${logPrefix} : remplissage des balises`, () => applyTemplateTags(deps.docs, tempDocId, tags));

  const { data: pdfStream } = await loggedStep(deps.quiet, `${logPrefix} : export en PDF`, () =>
    deps.drive.files.export({ fileId: tempDocId, mimeType: 'application/pdf' }, { responseType: 'stream' }),
  );

  const { data: created } = await loggedStep(deps.quiet, `${logPrefix} : création du fichier PDF final`, () =>
    deps.drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType: 'application/pdf', body: pdfStream },
    }),
  );
  const fileId = created.id!;

  await loggedStep(deps.quiet, `${logPrefix} : suppression du document temporaire`, () =>
    deps.drive.files.delete({ fileId: tempDocId }),
  );

  const output: FileOutput = {
    filename,
    url: `https://drive.google.com/file/d/${fileId}/view`,
    createdAt: new Date().toISOString(),
  };
  context.outputs[moduleName] = output;
  await deps.sheetsWriter.updateOutput(context.rowNumber, moduleName, output);
  await writeLinkColumn(config, context.rowNumber, output.url, deps);
}
