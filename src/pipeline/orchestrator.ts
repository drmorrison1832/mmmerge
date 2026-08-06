/**
 * Exécute les 3 phases dans l'ordre, pour chaque ligne éligible. Voir architecture.md §2, §3, §8.
 */
import { google, type sheets_v4 } from 'googleapis';
import { authenticate } from '../auth.js';
import { SheetsWriter } from '../sheetsWriter.js';
import { extractDriveFileId, resolveInstanceByRef } from '../utils.js';
import type { Config, Filter } from '../config/schema.js';
import { runGdocsInstance } from './modules/gdocs.js';
import { runPdfInstance } from './modules/pdf.js';
import { runMailInstance } from './modules/mail.js';
import { runColumnsInstance } from './modules/columns.js';
import { runJson2ColumnsInstance } from './modules/json2columns.js';
import { ModuleError, type RowContext, type FileOutput, type MailOutput } from './rowContext.js';
import type { PipelineDeps } from './deps.js';
import { loggedStep } from './log.js';
import { matchesFilter } from '../filterEngine.js';

export type CliFlags = {
  dryRun: boolean;
  force: boolean;
  quiet: boolean;
  /** Affiche en fin d'exécution le détail (ligne par ligne) de chaque document/email généré. */
  verbose: boolean;
  validate: boolean;
  /** Crée les colonnes système mmm_* manquantes au lieu de lever une erreur. */
  initColumns: boolean;
  /** Liste les lignes éligibles sans exécuter le pipeline. */
  list: boolean;
  /** Numéros de ligne (numérotation visuelle Sheets, ligne 1 = en-tête) demandés via --lines. */
  lines?: number[];
};

/** Clé = identifiant technique d'instance ('gdocs[0]', 'pdf[1]', 'mail[0]', ...), dans l'ordre où les lignes ont été traitées. */
export type ModuleReport = Map<string, Array<{ rowNumber: number; output: FileOutput | MailOutput }>>;

export type SheetRow = {
  rowNumber: number;
  rawData: Record<string, string>;
  status: string;
  outputsRaw: string;
};

export function isStatusEligible(status: string): boolean {
  return status === '' || status === "En cours d'exécution" || status.startsWith('Erreur:');
}

async function readSheetRows(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  sheetTabName: string,
  quiet: boolean,
): Promise<SheetRow[]> {
  const { data } = await loggedStep(quiet, 'Lecture des lignes du Sheet', () =>
    sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetTabName,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  );
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
  quiet: boolean,
): Promise<Set<number>> {
  const { data } = await loggedStep(quiet, 'Vérification des lignes masquées', () =>
    sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      ranges: [sheetTabName],
      includeGridData: true,
      fields: 'sheets(data(rowMetadata(hiddenByUser,hiddenByFilter)))',
    }),
  );
  const rowMetadata = data.sheets?.[0]?.data?.[0]?.rowMetadata ?? [];
  const hidden = new Set<number>();
  rowMetadata.forEach((meta, index) => {
    if (meta.hiddenByUser || meta.hiddenByFilter) hidden.add(index + 1);
  });
  return hidden;
}

/**
 * Vérifie que les template_id et output_folder_id référencés (gdocs[]/pdf[]) sont accessibles sur Drive.
 * Ne dépend d'aucune ligne du Sheet — utilisé par --validate (specs.md §5 : "cohérence et accessibilité").
 * output_folder (chemin dynamique) n'est pas vérifiable ici : sa résolution nécessite une ligne réelle.
 */
export async function validateResourceAccessibility(
  drive: PipelineDeps['drive'],
  profile: Config,
): Promise<string[]> {
  const problems: string[] = [];

  const checkFile = async (fileId: string, label: string): Promise<void> => {
    try {
      await drive.files.get({ fileId, fields: 'id' });
    } catch {
      problems.push(`${label} : fichier "${fileId}" introuvable ou inaccessible sur Drive.`);
    }
  };

  const instances = [
    ...profile.gdocs.map((instance, index) => ({ instance, ref: `gdocs[${index}]` })),
    ...profile.pdf.map((instance, index) => ({ instance, ref: `pdf[${index}]` })),
  ].filter(({ instance }) => !instance.disable);

  await Promise.all(
    instances.flatMap(({ instance, ref }) => {
      const checks = [checkFile(instance.template_id, `${ref}.template_id`)];
      if (instance.output_folder_id) {
        checks.push(checkFile(instance.output_folder_id, `${ref}.output_folder_id`));
      }
      return checks;
    }),
  );

  return problems;
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

/**
 * Purge les fichiers gdocs[i]/pdf[i] qui vont être régénérés dans cette même exécution (ou dont
 * l'instance a été retirée du profil, orpheline), puis réinitialise mmm_outputs — en conservant
 * telles quelles les entrées d'une instance désactivée ou dont le filtre ne correspond pas à
 * cette ligne : ces instances ne s'exécutent pas cette fois-ci, leur sortie n'a donc rien à voir
 * avec une régénération et ne doit ni être purgée, ni disparaître de mmm_outputs.
 */
export async function purgeRowOutputs(
  drive: PipelineDeps['drive'],
  sheetsWriter: SheetsWriter,
  row: SheetRow,
  profile: Config,
  quiet = true,
): Promise<void> {
  let existingOutputs: Record<string, FileOutput | MailOutput> = {};
  if (row.outputsRaw) {
    try {
      existingOutputs = JSON.parse(row.outputsRaw);
    } catch {
      throw new Error(`Ligne ${row.rowNumber} : "mmm_outputs" existant n'est pas un JSON valide, purge impossible.`);
    }
  }

  const preserved: Record<string, FileOutput | MailOutput> = {};

  for (const [key, value] of Object.entries(existingOutputs)) {
    const instance = resolveInstanceByRef(key, profile);

    if (instance) {
      let willRunThisRow: boolean;
      try {
        willRunThisRow = !instance.disable && matchesFilter(key, instance.filter, row.rawData);
      } catch {
        // Filtre non évaluable ici (ex: colonne absente) : par sécurité, on ne perd rien — la même
        // erreur sera levée normalement par skipIfFiltered lors de l'exécution de la ligne.
        willRunThisRow = false;
      }
      if (!willRunThisRow) {
        preserved[key] = value; // désactivée, ou filtre non satisfait pour cette ligne : ni purgée, ni perdue
        continue;
      }
    }

    // L'instance va régénérer cette sortie dans cette même exécution, ou a été retirée du profil
    // (orpheline, plus jamais référencée) : dans les deux cas, rien à conserver ici.
    if (/^(gdocs|pdf)\[\d+\]$/.test(key)) {
      const url = (value as FileOutput | undefined)?.url;
      if (url) {
        try {
          const fileId = extractDriveFileId(url);
          if (!quiet) console.log(`Ligne ${row.rowNumber} : mise à la corbeille de "${key}"...`);
          await drive.files.update({ fileId, requestBody: { trashed: true } });
          console.warn(`Ligne ${row.rowNumber} : fichier "${key}" mis à la corbeille (purge avant régénération).`);
        } catch (err) {
          console.warn(`Ligne ${row.rowNumber} : échec de mise à la corbeille de "${key}" (${(err as Error).message}).`);
        }
      }
    }
    // mail[i] : jamais purgé (specs.md §2, §3) — l'entrée est simplement abandonnée (regénérée si
    // l'instance s'exécute cette ligne, ou orpheline si elle a été retirée du profil).
  }

  await sheetsWriter.resetOutputs(row.rowNumber, preserved);
}

/** Nombre total d'entrées accumulées dans le rapport pour les instances "type[i]" (ex: préfixe "gdocs["). */
function countByPrefix(report: ModuleReport, prefix: string): number {
  let total = 0;
  for (const [ref, entries] of report) {
    if (ref.startsWith(prefix)) total += entries.length;
  }
  return total;
}

function printSummary(
  processedRows: number,
  profile: Config,
  report: ModuleReport,
  columnsWritten: number,
  json2ColumnsEnriched: number,
  failure?: { rowNumber: number },
): void {
  const hasActive = <T extends { disable?: boolean }>(instances: T[]): boolean =>
    instances.some((instance) => !instance.disable);

  console.log('');
  console.log('Résumé :');
  console.log(`  Lignes traitées avec succès : ${processedRows}`);
  // Compté à partir de report (sorties réellement produites), pas processedRows × nombre d'instances actives :
  // un `filter` peut faire qu'une instance active ne s'exécute pas sur toutes les lignes traitées.
  if (hasActive(profile.json2columns)) console.log(`  Lignes enrichies via JSON : ${json2ColumnsEnriched}`);
  if (hasActive(profile.columns)) console.log(`  Colonnes renseignées : ${columnsWritten}`);
  if (hasActive(profile.gdocs)) console.log(`  Documents gDocs générés : ${countByPrefix(report, 'gdocs[')}`);
  if (hasActive(profile.pdf)) console.log(`  Fichiers PDF générés : ${countByPrefix(report, 'pdf[')}`);
  if (hasActive(profile.mail)) console.log(`  Emails composés : ${countByPrefix(report, 'mail[')}`);
  if (failure) console.log(`  Erreur sur la ligne ${failure.rowNumber} — script interrompu.`);
}

/** Ajoute les sorties d'une ligne (une par instance non désactivée exécutée) au rapport accumulé sur toute l'exécution. */
function recordOutputs(report: ModuleReport, rowNumber: number, outputs: RowContext['outputs']): void {
  for (const [moduleName, output] of Object.entries(outputs)) {
    const entries = report.get(moduleName) ?? [];
    entries.push({ rowNumber, output });
    report.set(moduleName, entries);
  }
}

function isMailOutput(output: FileOutput | MailOutput): output is MailOutput {
  return 'to' in output;
}

/** --verbose : détail ligne par ligne de chaque document/email généré, groupé par instance, dans l'ordre du profil. */
function printVerboseManifest(report: ModuleReport, profile: Config): void {
  const sections: Array<{ ref: string; name?: string }> = [
    ...profile.gdocs.map((instance, i) => ({ ref: `gdocs[${i}]`, name: instance.name })),
    ...profile.pdf.map((instance, i) => ({ ref: `pdf[${i}]`, name: instance.name })),
    ...profile.mail.map((instance, i) => ({ ref: `mail[${i}]`, name: instance.name })),
  ];

  const nonEmptySections = sections.filter(({ ref }) => (report.get(ref)?.length ?? 0) > 0);
  if (nonEmptySections.length === 0) return;

  console.log('');
  console.log('Documents générés :');
  for (const { ref, name } of nonEmptySections) {
    console.log('');
    console.log(name ? `${ref} - "${name}"` : ref);
    for (const { rowNumber, output } of report.get(ref)!) {
      if (isMailOutput(output)) {
        console.log(`  ligne ${rowNumber} : ${output.to} - ${output.subject} - ${output.url}`);
      } else {
        console.log(`  ligne ${rowNumber} : ${output.filename} : ${output.url}`);
      }
    }
  }
}

/** Liste "type[index]" des instances désactivées (disable: true), tous modules confondus, dans l'ordre du profil. */
function listDisabledInstances(profile: Config): string[] {
  return [
    ...profile.json2columns.flatMap((instance, i) => (instance.disable ? [`json2columns[${i}]`] : [])),
    ...profile.columns.flatMap((instance, i) => (instance.disable ? [`columns[${i}]`] : [])),
    ...profile.gdocs.flatMap((instance, i) => (instance.disable ? [`gdocs[${i}]`] : [])),
    ...profile.pdf.flatMap((instance, i) => (instance.disable ? [`pdf[${i}]`] : [])),
    ...profile.mail.flatMap((instance, i) => (instance.disable ? [`mail[${i}]`] : [])),
  ];
}

/**
 * Exécute les 3 phases pour une ligne. `success: false` si une erreur a interrompu la ligne (et le script) —
 * `outputs` contient malgré tout les instances qui ont réussi avant l'interruption.
 */
export async function processRow(
  row: SheetRow,
  profile: Config,
  deps: PipelineDeps,
  nextRowNumber: number | undefined,
): Promise<{ success: boolean; outputs: RowContext['outputs']; columnsWritten: number; json2ColumnsEnriched: number }> {
  if (!deps.quiet) console.log(`Ligne ${row.rowNumber} : démarrage.`);
  await purgeRowOutputs(deps.drive, deps.sheetsWriter, row, profile, deps.quiet);

  const context: RowContext = { rowNumber: row.rowNumber, rawData: row.rawData, outputs: {} };
  let currentModuleName = '';
  let columnsWritten = 0;
  let json2ColumnsEnriched = 0;

  const skipIfFiltered = (moduleName: string, instanceConfig: { filter?: Filter }): boolean => {
    if (matchesFilter(moduleName, instanceConfig.filter, context.rawData)) return false;
    if (!deps.quiet) console.log(`Ligne ${row.rowNumber} : ${moduleName} : filtre non satisfait, ignoré.`);
    return true;
  };

  try {
    for (const [index, instanceConfig] of profile.json2columns.entries()) {
      currentModuleName = `json2columns[${index}]`;
      if (instanceConfig.disable) continue;
      if (skipIfFiltered(currentModuleName, instanceConfig)) continue;
      const enriched = await loggedStep(deps.quiet, `Ligne ${row.rowNumber} : ${currentModuleName}`, () =>
        runJson2ColumnsInstance(currentModuleName, instanceConfig, context, deps),
      );
      if (enriched) json2ColumnsEnriched++;
    }
    for (const [index, instanceConfig] of profile.columns.entries()) {
      currentModuleName = `columns[${index}]`;
      if (instanceConfig.disable) continue;
      if (skipIfFiltered(currentModuleName, instanceConfig)) continue;
      await loggedStep(deps.quiet, `Ligne ${row.rowNumber} : ${currentModuleName}`, () =>
        runColumnsInstance(currentModuleName, instanceConfig, context, deps),
      );
      columnsWritten++;
    }
    for (const [index, instanceConfig] of profile.gdocs.entries()) {
      currentModuleName = `gdocs[${index}]`;
      if (instanceConfig.disable) continue;
      if (skipIfFiltered(currentModuleName, instanceConfig)) continue;
      await loggedStep(deps.quiet, `Ligne ${row.rowNumber} : ${currentModuleName}`, () =>
        runGdocsInstance(currentModuleName, instanceConfig, context, deps),
      );
    }
    for (const [index, instanceConfig] of profile.pdf.entries()) {
      currentModuleName = `pdf[${index}]`;
      if (instanceConfig.disable) continue;
      if (skipIfFiltered(currentModuleName, instanceConfig)) continue;
      await loggedStep(deps.quiet, `Ligne ${row.rowNumber} : ${currentModuleName}`, () =>
        runPdfInstance(currentModuleName, instanceConfig, context, deps),
      );
    }
    for (const [index, instanceConfig] of profile.mail.entries()) {
      currentModuleName = `mail[${index}]`;
      if (instanceConfig.disable) continue;
      if (skipIfFiltered(currentModuleName, instanceConfig)) continue;
      await loggedStep(deps.quiet, `Ligne ${row.rowNumber} : ${currentModuleName}`, () =>
        runMailInstance(currentModuleName, instanceConfig, context, deps),
      );
    }
  } catch (err) {
    context.error =
      err instanceof ModuleError
        ? { module: err.module, message: err.message }
        : { module: currentModuleName, message: (err as Error).message };
    await deps.sheetsWriter.closeRow(context, profile);
    console.error(`Ligne ${row.rowNumber} : Erreur - ${context.error.module} - ${context.error.message}`);
    return { success: false, outputs: context.outputs, columnsWritten, json2ColumnsEnriched };
  }

  await deps.sheetsWriter.closeRow(context, profile, nextRowNumber);
  console.log(`Ligne ${row.rowNumber} : Succès.`);
  return { success: true, outputs: context.outputs, columnsWritten, json2ColumnsEnriched };
}

export async function runPipeline(profile: Config, cliFlags: CliFlags): Promise<number> {
  const disabledInstances = listDisabledInstances(profile);
  if (disabledInstances.length > 0) {
    console.log(`Module(s) désactivé(s) : ${disabledInstances.join(', ')}.`);
  }

  const auth = await authenticate(cliFlags.quiet);
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });
  const gmail = google.gmail({ version: 'v1', auth });

  const sheetsWriter = await SheetsWriter.create(
    sheets,
    profile.sheetId,
    profile.sheetTabName,
    cliFlags.dryRun,
    cliFlags.initColumns,
    cliFlags.quiet,
  );

  if (cliFlags.validate) {
    const problems = await validateResourceAccessibility(drive, profile);
    if (problems.length > 0) {
      console.error('Configuration invalide :');
      problems.forEach((problem) => console.error(`  - ${problem}`));
      return 1;
    }
    console.log('Configuration valide : Sheet, colonnes mmm_*, templates et dossiers référencés accessibles.');
    return 0;
  }

  const rows = await readSheetRows(sheets, profile.sheetId, profile.sheetTabName, cliFlags.quiet);
  const hiddenRowNumbers = await readHiddenRowNumbers(sheets, profile.sheetId, profile.sheetTabName, cliFlags.quiet);
  const eligibleRows = determineEligibleRows(rows, hiddenRowNumbers, cliFlags);

  if (cliFlags.list) {
    if (eligibleRows.length === 0) {
      console.log('Aucune ligne éligible.');
    } else {
      console.log(`${eligibleRows.length} ligne(s) éligible(s) :`);
      for (const row of eligibleRows) {
        const statusInfo = row.status ? ` (statut actuel : "${row.status}")` : '';
        console.log(`  - Ligne ${row.rowNumber}${statusInfo}`);
      }
    }
    return 0;
  }

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
    profile,
    defaultDateFormat: profile.defaultDateFormat,
    autoCreateFolders: profile.autoCreateFolders,
    dryRun: cliFlags.dryRun,
    quiet: cliFlags.quiet,
  };

  await sheetsWriter.markInitialRow(eligibleRows[0].rowNumber);

  const report: ModuleReport = new Map();
  let processedRows = 0;
  let columnsWritten = 0;
  let json2ColumnsEnriched = 0;
  for (let i = 0; i < eligibleRows.length; i++) {
    const row = eligibleRows[i];
    const nextRow = eligibleRows[i + 1];
    const result = await processRow(row, profile, deps, nextRow?.rowNumber);
    recordOutputs(report, row.rowNumber, result.outputs);
    columnsWritten += result.columnsWritten;
    json2ColumnsEnriched += result.json2ColumnsEnriched;
    if (!result.success) {
      printSummary(processedRows, profile, report, columnsWritten, json2ColumnsEnriched, { rowNumber: row.rowNumber });
      if (cliFlags.verbose) printVerboseManifest(report, profile);
      return 1;
    }
    processedRows++;
  }

  printSummary(processedRows, profile, report, columnsWritten, json2ColumnsEnriched);
  if (cliFlags.verbose) printVerboseManifest(report, profile);
  return 0;
}
