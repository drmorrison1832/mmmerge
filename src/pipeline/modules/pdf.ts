/**
 * Génération des instances PDF (cycle Doc temporaire → export → suppression).
 * Voir architecture.md §3, §7. STUB — à implémenter.
 */
import type { RowContext } from '../rowContext.js';
import type { PdfInstance } from '../../config/schema.js';

export async function runPdfInstance(
  _moduleName: string,
  _config: PdfInstance,
  _context: RowContext,
): Promise<void> {
  throw new Error('runPdfInstance: not implemented');
}
