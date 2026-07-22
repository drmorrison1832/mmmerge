/**
 * Composition/envoi des instances Mail + résolution de leurs pièces jointes.
 * Voir architecture.md §3, §7.
 */
import { readFileSync } from 'node:fs';
import type { Readable } from 'node:stream';
import type { RowContext, FileOutput, MailOutput } from '../rowContext.js';
import { ModuleError } from '../rowContext.js';
import type { MailInstance } from '../../config/schema.js';
import { renderTemplateString } from '../../templateEngine.js';
import { extractDriveFileId } from '../../utils.js';
import { resolveFolderPath } from '../../folderResolver.js';
import type { PipelineDeps } from '../deps.js';
import { buildRawMimeMessage, toBase64Url } from './mimeMessage.js';

type ResolvedAttachment = { fileId: string; filename: string; mimeType: string };

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function resolveExternalFiles(
  moduleName: string,
  deps: PipelineDeps,
  context: RowContext,
  externalTemplates: string[],
  externalFolderTemplate: string,
): Promise<ResolvedAttachment[]> {
  const folderId = await resolveFolderPath(
    moduleName,
    deps.drive,
    externalFolderTemplate,
    context.rawData,
    deps.defaultDateFormat,
    false, // externalFolder n'est jamais soumis à autoCreateFolders (specs.md §3)
    deps.folderCache,
  );

  const resolvedNames = externalTemplates.map((template) =>
    renderTemplateString(moduleName, template, context.rawData, context.outputs, deps.defaultDateFormat),
  );

  const seen = new Set<string>();
  for (const name of resolvedNames) {
    if (seen.has(name)) {
      throw new ModuleError(moduleName, `"external" : le nom résolu "${name}" est dupliqué.`);
    }
    seen.add(name);
  }

  const results: ResolvedAttachment[] = [];
  for (const name of resolvedNames) {
    const { data } = await deps.drive.files.list({
      q: `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
    });
    const matches = data.files ?? [];

    if (matches.length === 0) {
      throw new ModuleError(moduleName, `Fichier externe "${name}" introuvable dans le dossier configuré.`);
    }
    if (matches.length > 1) {
      throw new ModuleError(moduleName, `Fichier externe "${name}" : plusieurs fichiers identiques trouvés, ambigu.`);
    }
    const [match] = matches;
    if (!match.id) {
      throw new ModuleError(moduleName, `Fichier externe "${name}" trouvé sans identifiant Drive.`);
    }
    results.push({ fileId: match.id, filename: name, mimeType: match.mimeType ?? 'application/octet-stream' });
  }
  return results;
}

async function resolveAttachments(
  moduleName: string,
  config: MailInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<ResolvedAttachment[]> {
  const fromGenerated: ResolvedAttachment[] =
    config.attach === 'all' || config.attach === 'generated'
      ? config.generated.map((ref) => {
          const output = context.outputs[ref] as FileOutput | undefined;
          if (!output) {
            throw new ModuleError(moduleName, `Référence "${ref}" introuvable dans les sorties générées.`);
          }
          return { fileId: extractDriveFileId(output.url), filename: output.filename, mimeType: 'application/pdf' };
        })
      : [];

  const fromExternal =
    config.attach === 'all' || config.attach === 'external'
      ? await resolveExternalFiles(moduleName, deps, context, config.external, config.externalFolder!)
      : [];

  return [...fromGenerated, ...fromExternal];
}

async function downloadAttachmentContent(deps: PipelineDeps, fileId: string): Promise<string> {
  const { data } = await deps.drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  const buffer = await streamToBuffer(data);
  return buffer.toString('base64');
}

export async function runMailInstance(
  moduleName: string,
  config: MailInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<void> {
  const { rawData, outputs } = context;

  const to = renderTemplateString(moduleName, config.to, rawData, outputs, deps.defaultDateFormat);
  const cc = config.cc.map((template) =>
    renderTemplateString(moduleName, template, rawData, outputs, deps.defaultDateFormat),
  );
  const subject = renderTemplateString(moduleName, config.subject, rawData, outputs, deps.defaultDateFormat);

  if (deps.dryRun) {
    console.log(`[dry-run] ${moduleName} : ${config.draft_only ? 'créerait un brouillon' : 'enverrait un mail'} à "${to}", sujet "${subject}".`);
    const output: MailOutput = { subject, url: '(dry-run)', attachments: [], createdAt: new Date().toISOString() };
    context.outputs[moduleName] = output;
    await deps.sheetsWriter.updateOutput(context.rowNumber, moduleName, output);
    return;
  }

  const resolvedAttachments = await resolveAttachments(moduleName, config, context, deps);
  const bodyTemplate = config.template_html ?? readFileSync(config.template_html_path!, 'utf-8');
  const htmlBody = renderTemplateString(moduleName, bodyTemplate, rawData, outputs, deps.defaultDateFormat);

  const attachmentsWithContent = await Promise.all(
    resolvedAttachments.map(async (attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      contentBase64: await downloadAttachmentContent(deps, attachment.fileId),
    })),
  );

  const raw = toBase64Url(buildRawMimeMessage({ to, cc, subject, htmlBody, attachments: attachmentsWithContent }));
  const attachmentFilenames = resolvedAttachments.map((attachment) => attachment.filename);

  let output: MailOutput;
  if (config.draft_only) {
    const { data } = await deps.gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
    output = {
      subject,
      url: `https://mail.google.com/mail/u/0/#drafts/${data.id}`,
      attachments: attachmentFilenames,
      createdAt: new Date().toISOString(),
    };
  } else {
    const { data } = await deps.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    output = {
      subject,
      url: `https://mail.google.com/mail/u/0/#sent/${data.id}`,
      attachments: attachmentFilenames,
      createdAt: new Date().toISOString(),
    };
  }

  context.outputs[moduleName] = output;
  await deps.sheetsWriter.updateOutput(context.rowNumber, moduleName, output);
}
