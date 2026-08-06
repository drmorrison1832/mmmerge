import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { docs_v1, drive_v3, sheets_v4 } from 'googleapis';
import {
  isStatusEligible,
  determineEligibleRows,
  purgeRowOutputs,
  processRow,
  validateResourceAccessibility,
  runPipeline,
  type SheetRow,
  type CliFlags,
} from './orchestrator.js';
import type { Config } from '../config/schema.js';
import type { PipelineDeps } from './deps.js';
import { SheetsWriter } from '../sheetsWriter.js';

const SHEET_TAB = 'Contrats';
const HEADERS = ['Nom', 'mmm_status', 'mmm_outputs', 'mmm_last_run'];

const mockState = vi.hoisted(() => ({
  authenticate: vi.fn(),
  sheetsClient: undefined as unknown,
  driveClient: undefined as unknown,
  docsClient: undefined as unknown,
  gmailClient: {} as unknown,
}));

vi.mock('../auth.js', () => ({ authenticate: mockState.authenticate }));
vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => mockState.sheetsClient),
    drive: vi.fn(() => mockState.driveClient),
    docs: vi.fn(() => mockState.docsClient),
    gmail: vi.fn(() => mockState.gmailClient),
  },
}));

function makeRow(overrides: Partial<SheetRow> = {}): SheetRow {
  return { rowNumber: 5, rawData: { Nom: 'Dupont' }, status: '', outputsRaw: '', ...overrides };
}

let tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function writeJsonDataFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mmmerge-orchestrator-test-'));
  tmpDirs.push(dir);
  const path = join(dir, 'data.json');
  writeFileSync(path, JSON.stringify(content), 'utf-8');
  return path;
}

function baseCliFlags(overrides: Partial<CliFlags> = {}): CliFlags {
  return {
    dryRun: false,
    force: false,
    quiet: true,
    verbose: false,
    validate: false,
    initColumns: false,
    list: false,
    ...overrides,
  };
}

function baseProfile(overrides: Partial<Config> = {}): Config {
  return {
    sheetId: 'sheet-id',
    sheetTabName: SHEET_TAB,
    autoCreateFolders: true,
    defaultDateFormat: 'd/M/yyyy',
    gdocs: [{ disable: false, template_id: 'template-id', output_folder_id: 'folder-id', output_filename: 'Doc {{Nom}}' }],
    pdf: [],
    mail: [],
    columns: [],
    lookup: [],
    ...overrides,
  };
}

describe('validateResourceAccessibility', () => {
  function createMockDriveForFiles(existingFileIds: string[]) {
    const get = vi.fn(async ({ fileId }: { fileId: string }) => {
      if (!existingFileIds.includes(fileId)) throw new Error('404');
      return { data: { id: fileId } };
    });
    const drive = { files: { get } } as unknown as drive_v3.Drive;
    return { drive, get };
  }

  it('ne remonte aucun problème si tous les template_id/output_folder_id existent', async () => {
    const drive = createMockDriveForFiles(['template-id', 'folder-id']).drive;
    const problems = await validateResourceAccessibility(drive, baseProfile());
    expect(problems).toEqual([]);
  });

  it('remonte un problème par ressource introuvable, avec la référence en clair', async () => {
    const drive = createMockDriveForFiles([]).drive; // rien n'existe
    const problems = await validateResourceAccessibility(drive, baseProfile());

    expect(problems).toContainEqual(expect.stringContaining('gdocs[0].template_id'));
    expect(problems).toContainEqual(expect.stringContaining('gdocs[0].output_folder_id'));
  });

  it('ne vérifie pas output_folder_id quand seul output_folder (chemin dynamique) est configuré', async () => {
    const profile = baseProfile({
      gdocs: [{ disable: false, template_id: 'template-id', output_folder: 'Contrats/{{Annee}}', output_filename: 'x' }],
    });
    const { drive, get } = createMockDriveForFiles(['template-id']);
    const problems = await validateResourceAccessibility(drive, profile);

    expect(problems).toEqual([]);
    expect(get).toHaveBeenCalledOnce(); // seulement template_id
  });

  it('vérifie aussi les instances pdf[]', async () => {
    const profile = baseProfile({
      pdf: [{ disable: false, template_id: 'pdf-template', output_folder_id: 'pdf-folder', output_filename: 'x' }],
    });
    const drive = createMockDriveForFiles(['template-id', 'folder-id']).drive; // pdf-template/pdf-folder absents
    const problems = await validateResourceAccessibility(drive, profile);

    expect(problems).toContainEqual(expect.stringContaining('pdf[0].template_id'));
    expect(problems).toContainEqual(expect.stringContaining('pdf[0].output_folder_id'));
  });

  it('ignore les instances désactivées (aucune vérification Drive)', async () => {
    const { drive, get } = createMockDriveForFiles([]); // rien n'existe
    const profile = baseProfile({
      gdocs: [{ disable: true, template_id: 'broken', output_folder_id: 'f', output_filename: 'x' }],
    });
    const problems = await validateResourceAccessibility(drive, profile);

    expect(problems).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('isStatusEligible', () => {
  it('accepte une cellule vide', () => expect(isStatusEligible('')).toBe(true));
  it('accepte "En cours d\'exécution"', () => expect(isStatusEligible("En cours d'exécution")).toBe(true));
  it('accepte tout ce qui commence par "Erreur:"', () => expect(isStatusEligible('Erreur: gdocs[0] - boom')).toBe(true));
  it('rejette un statut manuel arbitraire (ex: "skip")', () => expect(isStatusEligible('skip')).toBe(false));
  it('rejette "Succès" (ligne déjà traitée)', () => expect(isStatusEligible('Succès')).toBe(false));
});

describe('determineEligibleRows', () => {
  it('filtre selon la liste blanche de statuts', () => {
    const rows = [makeRow({ rowNumber: 2, status: '' }), makeRow({ rowNumber: 3, status: 'skip' })];
    const result = determineEligibleRows(rows, new Set(), baseCliFlags());
    expect(result.map((r) => r.rowNumber)).toEqual([2]);
  });

  it('--force ignore le statut', () => {
    const rows = [makeRow({ rowNumber: 2, status: 'skip' })];
    const result = determineEligibleRows(rows, new Set(), baseCliFlags({ force: true }));
    expect(result.map((r) => r.rowNumber)).toEqual([2]);
  });

  it('exclut les lignes masquées même si le statut est éligible', () => {
    const rows = [makeRow({ rowNumber: 2, status: '' }), makeRow({ rowNumber: 3, status: '' })];
    const result = determineEligibleRows(rows, new Set([3]), baseCliFlags());
    expect(result.map((r) => r.rowNumber)).toEqual([2]);
  });

  it('--lines restreint aux lignes demandées', () => {
    const rows = [makeRow({ rowNumber: 2 }), makeRow({ rowNumber: 3 }), makeRow({ rowNumber: 4 })];
    const result = determineEligibleRows(rows, new Set(), baseCliFlags({ lines: [4] }));
    expect(result.map((r) => r.rowNumber)).toEqual([4]);
  });

  it('lève une erreur si --lines cible une ligne hors du tableau', () => {
    const rows = [makeRow({ rowNumber: 2 })];
    expect(() => determineEligibleRows(rows, new Set(), baseCliFlags({ lines: [99] }))).toThrow(/invalide/);
  });
});

function createMockSheetsWriter() {
  const resetOutputs = vi.fn(async () => {});
  return { resetOutputs } as unknown as SheetsWriter;
}

describe('purgeRowOutputs', () => {
  it('met à la corbeille les fichiers gdocs[i]/pdf[i] référencés (instances actives ou orphelines), jamais mail[i]', async () => {
    const update = vi.fn(async () => ({ data: {} }));
    const drive = { files: { update } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();

    const outputs = {
      'gdocs[0]': { filename: 'x', url: 'https://docs.google.com/document/d/GDOC-ID/edit' },
      'pdf[0]': { filename: 'y', url: 'https://drive.google.com/file/d/PDF-ID/view' }, // orpheline : profil.pdf est vide
      'mail[0]': { url: 'https://mail.google.com/mail/u/0/#drafts/DRAFT-ID' }, // orpheline aussi
    };
    const row = makeRow({ outputsRaw: JSON.stringify(outputs) });

    await purgeRowOutputs(drive, sheetsWriter, row, baseProfile());

    expect(update).toHaveBeenCalledWith({ fileId: 'GDOC-ID', requestBody: { trashed: true } });
    expect(update).toHaveBeenCalledWith({ fileId: 'PDF-ID', requestBody: { trashed: true } });
    expect(update).toHaveBeenCalledTimes(2); // pas mail[0]
    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5, {});
  });

  it("continue et journalise si la mise à la corbeille d'un fichier échoue", async () => {
    const update = vi.fn(async () => {
      throw new Error('fichier déjà supprimé');
    });
    const drive = { files: { update } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const row = makeRow({ outputsRaw: JSON.stringify({ 'gdocs[0]': { url: 'https://docs.google.com/document/d/X/edit' } }) });
    await purgeRowOutputs(drive, sheetsWriter, row, baseProfile());

    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5, {});
    warnSpy.mockRestore();
  });

  it('lève une erreur explicite si mmm_outputs existant est un JSON invalide', async () => {
    const drive = { files: { update: vi.fn() } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const row = makeRow({ outputsRaw: 'pas du json' });

    await expect(purgeRowOutputs(drive, sheetsWriter, row, baseProfile())).rejects.toThrow(/JSON valide/);
  });

  it('réinitialise mmm_outputs même sans rien à purger', async () => {
    const drive = { files: { update: vi.fn() } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();

    await purgeRowOutputs(drive, sheetsWriter, makeRow({ outputsRaw: '' }), baseProfile());

    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5, {});
  });

  it("conserve (sans la purger) la sortie d'une instance désactivée", async () => {
    const update = vi.fn(async () => ({ data: {} }));
    const drive = { files: { update } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const entry = { filename: 'x', url: 'https://docs.google.com/document/d/GDOC-ID/edit' };
    const row = makeRow({ outputsRaw: JSON.stringify({ 'gdocs[0]': entry }) });
    const profile = baseProfile({
      gdocs: [{ disable: true, template_id: 'template-id', output_folder_id: 'folder-id', output_filename: 'n' }],
    });

    await purgeRowOutputs(drive, sheetsWriter, row, profile);

    expect(update).not.toHaveBeenCalled();
    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5, { 'gdocs[0]': entry });
  });

  it("conserve (sans la purger) la sortie d'une instance dont le filtre ne correspond pas à cette ligne", async () => {
    const update = vi.fn(async () => ({ data: {} }));
    const drive = { files: { update } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const entry = { filename: 'y', url: 'https://drive.google.com/file/d/PDF-ID/view' };
    const row = makeRow({ rawData: { Type: 'CDI' }, outputsRaw: JSON.stringify({ 'pdf[0]': entry }) });
    const profile = baseProfile({
      pdf: [
        {
          disable: false,
          template_id: 't',
          output_folder_id: 'f',
          output_filename: 'n',
          filter: { match: 'all', conditions: [{ label: 'Type', criterium: 'equals', value: 'CDD' }] },
        },
      ],
    });

    await purgeRowOutputs(drive, sheetsWriter, row, profile);

    expect(update).not.toHaveBeenCalled();
    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5, { 'pdf[0]': entry });
  });

  it('purge normalement une instance active dont le filtre correspond à cette ligne (régénération à venir)', async () => {
    const update = vi.fn(async () => ({ data: {} }));
    const drive = { files: { update } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const entry = { filename: 'y', url: 'https://drive.google.com/file/d/PDF-ID/view' };
    const row = makeRow({ rawData: { Type: 'CDD' }, outputsRaw: JSON.stringify({ 'pdf[0]': entry }) });
    const profile = baseProfile({
      pdf: [
        {
          disable: false,
          template_id: 't',
          output_folder_id: 'f',
          output_filename: 'n',
          filter: { match: 'all', conditions: [{ label: 'Type', criterium: 'equals', value: 'CDD' }] },
        },
      ],
    });

    await purgeRowOutputs(drive, sheetsWriter, row, profile);

    expect(update).toHaveBeenCalledWith({ fileId: 'PDF-ID', requestBody: { trashed: true } });
    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5, {});
  });

  it("conserve aussi la sortie mail[i] d'une instance désactivée (ne disparaît plus de mmm_outputs)", async () => {
    const drive = { files: { update: vi.fn() } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const entry = { to: 'x@example.com', subject: 's', url: 'https://mail.google.com/mail/u/0/#drafts?compose=1', draftOnly: true, attachments: [], createdAt: '2026-08-02T00:00:00Z' };
    const row = makeRow({ outputsRaw: JSON.stringify({ 'mail[0]': entry }) });
    const profile = baseProfile({
      mail: [{ disable: true, to: '{{Email}}', cc: [], subject: 's', template_html: '<p>x</p>', draft_only: true, attach: 'none', generated: [], external: [] }],
    });

    await purgeRowOutputs(drive, sheetsWriter, row, profile);

    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5, { 'mail[0]': entry });
  });

  it("si le filtre n'est pas évaluable ici (colonne absente), préserve par sécurité sans planter la purge", async () => {
    const drive = { files: { update: vi.fn() } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const entry = { filename: 'y', url: 'https://drive.google.com/file/d/PDF-ID/view' };
    const row = makeRow({ rawData: { Nom: 'Dupont' }, outputsRaw: JSON.stringify({ 'pdf[0]': entry }) });
    const profile = baseProfile({
      pdf: [
        {
          disable: false,
          template_id: 't',
          output_folder_id: 'f',
          output_filename: 'n',
          filter: { match: 'all', conditions: [{ label: 'Inconnue', criterium: 'equals', value: 'x' }] },
        },
      ],
    });

    await expect(purgeRowOutputs(drive, sheetsWriter, row, profile)).resolves.toBeUndefined();

    expect(drive.files.update).not.toHaveBeenCalled();
    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5, { 'pdf[0]': entry });
  });
});

function createDeps(overrides: Partial<PipelineDeps> = {}): {
  deps: PipelineDeps;
  updateOutput: ReturnType<typeof vi.fn>;
  closeRow: ReturnType<typeof vi.fn>;
} {
  const docsGet = vi.fn(async () => ({ data: { body: { content: [] } } }));
  const docsBatchUpdate = vi.fn(async () => ({ data: {} }));
  const docs = { documents: { get: docsGet, batchUpdate: docsBatchUpdate } } as unknown as docs_v1.Docs;

  const copy = vi.fn(async () => ({ data: { id: 'new-doc-id' } }));
  const drive = { files: { copy } } as unknown as drive_v3.Drive;

  const updateOutput = vi.fn(async () => {});
  const closeRow = vi.fn(async () => {});
  const sheetsWriter = {
    updateOutput,
    closeRow,
    resetOutputs: vi.fn(async () => {}),
    writeColumn: vi.fn(async () => {}),
    hasColumn: vi.fn(() => true),
    writeColumns: vi.fn(async () => {}),
  } as unknown as PipelineDeps['sheetsWriter'];

  const deps: PipelineDeps = {
    docs,
    drive,
    gmail: {} as PipelineDeps['gmail'],
    sheetsWriter,
    folderCache: new Map(),
    profile: baseProfile(),
    defaultDateFormat: 'd/M/yyyy',
    autoCreateFolders: true,
    dryRun: false,
    quiet: true,
    ...overrides,
  };
  return { deps, updateOutput, closeRow };
}

describe('processRow', () => {
  it('exécute gdocs[] puis clôt la ligne en succès, en ouvrant la ligne suivante', async () => {
    const { deps, closeRow } = createDeps();
    const row = makeRow();

    const { success } = await processRow(row, baseProfile(), deps, 6);

    expect(success).toBe(true);
    expect(closeRow).toHaveBeenCalledOnce();
    const [calledContext, , calledNextRow] = closeRow.mock.calls[0];
    expect(calledContext.rowNumber).toBe(5);
    expect(calledContext.error).toBeUndefined();
    expect(calledNextRow).toBe(6);
  });

  it("interrompt la ligne dès qu'une instance échoue, avec le bon nom de module", async () => {
    const { deps, closeRow } = createDeps();
    (deps.drive.files.copy as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('template introuvable'));

    const { success } = await processRow(makeRow(), baseProfile(), deps, undefined);

    expect(success).toBe(false);
    expect(closeRow).toHaveBeenCalledOnce();
    const [calledContext, , calledNextRow] = closeRow.mock.calls[0];
    expect(calledContext.error).toEqual({ module: 'gdocs[0]', message: 'template introuvable' });
    expect(calledNextRow).toBeUndefined();
  });

  it("n'exécute pas pdf[]/mail[] après l'échec d'une instance gdocs[]", async () => {
    const { deps } = createDeps();
    (deps.drive.files.copy as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const profile = baseProfile({ pdf: [{ disable: false, template_id: 't2', output_folder_id: 'f', output_filename: 'n' }] });

    await processRow(makeRow(), profile, deps, undefined);

    expect(deps.drive.files.copy).toHaveBeenCalledTimes(1);
  });

  it('ignore une instance désactivée (jamais appelée) en conservant les index des autres', async () => {
    const { deps, updateOutput } = createDeps();
    const profile = baseProfile({
      gdocs: [
        { disable: true, template_id: 'broken', output_folder_id: 'f', output_filename: 'skip' },
        { disable: false, template_id: 'template-id', output_folder_id: 'folder-id', output_filename: 'Doc {{Nom}}' },
      ],
    });

    const { success } = await processRow(makeRow(), profile, deps, undefined);

    expect(success).toBe(true);
    expect(deps.drive.files.copy).toHaveBeenCalledTimes(1);
    expect(updateOutput).toHaveBeenCalledWith(5, 'gdocs[1]', expect.anything());
    expect(updateOutput).not.toHaveBeenCalledWith(5, 'gdocs[0]', expect.anything());
  });

  it('ignore une instance dont le filtre ne correspond pas à la ligne, sans échouer', async () => {
    const { deps, updateOutput } = createDeps();
    const profile = baseProfile({
      gdocs: [
        {
          disable: false,
          template_id: 'template-id',
          output_folder_id: 'folder-id',
          output_filename: 'Doc {{Nom}}',
          filter: { match: 'all', conditions: [{ label: 'Nom', criterium: 'equals', value: 'Martin' }] },
        },
      ],
    });

    const { success } = await processRow(makeRow({ rawData: { Nom: 'Dupont' } }), profile, deps, undefined);

    expect(success).toBe(true);
    expect(deps.drive.files.copy).not.toHaveBeenCalled();
    expect(updateOutput).not.toHaveBeenCalled();
  });

  it('exécute une instance dont le filtre correspond à la ligne', async () => {
    const { deps, updateOutput } = createDeps();
    const profile = baseProfile({
      gdocs: [
        {
          disable: false,
          template_id: 'template-id',
          output_folder_id: 'folder-id',
          output_filename: 'Doc {{Nom}}',
          filter: { match: 'all', conditions: [{ label: 'Nom', criterium: 'equals', value: 'Dupont' }] },
        },
      ],
    });

    const { success } = await processRow(makeRow({ rawData: { Nom: 'Dupont' } }), profile, deps, undefined);

    expect(success).toBe(true);
    expect(deps.drive.files.copy).toHaveBeenCalledOnce();
    expect(updateOutput).toHaveBeenCalledWith(5, 'gdocs[0]', expect.anything());
  });

  it('journalise "filtre non satisfait" quand une instance est ignorée (hors mode quiet)', async () => {
    const { deps } = createDeps({ quiet: false });
    const profile = baseProfile({
      gdocs: [
        {
          disable: false,
          template_id: 'template-id',
          output_folder_id: 'folder-id',
          output_filename: 'Doc {{Nom}}',
          filter: { match: 'all', conditions: [{ label: 'Nom', criterium: 'equals', value: 'Martin' }] },
        },
      ],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await processRow(makeRow({ rawData: { Nom: 'Dupont' } }), profile, deps, undefined);

    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('Ligne 5 : gdocs[0] : filtre non satisfait, ignoré.');
    logSpy.mockRestore();
  });

  it('exécute columns[] avant gdocs[], et rend la valeur calculée disponible via {{...}} pour gdocs[]', async () => {
    const { deps } = createDeps();
    const profile = baseProfile({
      columns: [{ disable: false, template: '{{Nom}} recalculé', output_column: 'NomCalcule' }],
      gdocs: [{ disable: false, template_id: 'template-id', output_folder_id: 'folder-id', output_filename: 'Doc {{NomCalcule}}' }],
    });

    await processRow(makeRow({ rawData: { Nom: 'Dupont' } }), profile, deps, undefined);

    expect(deps.sheetsWriter.writeColumn).toHaveBeenCalledWith(5, 'NomCalcule', 'Dupont recalculé');
    expect(deps.drive.files.copy).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ name: 'Doc Dupont recalculé' }) }),
    );
  });

  it('columns[] respecte disable/filter comme les autres modules', async () => {
    const { deps } = createDeps();
    const profile = baseProfile({
      columns: [
        { disable: true, template: 'x', output_column: 'A' },
        { disable: false, template: 'y', output_column: 'B', filter: { match: 'all', conditions: [{ label: 'Nom', criterium: 'equals', value: 'Martin' }] } },
      ],
      gdocs: [],
    });

    const { success } = await processRow(makeRow({ rawData: { Nom: 'Dupont' } }), profile, deps, undefined);

    expect(success).toBe(true);
    expect(deps.sheetsWriter.writeColumn).not.toHaveBeenCalled();
  });

  it('retourne columnsWritten = nombre d\'instances columns[] exécutées avec succès pour la ligne', async () => {
    const { deps } = createDeps();
    const profile = baseProfile({
      columns: [
        { disable: false, template: 'x', output_column: 'A' },
        { disable: false, template: 'y', output_column: 'B' },
      ],
      gdocs: [],
    });

    const { columnsWritten } = await processRow(makeRow(), profile, deps, undefined);

    expect(columnsWritten).toBe(2);
  });

  it('exécute lookup[] avant columns[] et gdocs[], et rend les colonnes importées disponibles via {{...}}', async () => {
    const { deps } = createDeps();
    const dataFile = writeJsonDataFile({ Dupont: { Statut: 'Actif' } });
    const profile = baseProfile({
      lookup: [{ disable: false, file: dataFile, key_column: 'Nom' }],
      columns: [{ disable: false, template: '{{Statut}} recalculé', output_column: 'StatutCalcule' }],
      gdocs: [{ disable: false, template_id: 'template-id', output_folder_id: 'folder-id', output_filename: 'Doc {{StatutCalcule}}' }],
    });

    await processRow(makeRow({ rawData: { Nom: 'Dupont' } }), profile, deps, undefined);

    expect(deps.sheetsWriter.writeColumns).toHaveBeenCalledWith(5, { Statut: 'Actif' });
    expect(deps.drive.files.copy).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ name: 'Doc Actif recalculé' }) }),
    );
  });

  it('lookup[] respecte disable/filter comme les autres modules', async () => {
    const { deps } = createDeps();
    const dataFile = writeJsonDataFile({ Dupont: { Statut: 'Actif' } });
    const profile = baseProfile({
      lookup: [
        { disable: true, file: dataFile, key_column: 'Nom' },
        { disable: false, file: dataFile, key_column: 'Nom', filter: { match: 'all', conditions: [{ label: 'Nom', criterium: 'equals', value: 'Martin' }] } },
      ],
      gdocs: [],
    });

    const { success } = await processRow(makeRow({ rawData: { Nom: 'Dupont' } }), profile, deps, undefined);

    expect(success).toBe(true);
    expect(deps.sheetsWriter.writeColumns).not.toHaveBeenCalled();
  });

  it("retourne lookupEnriched = nombre de lignes effectivement enrichies (clé trouvée)", async () => {
    const { deps } = createDeps();
    const dataFile = writeJsonDataFile({ Dupont: { Statut: 'Actif' } });
    const noMatchFile = writeJsonDataFile({ 'Personne d\'autre': { Statut: 'Actif' } });
    const profile = baseProfile({
      lookup: [
        { disable: false, file: dataFile, key_column: 'Nom' },
        { disable: false, file: noMatchFile, key_column: 'Nom' },
      ],
      gdocs: [],
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { lookupEnriched } = await processRow(makeRow({ rawData: { Nom: 'Dupont' } }), profile, deps, undefined);

    expect(lookupEnriched).toBe(1);
    warnSpy.mockRestore();
  });
});

describe('runPipeline (intégration)', () => {
  function createMockSheetsClient(dataRows: string[][], hiddenRowNumbers: number[] = [], headers: string[] = HEADERS) {
    const allValues = [headers, ...dataRows];
    const cells = new Map<string, unknown[][]>();

    const get = vi.fn(async ({ range }: { range: string }) => {
      if (range === SHEET_TAB) return { data: { values: allValues } };
      if (range === `${SHEET_TAB}!1:1`) return { data: { values: [headers] } };
      return { data: { values: cells.get(range) } };
    });

    const batchUpdate = vi.fn(async ({ requestBody }: { requestBody: { data: { range: string; values: unknown[][] }[] } }) => {
      for (const entry of requestBody.data) cells.set(entry.range, entry.values);
      return { data: {} };
    });

    const update = vi.fn(async ({ range, requestBody }: { range: string; requestBody: { values: unknown[][] } }) => {
      cells.set(range, requestBody.values);
      return { data: {} };
    });

    const spreadsheetsGet = vi.fn(async () => ({
      data: {
        sheets: [
          {
            data: [
              {
                rowMetadata: allValues.map((_, index) =>
                  hiddenRowNumbers.includes(index + 1) ? { hiddenByUser: true } : {},
                ),
              },
            ],
          },
        ],
      },
    }));

    const sheets = {
      spreadsheets: { get: spreadsheetsGet, values: { get, batchUpdate, update } },
    } as unknown as sheets_v4.Sheets;
    return { sheets, cells, get, batchUpdate, update, spreadsheetsGet };
  }

  function createMockDrive() {
    let nextId = 1;
    const copy = vi.fn(async () => ({ data: { id: `doc-${nextId++}` } }));
    const update = vi.fn(async () => ({ data: {} }));
    const get = vi.fn(async ({ fileId }: { fileId: string }) => ({ data: { id: fileId } })); // tout existe par défaut
    const drive = { files: { copy, update, get } } as unknown as drive_v3.Drive;
    return { drive, copy, update, get };
  }

  function createMockDocs() {
    const get = vi.fn(async () => ({ data: { body: { content: [] } } }));
    const batchUpdate = vi.fn(async () => ({ data: {} }));
    const docs = { documents: { get, batchUpdate } } as unknown as docs_v1.Docs;
    return { docs, get, batchUpdate };
  }

  function createMockGmail() {
    let nextId = 1;
    const draftsCreate = vi.fn(async () => ({ data: { id: `draft-${nextId}`, message: { id: `draft-msg-${nextId++}` } } }));
    const gmail = { users: { drafts: { create: draftsCreate } } } as unknown as import('googleapis').gmail_v1.Gmail;
    return { gmail, draftsCreate };
  }

  beforeEach(() => {
    mockState.authenticate.mockReset().mockResolvedValue({});
  });

  it("--validate : vérifie l'accessibilité sans lire ni traiter les lignes", async () => {
    const { sheets, spreadsheetsGet } = createMockSheetsClient([]);
    mockState.sheetsClient = sheets;
    mockState.driveClient = createMockDrive().drive;
    mockState.docsClient = createMockDocs().docs;

    const code = await runPipeline(baseProfile(), baseCliFlags({ validate: true }));

    expect(code).toBe(0);
    expect(spreadsheetsGet).not.toHaveBeenCalled();
  });

  it('--validate : code 1 si un template_id référencé est introuvable sur Drive', async () => {
    const { sheets } = createMockSheetsClient([]);
    mockState.sheetsClient = sheets;
    const get = vi.fn(async () => {
      throw new Error('404');
    });
    mockState.driveClient = { files: { get } } as unknown as drive_v3.Drive;
    mockState.docsClient = createMockDocs().docs;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await runPipeline(baseProfile(), baseCliFlags({ validate: true }));

    expect(code).toBe(1);
    errorSpy.mockRestore();
  });

  it('aucune ligne éligible → code 0, aucune écriture', async () => {
    const { sheets, batchUpdate } = createMockSheetsClient([]);
    mockState.sheetsClient = sheets;
    mockState.driveClient = createMockDrive().drive;
    mockState.docsClient = createMockDocs().docs;

    const code = await runPipeline(baseProfile(), baseCliFlags());

    expect(code).toBe(0);
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("traite deux lignes éligibles avec succès, en chaînant l'ouverture de la ligne suivante", async () => {
    const { sheets, cells } = createMockSheetsClient([
      ['Dupont', '', '', ''],
      ['Martin', '', '', ''],
    ]);
    const { drive, copy } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;

    const code = await runPipeline(baseProfile(), baseCliFlags());

    expect(code).toBe(0);
    expect(copy).toHaveBeenCalledTimes(2);
    expect(cells.get(`${SHEET_TAB}!B2`)).toEqual([['Succès']]);
    expect(cells.get(`${SHEET_TAB}!B3`)).toEqual([['Succès']]);
  });

  it('affiche un résumé (lignes traitées, gdocs/pdf/mail générés) après un succès', async () => {
    const { sheets } = createMockSheetsClient([
      ['Dupont', '', '', ''],
      ['Martin', '', '', ''],
    ]);
    const { drive } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runPipeline(baseProfile(), baseCliFlags());

    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('Lignes traitées avec succès : 2');
    expect(logged).toContain('Documents gDocs générés : 2');
    logSpy.mockRestore();
  });

  it('le résumé compte les colonnes renseignées, et crée la colonne cible automatiquement', async () => {
    const { sheets, update } = createMockSheetsClient([
      ['Dupont', '', '', ''],
      ['Martin', '', '', ''],
    ]);
    const { drive } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const profile = baseProfile({
      gdocs: [],
      columns: [{ disable: false, template: '{{Nom}} recalculé', output_column: 'NomCalcule' }],
    });

    const code = await runPipeline(profile, baseCliFlags());

    expect(code).toBe(0);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { values: [[...HEADERS, 'NomCalcule']] } }),
    );
    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('Colonnes renseignées : 2');
    logSpy.mockRestore();
  });

  it('le résumé compte les lignes enrichies via lookup[], sans purger ni créer de colonne', async () => {
    const { sheets, update } = createMockSheetsClient(
      [
        ['Dupont', '', '', ''],
        ['Martin', '', '', ''],
      ],
      [],
      [...HEADERS, 'Statut'],
    );
    const { drive } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const dataFile = writeJsonDataFile({ Dupont: { Statut: 'Actif' } });
    const profile = baseProfile({
      gdocs: [],
      lookup: [{ disable: false, file: dataFile, key_column: 'Nom' }],
    });

    const code = await runPipeline(profile, baseCliFlags());

    expect(code).toBe(0);
    expect(update).not.toHaveBeenCalled(); // pas de création de colonne (hard error si absente, pas auto-création)
    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('Lignes enrichies via JSON : 1'); // seul "Dupont" correspond à une clé du fichier
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('le résumé ne compte que les sorties réellement générées quand un filtre écarte certaines lignes', async () => {
    const { sheets } = createMockSheetsClient([
      ['Dupont', '', '', ''],
      ['Martin', '', '', ''],
    ]);
    const { drive } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const profile = baseProfile({
      gdocs: [
        {
          disable: false,
          template_id: 'template-id',
          output_folder_id: 'folder-id',
          output_filename: 'Doc {{Nom}}',
          filter: { match: 'all', conditions: [{ label: 'Nom', criterium: 'equals', value: 'Dupont' }] },
        },
      ],
    });

    const code = await runPipeline(profile, baseCliFlags());

    expect(code).toBe(0);
    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('Lignes traitées avec succès : 2'); // les 2 lignes réussissent, filtrées ou non
    expect(logged).toContain('Documents gDocs générés : 1'); // seule la ligne "Dupont" satisfait le filtre
    logSpy.mockRestore();
  });

  it('--verbose : affiche le détail ligne par ligne des documents générés, groupé par instance', async () => {
    const { sheets } = createMockSheetsClient([
      ['Dupont', '', '', ''],
      ['Martin', '', '', ''],
    ]);
    const { drive } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const profile = baseProfile({
      gdocs: [
        { disable: false, name: 'Contrat CDDU', template_id: 'template-id', output_folder_id: 'folder-id', output_filename: 'Doc {{Nom}}' },
      ],
    });

    await runPipeline(profile, baseCliFlags({ verbose: true }));

    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('Documents générés :');
    expect(logged).toContain('gdocs[0] - "Contrat CDDU"');
    expect(logged).toContain('ligne 2 : Doc Dupont : https://docs.google.com/document/d/doc-1/edit');
    expect(logged).toContain('ligne 3 : Doc Martin : https://docs.google.com/document/d/doc-2/edit');
    logSpy.mockRestore();
  });

  it('--verbose : formate une ligne mail avec destinataire - sujet - URL', async () => {
    const { sheets } = createMockSheetsClient([['Dupont', '', '', '']]);
    const { drive } = createMockDrive();
    const { gmail } = createMockGmail();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    mockState.gmailClient = gmail;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const profile = baseProfile({
      gdocs: [],
      mail: [{ disable: false, to: '{{Nom}}', cc: [], subject: 'Sujet {{Nom}}', template_html: '<p>x</p>', draft_only: true, attach: 'none', generated: [], external: [] }],
    });

    await runPipeline(profile, baseCliFlags({ verbose: true }));

    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('mail[0]');
    expect(logged).toContain('ligne 2 : Dupont - Sujet Dupont - https://mail.google.com/mail/u/0/#drafts?compose=draft-msg-1');
    logSpy.mockRestore();
  });

  it("sans --verbose, n'affiche pas le détail ligne par ligne", async () => {
    const { sheets } = createMockSheetsClient([['Dupont', '', '', '']]);
    const { drive } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runPipeline(baseProfile(), baseCliFlags());

    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).not.toContain('Documents générés :');
    logSpy.mockRestore();
  });

  it('annonce les modules désactivés au démarrage et les exclut du décompte du résumé', async () => {
    const { sheets } = createMockSheetsClient([['Dupont', '', '', '']]);
    const { drive, copy } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const profile = baseProfile({
      gdocs: [
        { disable: true, template_id: 'broken', output_folder_id: 'f', output_filename: 'skip' },
        { disable: false, template_id: 'template-id', output_folder_id: 'folder-id', output_filename: 'Doc {{Nom}}' },
      ],
    });

    await runPipeline(profile, baseCliFlags());

    expect(copy).toHaveBeenCalledTimes(1);
    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('Module(s) désactivé(s) : gdocs[0].');
    expect(logged).toContain('Documents gDocs générés : 1');
    logSpy.mockRestore();
  });

  it('le résumé mentionne la ligne en échec quand le script est interrompu', async () => {
    const { sheets } = createMockSheetsClient([['Dupont', '', '', '']]);
    const { drive, copy } = createMockDrive();
    copy.mockRejectedValueOnce(new Error('boom'));
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runPipeline(baseProfile(), baseCliFlags());

    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('Lignes traitées avec succès : 0');
    expect(logged).toContain('Erreur sur la ligne 2 — script interrompu.');
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('--list : affiche les lignes éligibles sans exécuter le pipeline', async () => {
    const { sheets } = createMockSheetsClient([
      ['Dupont', '', '', ''],
      ['Martin', 'Erreur: gdocs[0] - x', '', ''],
      ['Petit', 'skip', '', ''],
    ]);
    const { drive, copy } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runPipeline(baseProfile(), baseCliFlags({ list: true }));

    expect(code).toBe(0);
    expect(copy).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(logged).toContain('2 ligne(s) éligible(s)');
    expect(logged).toContain('Ligne 2');
    expect(logged).toContain('Ligne 3');
    expect(logged).not.toContain('Ligne 4'); // "skip" exclue
    logSpy.mockRestore();
  });

  it('--list : indique clairement quand aucune ligne n\'est éligible', async () => {
    const { sheets } = createMockSheetsClient([['Dupont', 'skip', '', '']]);
    const { drive } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runPipeline(baseProfile(), baseCliFlags({ list: true }));

    expect(code).toBe(0);
    expect(logSpy.mock.calls.map((call) => call[0])).toContain('Aucune ligne éligible.');
    logSpy.mockRestore();
  });

  it('une erreur sur la première ligne arrête le script et ne traite pas la suivante', async () => {
    const { sheets, cells } = createMockSheetsClient([
      ['Dupont', '', '', ''],
      ['Martin', '', '', ''],
    ]);
    const { drive, copy } = createMockDrive();
    copy.mockRejectedValueOnce(new Error('template introuvable'));
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;

    const code = await runPipeline(baseProfile(), baseCliFlags());

    expect(code).toBe(1);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(cells.get(`${SHEET_TAB}!B2`)).toEqual([['Erreur: gdocs[0] - template introuvable']]);
  });

  it('ignore une ligne masquée même avec un statut éligible', async () => {
    const { sheets, cells } = createMockSheetsClient([['Dupont', '', '', '']], [2]);
    const { drive, copy } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const code = await runPipeline(baseProfile(), baseCliFlags());

    expect(code).toBe(0);
    expect(copy).not.toHaveBeenCalled();
    expect(cells.has(`${SHEET_TAB}!B2`)).toBe(false);
    warnSpy.mockRestore();
  });

  it('purge le fichier gdocs[0] déjà référencé avant de régénérer la ligne', async () => {
    const existingOutputs = JSON.stringify({ 'gdocs[0]': { url: 'https://docs.google.com/document/d/OLD-ID/edit' } });
    const { sheets } = createMockSheetsClient([['Dupont', 'Erreur: gdocs[0] - x', existingOutputs, '']]);
    const { drive, update } = createMockDrive();
    mockState.sheetsClient = sheets;
    mockState.driveClient = drive;
    mockState.docsClient = createMockDocs().docs;

    const code = await runPipeline(baseProfile(), baseCliFlags());

    expect(code).toBe(0);
    expect(update).toHaveBeenCalledWith({ fileId: 'OLD-ID', requestBody: { trashed: true } });
  });

  it('--lines cible une ligne inexistante → rejette avec un message explicite', async () => {
    const { sheets } = createMockSheetsClient([['Dupont', '', '', '']]);
    mockState.sheetsClient = sheets;
    mockState.driveClient = createMockDrive().drive;
    mockState.docsClient = createMockDocs().docs;

    await expect(runPipeline(baseProfile(), baseCliFlags({ lines: [99] }))).rejects.toThrow(/invalide/);
  });
});
