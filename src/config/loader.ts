/**
 * Chargement de la configuration : parsing mri → fusion CLI > profil > défaut → validation Zod.
 * Voir architecture.md §6. STUB — à implémenter.
 */
import type { Config } from './schema.js';

export function loadConfig(_profileName: string, _cliArgs: string[]): Config {
  throw new Error('loadConfig: not implemented');
}
