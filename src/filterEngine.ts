/**
 * Évaluation du `filter` optionnel d'une instance (gdocs/pdf/mail) contre les données
 * d'une ligne — exécution conditionnelle, une seule fonction pure. Voir architecture.md §3.
 */
import { ModuleError } from './pipeline/rowContext.js';
import type { Filter, FilterCondition } from './config/schema.js';

function evaluateCondition(moduleName: string, condition: FilterCondition, rawData: Record<string, string>): boolean {
  if (!(condition.label in rawData)) {
    throw new ModuleError(moduleName, `Filtre : colonne "${condition.label}" absente du tableau`);
  }
  // Comparaison insensible à la casse, sans normalisation d'espaces.
  const isEqual = rawData[condition.label].toLowerCase() === condition.value.toLowerCase();
  return condition.criterium === 'not_equals' ? !isEqual : isEqual;
}

/** true si l'instance doit s'exécuter pour cette ligne — true si aucun filtre n'est configuré. */
export function matchesFilter(moduleName: string, filter: Filter | undefined, rawData: Record<string, string>): boolean {
  if (!filter) return true;

  const results = filter.conditions.map((condition) => evaluateCondition(moduleName, condition, rawData));

  if (filter.match === 'all') return results.every(Boolean);
  if (filter.match === 'any') return results.some(Boolean);
  return results.every((result) => !result); // 'none'
}
