import { describe, expect, it, vi } from 'vitest';
import { SheetsWriter } from './sheetsWriter.js';
import type { Config } from './config/schema.js';
import type { FileOutput } from './pipeline/rowContext.js';

const SHEET_TAB = 'Contrats';
const HEADERS = ['Nom', 'mmm_status', 'mmm_outputs', 'mmm_last_run'];

/** Client Sheets simulé en mémoire : `cells` associe une plage A1 à son contenu (tableau de lignes). */
function createMockSheetsClient(initialRanges: Record<string, unknown[][]> = {}) {
  const cells = new Map<string, unknown[][]>(Object.entries(initialRanges));

  const get = vi.fn(async ({ range }: { range: string }) => ({
    data: { values: cells.get(range) },
  }));

  const batchUpdate = vi.fn(
    async ({ requestBody }: { requestBody: { data: { range: string; values: unknown[][] }[] } }) => {
      for (const entry of requestBody.data) {
        cells.set(entry.range, entry.values);
      }
      return { data: {} };
    },
  );

  const update = vi.fn(
    async ({ range, requestBody }: { range: string; requestBody: { values: unknown[][] } }) => {
      cells.set(range, requestBody.values);
      return { data: {} };
    },
  );

  const sheets = {
    spreadsheets: { values: { get, batchUpdate, update } },
  } as unknown as import('googleapis').sheets_v4.Sheets;
  return { sheets, cells, get, batchUpdate, update };
}

async function createWriter(initialRanges: Record<string, unknown[][]> = {}, dryRun = false) {
  const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [HEADERS], ...initialRanges });
  const writer = await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB, dryRun);
  return { writer, ...mock };
}

const DATE_TIME_FORMAT = /^\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}$/;

describe('SheetsWriter.create', () => {
  it('résout les colonnes réservées à partir de la ligne d\'en-tête', async () => {
    const { writer } = await createWriter();
    expect(writer).toBeInstanceOf(SheetsWriter);
  });

  it('lève une erreur explicite listant toutes les colonnes manquantes, et rappelle --init-columns', async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [['Nom', 'mmm_status']] });
    await expect(SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB)).rejects.toThrow(
      /mmm_outputs.*mmm_last_run.*--init-columns/s,
    );
  });

  it("enrichit une erreur d'accès au Sheet (ID incorrect, non partagé, onglet inexistant...) avec du contexte actionnable", async () => {
    const get = vi.fn(async () => {
      throw new Error('Requested entity was not found.');
    });
    const sheets = { spreadsheets: { values: { get } } } as unknown as import('googleapis').sheets_v4.Sheets;

    await expect(SheetsWriter.create(sheets, 'bad-sheet-id', SHEET_TAB)).rejects.toThrow(
      /bad-sheet-id.*Contrats.*Requested entity was not found.*partagé/s,
    );
  });

  it('--init-columns : crée les colonnes manquantes en les ajoutant à la fin de l\'en-tête', async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [['Nom', 'mmm_status']] });
    const writer = await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB, false, true);

    expect(mock.update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: `${SHEET_TAB}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Nom', 'mmm_status', 'mmm_outputs', 'mmm_last_run']] },
    });

    // la nouvelle instance sait déjà où écrire (mmm_outputs en colonne C, index 2)
    await writer.resetOutputs(5);
    expect(mock.cells.get(`${SHEET_TAB}!C5`)).toEqual([['{}']]);
  });

  it('--init-columns + --dry-run : simule la création sans écrire', async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [['Nom', 'mmm_status']] });
    await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB, true, true);

    expect(mock.update).not.toHaveBeenCalled();
  });

  it("--init-columns n'écrit rien si toutes les colonnes sont déjà présentes", async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [HEADERS] });
    await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB, false, true);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('lève une erreur explicite si deux colonnes partagent le même titre', async () => {
    const mock = createMockSheetsClient({
      [`${SHEET_TAB}!1:1`]: [['Nom', 'Nom', 'mmm_status', 'mmm_outputs', 'mmm_last_run']],
    });
    await expect(SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB)).rejects.toThrow(
      /en double.*Nom/s,
    );
  });

  it('lève une erreur pour un doublon parmi les colonnes réservées elles-mêmes', async () => {
    const mock = createMockSheetsClient({
      [`${SHEET_TAB}!1:1`]: [['Nom', 'mmm_status', 'mmm_status', 'mmm_outputs', 'mmm_last_run']],
    });
    await expect(SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB)).rejects.toThrow(
      /en double.*mmm_status/s,
    );
  });

  it('ignore les en-têtes vides (ne les compte pas comme doublons)', async () => {
    const mock = createMockSheetsClient({
      [`${SHEET_TAB}!1:1`]: [['Nom', '', '', 'mmm_status', 'mmm_outputs', 'mmm_last_run']],
    });
    const writer = await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB);
    expect(writer).toBeInstanceOf(SheetsWriter);
  });
});

describe('markInitialRow', () => {
  it('écrit "En cours d\'exécution" en mmm_status et met à jour mmm_last_run', async () => {
    const { writer, cells } = await createWriter();
    await writer.markInitialRow(5);

    expect(cells.get(`${SHEET_TAB}!B5`)).toEqual([["En cours d'exécution"]]);
    expect(cells.get(`${SHEET_TAB}!D5`)?.[0][0]).toMatch(DATE_TIME_FORMAT);
  });
});

describe('resetOutputs', () => {
  it('réinitialise mmm_outputs à {} et met à jour mmm_last_run', async () => {
    const { writer, cells } = await createWriter({ [`${SHEET_TAB}!C5`]: [['{"gdocs[0]":{}}']] });
    await writer.resetOutputs(5);

    expect(cells.get(`${SHEET_TAB}!C5`)).toEqual([['{}']]);
    expect(cells.get(`${SHEET_TAB}!D5`)?.[0][0]).toMatch(DATE_TIME_FORMAT);
  });

  it('écrit les entrées conservées (instance désactivée/filtrée) au lieu de {} quand elles sont fournies', async () => {
    const { writer, cells } = await createWriter();
    const preserved = { 'gdocs[0]': { filename: 'x', url: 'https://x', createdAt: '2026-08-02T00:00:00Z' } };

    await writer.resetOutputs(5, preserved);

    expect(JSON.parse(cells.get(`${SHEET_TAB}!C5`)?.[0][0] as string)).toEqual(preserved);
  });
});

describe('updateOutput', () => {
  it('fusionne une nouvelle clé avec le contenu existant de mmm_outputs (pas d\'écrasement)', async () => {
    const existing = { 'gdocs[0]': { filename: 'CDDU', url: 'https://x', createdAt: '2026-07-21T00:00:00Z' } };
    const { writer, cells } = await createWriter({ [`${SHEET_TAB}!C5`]: [[JSON.stringify(existing)]] });

    const newOutput: FileOutput = { filename: 'CDDU.pdf', url: 'https://y', createdAt: '2026-07-21T00:01:00Z' };
    await writer.updateOutput(5, 'pdf[0]', newOutput);

    const written = JSON.parse(cells.get(`${SHEET_TAB}!C5`)?.[0][0] as string);
    expect(written).toEqual({ ...existing, 'pdf[0]': newOutput });
  });

  it('part de {} si mmm_outputs est vide', async () => {
    const { writer, cells } = await createWriter();
    const output: FileOutput = { filename: 'CDDU', url: 'https://x', createdAt: '2026-07-21T00:00:00Z' };
    await writer.updateOutput(5, 'gdocs[0]', output);

    expect(JSON.parse(cells.get(`${SHEET_TAB}!C5`)?.[0][0] as string)).toEqual({ 'gdocs[0]': output });
  });

  it('lève une erreur explicite si mmm_outputs contient un JSON invalide', async () => {
    const { writer } = await createWriter({ [`${SHEET_TAB}!C5`]: [['pas du json']] });
    const output: FileOutput = { filename: 'x', url: 'https://x', createdAt: '2026-07-21T00:00:00Z' };

    await expect(writer.updateOutput(5, 'gdocs[0]', output)).rejects.toThrow(/JSON valide/);
  });
});

const baseProfile: Config = {
  sheetId: 'sheet-id',
  sheetTabName: SHEET_TAB,
  autoCreateFolders: true,
  defaultDateFormat: 'd/M/yyyy',
  gdocs: [],
  pdf: [{ disable: false, template_id: 't', output_folder: 'f', output_filename: 'n', name: 'Copie archives' }],
  mail: [],
  columns: [],
  json2columns: [],
};

describe('closeRow', () => {
  it('écrit "Succès" quand context.error est absent', async () => {
    const { writer, cells } = await createWriter();
    await writer.closeRow({ rowNumber: 5, rawData: {}, outputs: {} }, baseProfile);

    expect(cells.get(`${SHEET_TAB}!B5`)).toEqual([['Succès']]);
  });

  it('formate le statut d\'erreur avec le nom de l\'instance quand il est configuré', async () => {
    const { writer, cells } = await createWriter();
    const context = {
      rowNumber: 5,
      rawData: {},
      outputs: {},
      error: { module: 'pdf[0]', message: 'fichier introuvable' },
    };
    await writer.closeRow(context, baseProfile);

    expect(cells.get(`${SHEET_TAB}!B5`)).toEqual([['Erreur: pdf[0] ("Copie archives") - fichier introuvable']]);
  });

  it('omet le nom entre parenthèses si l\'instance n\'a pas de name', async () => {
    const { writer, cells } = await createWriter();
    const context = { rowNumber: 5, rawData: {}, outputs: {}, error: { module: 'gdocs[0]', message: 'boom' } };
    await writer.closeRow(context, { ...baseProfile, gdocs: [{ disable: false, template_id: 't', output_folder: 'f', output_filename: 'n' }] });

    expect(cells.get(`${SHEET_TAB}!B5`)).toEqual([['Erreur: gdocs[0] - boom']]);
  });

  it('ouvre aussi la ligne suivante quand nextRowNumber est fourni', async () => {
    const { writer, cells } = await createWriter();
    await writer.closeRow({ rowNumber: 5, rawData: {}, outputs: {} }, baseProfile, 6);

    expect(cells.get(`${SHEET_TAB}!B5`)).toEqual([['Succès']]);
    expect(cells.get(`${SHEET_TAB}!B6`)).toEqual([["En cours d'exécution"]]);
    expect(cells.get(`${SHEET_TAB}!D6`)?.[0][0]).toMatch(DATE_TIME_FORMAT);
  });

  it('ne touche pas à la ligne suivante quand nextRowNumber est absent', async () => {
    const { writer, cells } = await createWriter();
    await writer.closeRow({ rowNumber: 5, rawData: {}, outputs: {} }, baseProfile);

    expect(cells.has(`${SHEET_TAB}!B6`)).toBe(false);
  });
});

describe('writeColumn', () => {
  it('écrit dans une colonne existante sans toucher à l\'en-tête', async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [[...HEADERS, 'NomComplet']] });
    const writer = await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB);

    await writer.writeColumn(5, 'NomComplet', 'Marie Dupont');

    expect(mock.cells.get(`${SHEET_TAB}!E5`)).toEqual([['Marie Dupont']]);
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.cells.get(`${SHEET_TAB}!D5`)?.[0][0]).toMatch(DATE_TIME_FORMAT); // mmm_last_run mis à jour
  });

  it('crée automatiquement la colonne (fin d\'en-tête) si son titre est absent', async () => {
    const { writer, cells, update } = await createWriter();

    await writer.writeColumn(5, 'NomComplet', 'Marie Dupont');

    expect(update).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      range: `${SHEET_TAB}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[...HEADERS, 'NomComplet']] },
    });
    expect(cells.get(`${SHEET_TAB}!E5`)).toEqual([['Marie Dupont']]);
  });

  it('ne crée la colonne qu\'une seule fois pour deux écritures successives (même run)', async () => {
    const { writer, update } = await createWriter();

    await writer.writeColumn(5, 'NomComplet', 'Marie Dupont');
    await writer.writeColumn(6, 'NomComplet', 'Jean Martin');

    expect(update).toHaveBeenCalledOnce();
  });

  it('dry-run : simule la création de colonne et l\'écriture, sans appel réseau', async () => {
    const { writer, update, batchUpdate } = await createWriter({}, true);

    await writer.writeColumn(5, 'NomComplet', 'Marie Dupont');

    expect(update).not.toHaveBeenCalled();
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});

describe('hasColumn', () => {
  it('retourne true pour une colonne existante, false sinon — sans jamais en créer', async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [[...HEADERS, 'Statut']] });
    const writer = await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB);

    expect(writer.hasColumn('Statut')).toBe(true);
    expect(writer.hasColumn('Inconnue')).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
});

describe('writeColumns', () => {
  it('écrit plusieurs colonnes existantes en un seul appel batchUpdate', async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [[...HEADERS, 'Statut', 'Type']] });
    const writer = await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB);

    await writer.writeColumns(5, { Statut: 'Actif', Type: 'CDD' });

    expect(mock.cells.get(`${SHEET_TAB}!E5`)).toEqual([['Actif']]);
    expect(mock.cells.get(`${SHEET_TAB}!F5`)).toEqual([['CDD']]);
    expect(mock.cells.get(`${SHEET_TAB}!D5`)?.[0][0]).toMatch(DATE_TIME_FORMAT); // mmm_last_run mis à jour
    expect(mock.batchUpdate).toHaveBeenCalledOnce();
  });

  it('écrit un nombre/booléen sans le convertir en texte (évite une réinterprétation selon la locale du Sheet)', async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [[...HEADERS, 'Statut', 'Type']] });
    const writer = await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB);

    await writer.writeColumns(5, { Statut: 123.45, Type: true });

    expect(mock.cells.get(`${SHEET_TAB}!E5`)).toEqual([[123.45]]);
    expect(mock.cells.get(`${SHEET_TAB}!F5`)).toEqual([[true]]);
  });
});

describe('dry-run', () => {
  it("n'écrit rien sur le Sheet quand dryRun est actif (markInitialRow)", async () => {
    const { writer, cells, batchUpdate } = await createWriter({}, true);
    await writer.markInitialRow(5);

    expect(batchUpdate).not.toHaveBeenCalled();
    expect(cells.has(`${SHEET_TAB}!B5`)).toBe(false);
  });

  it("n'écrit rien sur le Sheet quand dryRun est actif (closeRow)", async () => {
    const { writer, batchUpdate } = await createWriter({}, true);
    await writer.closeRow({ rowNumber: 5, rawData: {}, outputs: {} }, baseProfile);

    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('continue de lire normalement (updateOutput) même en dryRun', async () => {
    const existing = { 'gdocs[0]': { filename: 'CDDU', url: 'https://x', createdAt: '2026-07-21T00:00:00Z' } };
    const { writer, get, batchUpdate } = await createWriter({ [`${SHEET_TAB}!C5`]: [[JSON.stringify(existing)]] }, true);

    await writer.updateOutput(5, 'pdf[0]', { filename: 'x', url: 'https://y', createdAt: '2026-07-21T00:01:00Z' });

    expect(get).toHaveBeenCalled(); // la lecture reste réelle
    expect(batchUpdate).not.toHaveBeenCalled(); // seule l'écriture est simulée
  });
});
