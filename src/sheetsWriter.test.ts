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

  const sheets = { spreadsheets: { values: { get, batchUpdate } } } as unknown as import('googleapis').sheets_v4.Sheets;
  return { sheets, cells, get, batchUpdate };
}

async function createWriter(initialRanges: Record<string, unknown[][]> = {}) {
  const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [HEADERS], ...initialRanges });
  const writer = await SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB);
  return { writer, ...mock };
}

const DATE_TIME_FORMAT = /^\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}$/;

describe('SheetsWriter.create', () => {
  it('résout les colonnes réservées à partir de la ligne d\'en-tête', async () => {
    const { writer } = await createWriter();
    expect(writer).toBeInstanceOf(SheetsWriter);
  });

  it('lève une erreur explicite si une colonne réservée est absente', async () => {
    const mock = createMockSheetsClient({ [`${SHEET_TAB}!1:1`]: [['Nom', 'mmm_status']] });
    await expect(SheetsWriter.create(mock.sheets, 'sheet-id', SHEET_TAB)).rejects.toThrow(/mmm_outputs/);
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

describe('closeRow', () => {
  const baseProfile: Config = {
    sheetId: 'sheet-id',
    sheetTabName: SHEET_TAB,
    autoCreateFolders: true,
    defaultDateFormat: 'd/M/yyyy',
    gdocs: [],
    pdf: [{ template_id: 't', output_folder: 'f', output_filename: 'n', name: 'Copie archives' }],
    mail: [],
  };

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
    await writer.closeRow(context, { ...baseProfile, gdocs: [{ template_id: 't', output_folder: 'f', output_filename: 'n' }] });

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
