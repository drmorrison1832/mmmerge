import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { drive_v3, gmail_v1 } from 'googleapis';
import { runMailInstance } from './mail.js';
import type { PipelineDeps } from '../deps.js';
import type { MailInstance } from '../../config/schema.js';
import type { MailOutput, RowContext } from '../rowContext.js';

function mailOutputOf(context: RowContext, key: string): MailOutput {
  return context.outputs[key] as MailOutput;
}

type MockFile = { id: string; name: string; parentId: string; mimeType?: string; content?: string };

function createMockDrive(files: MockFile[]) {
  const list = vi.fn(async ({ q }: { q: string }) => {
    const match = q.match(/name = '(.*)' and '(.*)' in parents/);
    if (!match) throw new Error(`Requête Drive inattendue dans le test : ${q}`);
    const [, escapedName, parentId] = match;
    const name = escapedName.replace(/\\'/g, "'");
    const found = files.filter((f) => f.name === name && f.parentId === parentId);
    return { data: { files: found.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })) } };
  });

  const get = vi.fn(async ({ fileId }: { fileId: string }) => {
    const file = files.find((f) => f.id === fileId);
    return { data: Readable.from([Buffer.from(file?.content ?? '')]) };
  });

  const drive = { files: { list, get } } as unknown as drive_v3.Drive;
  return { drive, list, get };
}

function createMockGmail() {
  const draftsCreate = vi.fn(async () => ({ data: { id: 'draft-id', message: { id: 'draft-message-id' } } }));
  const messagesSend = vi.fn(async () => ({ data: { id: 'sent-id' } }));
  const gmail = {
    users: { drafts: { create: draftsCreate }, messages: { send: messagesSend } },
  } as unknown as gmail_v1.Gmail;
  return { gmail, draftsCreate, messagesSend };
}

function createDeps(overrides: Partial<PipelineDeps> = {}): { deps: PipelineDeps; updateOutput: ReturnType<typeof vi.fn> } {
  const { drive } = createMockDrive([]);
  const { gmail } = createMockGmail();
  const updateOutput = vi.fn(async () => {});
  const deps: PipelineDeps = {
    docs: {} as PipelineDeps['docs'],
    drive,
    gmail,
    sheetsWriter: { updateOutput } as unknown as PipelineDeps['sheetsWriter'],
    folderCache: new Map(),
    defaultDateFormat: 'd/M/yyyy',
    autoCreateFolders: true,
    dryRun: false,
    quiet: true,
    ...overrides,
  };
  return { deps, updateOutput };
}

function baseConfig(overrides: Partial<MailInstance> = {}): MailInstance {
  return {
    disable: false,
    to: '{{Email}}',
    cc: [],
    subject: 'Votre contrat',
    template_html: '<p>Bonjour {{Prenom}}</p>',
    draft_only: true,
    attach: 'none',
    generated: [],
    external: [],
    ...overrides,
  };
}

function baseContext(): RowContext {
  return {
    rowNumber: 5,
    rawData: { Email: 'marie@example.com', Prenom: 'Marie' },
    outputs: {},
  };
}

let tmpFiles: string[] = [];
afterEach(() => {
  for (const dir of tmpFiles) rmSync(dir, { recursive: true, force: true });
  tmpFiles = [];
});

describe('runMailInstance', () => {
  it('crée un brouillon (draft_only) sans pièce jointe et écrit MailOutput', async () => {
    const { gmail, draftsCreate } = createMockGmail();
    const { deps, updateOutput } = createDeps({ gmail });
    const context = baseContext();

    await runMailInstance('mail[0]', baseConfig(), context, deps);

    expect(draftsCreate).toHaveBeenCalledWith({
      userId: 'me',
      requestBody: { message: { raw: expect.any(String) } },
    });

    expect(context.outputs['mail[0]']).toEqual({
      subject: 'Votre contrat',
      url: 'https://mail.google.com/mail/u/0/#drafts?compose=draft-message-id',
      draftOnly: true,
      attachments: [],
      createdAt: expect.any(String),
    });
    expect(updateOutput).toHaveBeenCalledWith(5, 'mail[0]', context.outputs['mail[0]']);
  });

  it('envoie directement le message quand draft_only est false, avec une URL #sent/', async () => {
    const { gmail, messagesSend, draftsCreate } = createMockGmail();
    const { deps } = createDeps({ gmail });
    const context = baseContext();

    await runMailInstance('mail[0]', baseConfig({ draft_only: false }), context, deps);

    expect(messagesSend).toHaveBeenCalledOnce();
    expect(draftsCreate).not.toHaveBeenCalled();
    expect(context.outputs['mail[0]'].url).toBe('https://mail.google.com/mail/u/0/#sent/sent-id');
    expect(mailOutputOf(context, 'mail[0]').draftOnly).toBe(false);
  });

  it('joint une instance pdf[] générée (attach: "generated")', async () => {
    const { drive } = createMockDrive([{ id: 'gen-pdf-id', name: 'irrelevant', parentId: 'irrelevant', content: 'PDF-BYTES' }]);
    const { deps } = createDeps({ drive });
    const context = baseContext();
    context.outputs['pdf[0]'] = {
      filename: 'CDDU.pdf',
      url: 'https://drive.google.com/file/d/gen-pdf-id/view',
      createdAt: '2026-07-21T00:00:00Z',
    };

    await runMailInstance(
      'mail[0]',
      baseConfig({ attach: 'generated', generated: ['pdf[0]'] }),
      context,
      deps,
    );

    expect(mailOutputOf(context, 'mail[0]').attachments).toEqual(['CDDU.pdf']);
  });

  it('lève une erreur si la référence "generated" est introuvable dans les sorties', async () => {
    const { deps } = createDeps();
    await expect(
      runMailInstance('mail[0]', baseConfig({ attach: 'generated', generated: ['pdf[0]'] }), baseContext(), deps),
    ).rejects.toThrow(/introuvable dans les sorties/);
  });

  it('résout un fichier "external" via le dossier configuré (attach: "external")', async () => {
    const { drive } = createMockDrive([
      { id: 'folder-id', name: 'Justificatifs', parentId: 'root', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'ext-file-id', name: 'piece.pdf', parentId: 'folder-id', mimeType: 'application/pdf', content: 'PIECE' },
    ]);
    const { deps } = createDeps({ drive });
    const context = baseContext();

    await runMailInstance(
      'mail[0]',
      baseConfig({ attach: 'external', external: ['piece.pdf'], externalFolder: 'Justificatifs' }),
      context,
      deps,
    );

    expect(mailOutputOf(context, 'mail[0]').attachments).toEqual(['piece.pdf']);
  });

  it('lève une erreur si le fichier externe est introuvable', async () => {
    const { drive } = createMockDrive([
      { id: 'folder-id', name: 'Justificatifs', parentId: 'root', mimeType: 'application/vnd.google-apps.folder' },
    ]);
    const { deps } = createDeps({ drive });

    await expect(
      runMailInstance(
        'mail[0]',
        baseConfig({ attach: 'external', external: ['absent.pdf'], externalFolder: 'Justificatifs' }),
        baseContext(),
        deps,
      ),
    ).rejects.toThrow(/introuvable/);
  });

  it('lève une erreur si plusieurs fichiers externes identiques existent (ambiguïté)', async () => {
    const { drive } = createMockDrive([
      { id: 'folder-id', name: 'Justificatifs', parentId: 'root', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'dup-1', name: 'piece.pdf', parentId: 'folder-id', mimeType: 'application/pdf', content: 'A' },
      { id: 'dup-2', name: 'piece.pdf', parentId: 'folder-id', mimeType: 'application/pdf', content: 'B' },
    ]);
    const { deps } = createDeps({ drive });

    await expect(
      runMailInstance(
        'mail[0]',
        baseConfig({ attach: 'external', external: ['piece.pdf'], externalFolder: 'Justificatifs' }),
        baseContext(),
        deps,
      ),
    ).rejects.toThrow(/ambigu/);
  });

  it('lève une erreur si deux entrées "external" se résolvent au même nom (doublon)', async () => {
    const { drive } = createMockDrive([
      { id: 'folder-id', name: 'Justificatifs', parentId: 'root', mimeType: 'application/vnd.google-apps.folder' },
    ]);
    const { deps } = createDeps({ drive });
    const context = baseContext();

    await expect(
      runMailInstance(
        'mail[0]',
        baseConfig({ attach: 'external', external: ['piece.pdf', 'piece.pdf'], externalFolder: 'Justificatifs' }),
        context,
        deps,
      ),
    ).rejects.toThrow(/dupliqué/);
  });

  it('combine generated et external pour attach: "all"', async () => {
    const { drive } = createMockDrive([
      { id: 'folder-id', name: 'Justificatifs', parentId: 'root', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'ext-file-id', name: 'piece.pdf', parentId: 'folder-id', mimeType: 'application/pdf', content: 'PIECE' },
      { id: 'gen-pdf-id', name: 'irrelevant', parentId: 'irrelevant', content: 'PDF-BYTES' },
    ]);
    const { deps } = createDeps({ drive });
    const context = baseContext();
    context.outputs['pdf[0]'] = {
      filename: 'CDDU.pdf',
      url: 'https://drive.google.com/file/d/gen-pdf-id/view',
      createdAt: '2026-07-21T00:00:00Z',
    };

    await runMailInstance(
      'mail[0]',
      baseConfig({ attach: 'all', generated: ['pdf[0]'], external: ['piece.pdf'], externalFolder: 'Justificatifs' }),
      context,
      deps,
    );

    expect(mailOutputOf(context, 'mail[0]').attachments).toEqual(['CDDU.pdf', 'piece.pdf']);
  });

  it('lit le corps depuis template_html_path quand template_html est absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmmerge-mail-test-'));
    tmpFiles.push(dir);
    const path = join(dir, 'body.html');
    writeFileSync(path, '<p>Corps depuis fichier, {{Prenom}}</p>', 'utf-8');

    const { gmail, draftsCreate } = createMockGmail();
    const { deps } = createDeps({ gmail });

    await runMailInstance(
      'mail[0]',
      baseConfig({ template_html: undefined, template_html_path: path }),
      baseContext(),
      deps,
    );

    expect(draftsCreate).toHaveBeenCalledOnce();
  });

  it("n'appelle aucune API Google en mode dry-run, écrit une sortie synthétique", async () => {
    const { gmail, draftsCreate } = createMockGmail();
    const { drive, list } = createMockDrive([]);
    const { deps, updateOutput } = createDeps({ gmail, drive, dryRun: true });
    const context = baseContext();

    await runMailInstance('mail[0]', baseConfig({ attach: 'generated', generated: ['pdf[0]'] }), context, deps);

    expect(draftsCreate).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(mailOutputOf(context, 'mail[0]')).toEqual({
      subject: 'Votre contrat',
      url: '(dry-run)',
      draftOnly: true,
      attachments: [],
      createdAt: expect.any(String),
    });
    expect(updateOutput).toHaveBeenCalledWith(5, 'mail[0]', context.outputs['mail[0]']);
  });
});
