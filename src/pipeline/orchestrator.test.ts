import { describe, expect, it, vi, beforeEach } from 'vitest';
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

function baseCliFlags(overrides: Partial<CliFlags> = {}): CliFlags {
  return {
    dryRun: false,
    force: false,
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
    gdocs: [{ template_id: 'template-id', output_folder_id: 'folder-id', output_filename: 'Doc {{Nom}}' }],
    pdf: [],
    mail: [],
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
      gdocs: [{ template_id: 'template-id', output_folder: 'Contrats/{{Annee}}', output_filename: 'x' }],
    });
    const { drive, get } = createMockDriveForFiles(['template-id']);
    const problems = await validateResourceAccessibility(drive, profile);

    expect(problems).toEqual([]);
    expect(get).toHaveBeenCalledOnce(); // seulement template_id
  });

  it('vérifie aussi les instances pdf[]', async () => {
    const profile = baseProfile({
      pdf: [{ template_id: 'pdf-template', output_folder_id: 'pdf-folder', output_filename: 'x' }],
    });
    const drive = createMockDriveForFiles(['template-id', 'folder-id']).drive; // pdf-template/pdf-folder absents
    const problems = await validateResourceAccessibility(drive, profile);

    expect(problems).toContainEqual(expect.stringContaining('pdf[0].template_id'));
    expect(problems).toContainEqual(expect.stringContaining('pdf[0].output_folder_id'));
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
  it('met à la corbeille les fichiers gdocs[i]/pdf[i] référencés, jamais mail[i]', async () => {
    const update = vi.fn(async () => ({ data: {} }));
    const drive = { files: { update } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();

    const outputs = {
      'gdocs[0]': { filename: 'x', url: 'https://docs.google.com/document/d/GDOC-ID/edit' },
      'pdf[0]': { filename: 'y', url: 'https://drive.google.com/file/d/PDF-ID/view' },
      'mail[0]': { url: 'https://mail.google.com/mail/u/0/#drafts/DRAFT-ID' },
    };
    const row = makeRow({ outputsRaw: JSON.stringify(outputs) });

    await purgeRowOutputs(drive, sheetsWriter, row);

    expect(update).toHaveBeenCalledWith({ fileId: 'GDOC-ID', requestBody: { trashed: true } });
    expect(update).toHaveBeenCalledWith({ fileId: 'PDF-ID', requestBody: { trashed: true } });
    expect(update).toHaveBeenCalledTimes(2); // pas mail[0]
    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5);
  });

  it("continue et journalise si la mise à la corbeille d'un fichier échoue", async () => {
    const update = vi.fn(async () => {
      throw new Error('fichier déjà supprimé');
    });
    const drive = { files: { update } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const row = makeRow({ outputsRaw: JSON.stringify({ 'gdocs[0]': { url: 'https://docs.google.com/document/d/X/edit' } }) });
    await purgeRowOutputs(drive, sheetsWriter, row);

    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5);
    warnSpy.mockRestore();
  });

  it('lève une erreur explicite si mmm_outputs existant est un JSON invalide', async () => {
    const drive = { files: { update: vi.fn() } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();
    const row = makeRow({ outputsRaw: 'pas du json' });

    await expect(purgeRowOutputs(drive, sheetsWriter, row)).rejects.toThrow(/JSON valide/);
  });

  it('réinitialise mmm_outputs même sans rien à purger', async () => {
    const drive = { files: { update: vi.fn() } } as unknown as drive_v3.Drive;
    const sheetsWriter = createMockSheetsWriter();

    await purgeRowOutputs(drive, sheetsWriter, makeRow({ outputsRaw: '' }));

    expect(sheetsWriter.resetOutputs).toHaveBeenCalledWith(5);
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
  } as unknown as PipelineDeps['sheetsWriter'];

  const deps: PipelineDeps = {
    docs,
    drive,
    gmail: {} as PipelineDeps['gmail'],
    sheetsWriter,
    folderCache: new Map(),
    defaultDateFormat: 'd/M/yyyy',
    autoCreateFolders: true,
    dryRun: false,
    verbose: false,
    ...overrides,
  };
  return { deps, updateOutput, closeRow };
}

describe('processRow', () => {
  it('exécute gdocs[] puis clôt la ligne en succès, en ouvrant la ligne suivante', async () => {
    const { deps, closeRow } = createDeps();
    const row = makeRow();

    const success = await processRow(row, baseProfile(), deps, 6);

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

    const success = await processRow(makeRow(), baseProfile(), deps, undefined);

    expect(success).toBe(false);
    expect(closeRow).toHaveBeenCalledOnce();
    const [calledContext, , calledNextRow] = closeRow.mock.calls[0];
    expect(calledContext.error).toEqual({ module: 'gdocs[0]', message: 'template introuvable' });
    expect(calledNextRow).toBeUndefined();
  });

  it("n'exécute pas pdf[]/mail[] après l'échec d'une instance gdocs[]", async () => {
    const { deps } = createDeps();
    (deps.drive.files.copy as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const profile = baseProfile({ pdf: [{ template_id: 't2', output_folder_id: 'f', output_filename: 'n' }] });

    await processRow(makeRow(), profile, deps, undefined);

    expect(deps.drive.files.copy).toHaveBeenCalledTimes(1);
  });
});

describe('runPipeline (intégration)', () => {
  function createMockSheetsClient(dataRows: string[][], hiddenRowNumbers: number[] = []) {
    const allValues = [HEADERS, ...dataRows];
    const cells = new Map<string, unknown[][]>();

    const get = vi.fn(async ({ range }: { range: string }) => {
      if (range === SHEET_TAB) return { data: { values: allValues } };
      if (range === `${SHEET_TAB}!1:1`) return { data: { values: [HEADERS] } };
      return { data: { values: cells.get(range) } };
    });

    const batchUpdate = vi.fn(async ({ requestBody }: { requestBody: { data: { range: string; values: unknown[][] }[] } }) => {
      for (const entry of requestBody.data) cells.set(entry.range, entry.values);
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
      spreadsheets: { get: spreadsheetsGet, values: { get, batchUpdate } },
    } as unknown as sheets_v4.Sheets;
    return { sheets, cells, get, batchUpdate, spreadsheetsGet };
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
