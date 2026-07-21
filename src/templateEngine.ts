/**
 * Résolution des balises {{variable}} — deux fonctions de sortie, un moteur commun.
 * Voir architecture.md §3. STUB — à implémenter.
 */
import type { FileOutput, MailOutput } from './pipeline/rowContext.js';

export type ResolvedTag = { fullMatch: string; value: string };

export function resolveTemplateTags(
  _moduleName: string,
  _templateContent: string,
  _rawData: Record<string, string>,
  _defaultDateFormat: string,
): ResolvedTag[] {
  throw new Error('resolveTemplateTags: not implemented');
}

export function renderTemplateString(
  _moduleName: string,
  _template: string,
  _rawData: Record<string, string>,
  _outputs: Record<string, FileOutput | MailOutput>,
  _defaultDateFormat: string,
): string {
  throw new Error('renderTemplateString: not implemented');
}
