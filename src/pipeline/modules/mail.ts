/**
 * Composition/envoi des instances Mail + résolution de leurs pièces jointes.
 * Voir architecture.md §3. STUB — à implémenter.
 */
import type { RowContext } from '../rowContext.js';
import type { MailInstance } from '../../config/schema.js';

export async function runMailInstance(
  _moduleName: string,
  _config: MailInstance,
  _context: RowContext,
): Promise<void> {
  throw new Error('runMailInstance: not implemented');
}
