/**
 * Génération des instances PDF (cycle Doc temporaire → export → suppression).
 * Voir architecture.md §3, §7.
 */
import type { RowContext, FileOutput } from '../rowContext.js';
import type { PdfInstance } from '../../config/schema.js';
import { renderTemplateString } from '../../templateEngine.js';
import type { PipelineDeps } from '../deps.js';
import { resolveOutputFolderId, fillTemplateTags } from './googleDocsHelpers.js';

export async function runPdfInstance(
  moduleName: string,
  config: PdfInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<void> {
  const { rawData } = context;
  const filename = renderTemplateString(
    moduleName,
    config.output_filename,
    rawData,
    context.outputs,
    deps.defaultDateFormat,
  );

  if (deps.dryRun) {
    console.log(`[dry-run] ${moduleName} : générerait "${filename}" depuis le template "${config.template_id}".`);
    const output: FileOutput = { filename, url: '(dry-run)', createdAt: new Date().toISOString() };
    context.outputs[moduleName] = output;
    await deps.sheetsWriter.updateOutput(context.rowNumber, moduleName, output);
    return;
  }

  const folderId = await resolveOutputFolderId(moduleName, deps, config, rawData);

  const { data: tempCopy } = await deps.drive.files.copy({
    fileId: config.template_id,
    requestBody: { name: `[tmp] ${filename}` },
  });
  const tempDocId = tempCopy.id!;

  await fillTemplateTags(moduleName, deps.docs, tempDocId, rawData, deps.defaultDateFormat);

  const { data: pdfStream } = await deps.drive.files.export(
    { fileId: tempDocId, mimeType: 'application/pdf' },
    { responseType: 'stream' },
  );

  const { data: created } = await deps.drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: 'application/pdf', body: pdfStream },
  });
  const fileId = created.id!;

  await deps.drive.files.delete({ fileId: tempDocId });

  const output: FileOutput = {
    filename,
    url: `https://drive.google.com/file/d/${fileId}/view`,
    createdAt: new Date().toISOString(),
  };
  context.outputs[moduleName] = output;
  await deps.sheetsWriter.updateOutput(context.rowNumber, moduleName, output);
}
