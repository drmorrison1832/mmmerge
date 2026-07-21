/**
 * Seul point d'écriture vers l'API Sheets (mmm_status, mmm_outputs, mmm_last_run).
 * Voir architecture.md §5. STUB — à implémenter.
 */
import type { RowContext, FileOutput, MailOutput } from './pipeline/rowContext.js';
import type { Config } from './config/schema.js';

export class SheetsWriter {
  async markInitialRow(_rowNumber: number): Promise<void> {
    throw new Error('SheetsWriter.markInitialRow: not implemented');
  }

  async updateOutput(_rowNumber: number, _key: string, _value: FileOutput | MailOutput): Promise<void> {
    throw new Error('SheetsWriter.updateOutput: not implemented');
  }

  async closeRow(_context: RowContext, _profile: Config, _nextRowNumber?: number): Promise<void> {
    throw new Error('SheetsWriter.closeRow: not implemented');
  }
}
