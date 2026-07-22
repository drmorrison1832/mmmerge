/**
 * Exécute les 3 phases dans l'ordre, pour chaque ligne éligible. Voir architecture.md §2, §3, §8.
 */
import { google, type sheets_v4 } from 'googleapis';
import { authenticate } from '../auth.js';
import { SheetsWriter } from '../sheetsWriter.js';
import { extractDriveFileId } from '../utils.js';
import type { Config } from '../config/schema.js';
import { runGdocsInstance } from './modules/gdocs.js';
import { runPdfInstance } from './modules/pdf.js';
import { runMailInstance } from './modules/mail.js';
import { ModuleError, type RowContext } from './rowContext.js';
import type { PipelineDeps } from './deps.js';

export type CliFlags = {
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  validate: boolean;
  /** Numéros de ligne (numérotation visuelle Sheets, ligne 1 = en-tête) demandés via --lines. */
  lines?: number[];
};

export type SheetRow = {
  rowNumber: number;
  rawData: Record<string, string>;
  status: string;
  outputsRaw: string;
};

export function isStatusEligible(status: string): boolean {
  return status === '' || status === "En cours d'exécution" || status.startsWith('Erreur:');
}

async function readSheetRows(sheets: sheets_v4.Sheets, sheetId: string, sheetTabName: string): Promise<SheetRow[]> {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: sheetTabName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = data.values ?? [];
  const headers = (values[0] ?? []).map((header) => String(header));
  const statusIndex = headers.indexOf('mmm_status');
  const outputsIndex = headers.indexOf('mmm_outputs');

  const rows: SheetRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const rowValues = values[i] ?? [];
    const rawData: Record<string, string> = {};
    headers.forEach((header, colIndex) => {
      rawData[header] = String(rowValues[colIndex] ?? '');
    });
    rows.push({
      rowNumber: i + 1, // ligne 1 = en-tête (specs.md §1)
      rawData,
      status: statusIndex === -1 ? '' : String(rowValues[statusIndex] ?? ''),
      outputsRaw: outputsIndex === -1 ? '' : String(rowValues[outputsIndex] ?? ''),
    });
  }
  return rows;
}

async function readHiddenRowNumbers(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  sheetTabName: string,
): Promise<Set<number>> {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    ranges: [sheetTabName],
    includeGridData: true,
    fields: 'sheets(data(rowMetadata(hiddenByUser,hiddenByFilter)))',
  });
  const rowMetadata = data.sheets?.[0]?.data?.[0]?.rowMetadata ?? [];
  const hidden = new Set<number>();
  rowMetadata.forEach((meta, index) => {
    if (meta.hiddenByUser || meta.hiddenByFilter) hidden.add(index + 1);
  });
  return hidden;
}

export function determineEligibleRows(rows: SheetRow[], hiddenRowNumbers: Set<number>, cliFlags: CliFlags): SheetRow[] {
  if (cliFlags.lines) {
    const validRowNumbers = new Set(rows.map((row) => row.rowNumber));
    const invalid = cliFlags.lines.filter((n) => !validRowNumbers.has(n));
    if (invalid.length > 0) {
      throw new Error(`--lines : ligne(s) invalide(s) (hors du tableau ou ligne d'en-tête) : ${invalid.join(', ')}`);
    }
  }
  const linesFilter = cliFlags.lines ? new Set(cliFlags.lines) : null;

  const eligible: SheetRow[] = [];
  for (const row of rows) {
    if (linesFilter && !linesFilter.has(row.rowNumber)) continue;
    if (hiddenRowNumbers.has(row.rowNumber)) {
      console.warn(`Ligne ${row.rowNumber} masquée, ignorée.`);
      continue;
    }
    if (!cliFlags.force && !isStatusEligible(row.status)) continue;
    eligible.push(row);
  }
  return eligible;
}

/** Purge les fichiers gdocs[i]/pdf[i] déjà présents dans mmm_outputs, puis réinitialise mmm_outputs à {}. */
export async function purgeRowOutputs(
  drive: PipelineDeps['drive'],
  sheetsWriter: SheetsWriter,
  row: SheetRow,
): Promise<void> {
  let existingOutputs: Record<string, { url?: string }> = {};
  if (row.outputsRaw) {
    try {
      existingOutputs = JSON.parse(row.outputsRaw);
    } catch {
      throw new Error(`Ligne ${row.rowNumber} : "mmm_outputs" existant n'est pas un JSON valide, purge impossible.`);
    }
  }

  for (const [key, value] of Object.entries(existingOutputs)) {
    if (!/^(gdocs|pdf)\[\d+\]$/.test(key)) continue; // mail[i] jamais nettoyé (specs.md §2, §3)
    const url = value?.url;
    if (!url) continue;
    try {
      const fileId = extractDriveFileId(url);
      await drive.files.update({ fileId, requestBody: { trashed: true } });
      console.warn(`Ligne ${row.rowNumber} : fichier "${key}" mis à la corbeille (purge avant régénération).`);
    } catch (err) {
      console.warn(`Ligne ${row.rowNumber} : échec de mise à la corbeille de "${key}" (${(err as Error).message}).`);
    }
  }

  await sheetsWriter.resetOutputs(row.rowNumber);
}

/** Exécute les 3 phases pour une ligne. Retourne false si une erreur a interrompu la ligne (et le script). */
export async function processRow(
  row: SheetRow,
  profile: Config,
  deps: PipelineDeps,
  nextRowNumber: number | undefined,
): Promise<boolean> {
  await purgeRowOutputs(deps.drive, deps.sheetsWriter, row);

  const context: RowContext = { rowNumber: row.rowNumber, rawData: row.rawData, outputs: {} };
  let currentModuleName = '';

  try {
    for (const [index, instanceConfig] of profile.gdocs.entries()) {
      currentModuleName = `gdocs[${index}]`;
      if (deps.verbose) console.log(`Ligne ${row.rowNumber} : ${currentModuleName}...`);
      await runGdocsInstance(currentModuleName, instanceConfig, context, deps);
    }
    for (const [index, instanceConfig] of profile.pdf.entries()) {
      currentModuleName = `pdf[${index}]`;
      if (deps.verbose) console.log(`Ligne ${row.rowNumber} : ${currentModuleName}...`);
      await runPdfInstance(currentModuleName, instanceConfig, context, deps);
    }
    for (const [index, instanceConfig] of profile.mail.entries()) {
      currentModuleName = `mail[${index}]`;
      if (deps.verbose) console.log(`Ligne ${row.rowNumber} : ${currentModuleName}...`);
      await runMailInstance(currentModuleName, instanceConfig, context, deps);
    }
  } catch (err) {
    context.error =
      err instanceof ModuleError
        ? { module: err.module, message: err.message }
        : { module: currentModuleName, message: (err as Error).message };
    await deps.sheetsWriter.closeRow(context, profile);
    console.error(`Ligne ${row.rowNumber} : Erreur - ${context.error.module} - ${context.error.message}`);
    return false;
  }

  await deps.sheetsWriter.closeRow(context, profile, nextRowNumber);
  console.log(`Ligne ${row.rowNumber} : Succès.`);
  return true;
}

export async function runPipeline(profile: Config, cliFlags: CliFlags): Promise<number> {
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });
  const gmail = google.gmail({ version: 'v1', auth });

  const sheetsWriter = await SheetsWriter.create(sheets, profile.sheetId, profile.sheetTabName, cliFlags.dryRun);

  if (cliFlags.validate) {
    console.log('Configuration valide, Sheet accessible (colonnes mmm_* présentes).');
    return 0;
  }

  const rows = await readSheetRows(sheets, profile.sheetId, profile.sheetTabName);
  const hiddenRowNumbers = await readHiddenRowNumbers(sheets, profile.sheetId, profile.sheetTabName);
  const eligibleRows = determineEligibleRows(rows, hiddenRowNumbers, cliFlags);

  if (eligibleRows.length === 0) {
    console.log('Aucune ligne à traiter.');
    return 0;
  }

  const deps: PipelineDeps = {
    docs,
    drive,
    gmail,
    sheetsWriter,
    folderCache: new Map(),
    defaultDateFormat: profile.defaultDateFormat,
    autoCreateFolders: profile.autoCreateFolders,
    dryRun: cliFlags.dryRun,
    verbose: cliFlags.verbose,
  };

  await sheetsWriter.markInitialRow(eligibleRows[0].rowNumber);

  for (let i = 0; i < eligibleRows.length; i++) {
    const row = eligibleRows[i];
    const nextRow = eligibleRows[i + 1];
    const success = await processRow(row, profile, deps, nextRow?.rowNumber);
    if (!success) return 1;
  }

  return 0;
}
