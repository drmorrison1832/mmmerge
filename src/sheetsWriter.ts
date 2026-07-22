/**
 * Seul point d'écriture vers l'API Sheets (mmm_status, mmm_outputs, mmm_last_run).
 * Voir architecture.md §5.
 */
import { formatDate } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { sheets_v4 } from 'googleapis';
import type { RowContext, FileOutput, MailOutput } from './pipeline/rowContext.js';
import type { Config } from './config/schema.js';

const RESERVED_COLUMNS = ['mmm_status', 'mmm_outputs', 'mmm_last_run'] as const;
type ReservedColumn = (typeof RESERVED_COLUMNS)[number];
type ColumnIndexes = Record<ReservedColumn, number>;

function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function resolveInstanceName(ref: string, profile: Config): string | undefined {
  const match = ref.match(/^(gdocs|pdf|mail)\[(\d+)\]$/);
  if (!match) return undefined;
  const [, arrayName, indexStr] = match;
  return profile[arrayName as 'gdocs' | 'pdf' | 'mail']?.[Number(indexStr)]?.name;
}

function formatErrorStatus(error: { module: string; message: string }, profile: Config): string {
  const name = resolveInstanceName(error.module, profile);
  return `Erreur: ${error.module}${name ? ` ("${name}")` : ''} - ${error.message}`;
}

type CellWrite = { column: number; rowNumber: number; value: string };

export class SheetsWriter {
  private constructor(
    private readonly sheets: sheets_v4.Sheets,
    private readonly sheetId: string,
    private readonly sheetTabName: string,
    private readonly columns: ColumnIndexes,
    private readonly dryRun: boolean,
  ) {}

  static async create(
    sheets: sheets_v4.Sheets,
    sheetId: string,
    sheetTabName: string,
    dryRun = false,
    initColumns = false,
  ): Promise<SheetsWriter> {
    let data;
    try {
      ({ data } = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetTabName}!1:1`,
      }));
    } catch (err) {
      const rawMessage = (err as Error).message.replace(/\.+$/, '');
      throw new Error(
        `Impossible d'accéder au Sheet "${sheetId}" (onglet "${sheetTabName}") : ${rawMessage}. ` +
          `Vérifiez que sheetId/sheetTabName sont corrects dans le profil, que l'onglet existe, et que ce Sheet ` +
          `est partagé avec le compte Google authentifié.`,
      );
    }
    let headers = data.values?.[0] ?? [];
    const missing = RESERVED_COLUMNS.filter((name) => !headers.includes(name));

    if (missing.length > 0) {
      if (!initColumns) {
        throw new Error(
          `Colonnes système manquantes dans l'en-tête de l'onglet "${sheetTabName}" : ${missing.join(', ')}. ` +
            `Ajoutez-les manuellement au Sheet, ou relancez avec --init-columns pour les créer automatiquement.`,
        );
      }

      const newHeaders = [...headers, ...missing];
      if (dryRun) {
        console.log(`[dry-run] Colonnes système simulées : ${missing.join(', ')} (onglet "${sheetTabName}").`);
      } else {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${sheetTabName}!1:1`,
          valueInputOption: 'RAW',
          requestBody: { values: [newHeaders] },
        });
        console.warn(`Colonnes système créées automatiquement : ${missing.join(', ')} (onglet "${sheetTabName}").`);
      }
      headers = newHeaders;
    }

    const columns = {} as ColumnIndexes;
    for (const name of RESERVED_COLUMNS) {
      columns[name] = headers.indexOf(name);
    }

    return new SheetsWriter(sheets, sheetId, sheetTabName, columns, dryRun);
  }

  private cellRange(column: number, rowNumber: number): string {
    return `${this.sheetTabName}!${columnIndexToLetter(column)}${rowNumber}`;
  }

  private nowFormatted(): string {
    return formatDate(new Date(), 'd/M/yyyy HH:mm', { locale: fr });
  }

  private async writeCells(cells: CellWrite[]): Promise<void> {
    if (this.dryRun) {
      const ranges = cells.map((cell) => this.cellRange(cell.column, cell.rowNumber)).join(', ');
      console.log(`[dry-run] Écriture Sheets simulée : ${ranges}`);
      return;
    }
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: cells.map((cell) => ({ range: this.cellRange(cell.column, cell.rowNumber), values: [[cell.value]] })),
      },
    });
  }

  private async readOutputs(rowNumber: number): Promise<Record<string, FileOutput | MailOutput>> {
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: this.cellRange(this.columns.mmm_outputs, rowNumber),
    });
    const raw = data.values?.[0]?.[0];
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`La cellule "mmm_outputs" de la ligne ${rowNumber} ne contient pas un JSON valide.`);
    }
  }

  async markInitialRow(rowNumber: number): Promise<void> {
    const now = this.nowFormatted();
    await this.writeCells([
      { column: this.columns.mmm_status, rowNumber, value: "En cours d'exécution" },
      { column: this.columns.mmm_last_run, rowNumber, value: now },
    ]);
  }

  /** Réinitialise mmm_outputs à {} — utilisé par la purge en début de ligne (architecture.md §3). */
  async resetOutputs(rowNumber: number): Promise<void> {
    const now = this.nowFormatted();
    await this.writeCells([
      { column: this.columns.mmm_outputs, rowNumber, value: '{}' },
      { column: this.columns.mmm_last_run, rowNumber, value: now },
    ]);
  }

  async updateOutput(rowNumber: number, key: string, value: FileOutput | MailOutput): Promise<void> {
    const current = await this.readOutputs(rowNumber);
    const merged = { ...current, [key]: value };
    const now = this.nowFormatted();
    await this.writeCells([
      { column: this.columns.mmm_outputs, rowNumber, value: JSON.stringify(merged) },
      { column: this.columns.mmm_last_run, rowNumber, value: now },
    ]);
  }

  async closeRow(context: RowContext, profile: Config, nextRowNumber?: number): Promise<void> {
    const status = context.error ? formatErrorStatus(context.error, profile) : 'Succès';
    const now = this.nowFormatted();

    const cells: CellWrite[] = [
      { column: this.columns.mmm_status, rowNumber: context.rowNumber, value: status },
      { column: this.columns.mmm_last_run, rowNumber: context.rowNumber, value: now },
    ];

    if (nextRowNumber !== undefined) {
      cells.push(
        { column: this.columns.mmm_status, rowNumber: nextRowNumber, value: "En cours d'exécution" },
        { column: this.columns.mmm_last_run, rowNumber: nextRowNumber, value: now },
      );
    }

    await this.writeCells(cells);
  }
}
