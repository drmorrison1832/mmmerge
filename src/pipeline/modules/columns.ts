/**
 * Calcule une valeur à partir des colonnes/sorties déjà connues et l'écrit dans une colonne
 * du Sheet (créée automatiquement si absente). Voir architecture.md §3.
 *
 * Exécuté avant gdocs/pdf/mail : la valeur écrite est immédiatement disponible dans
 * context.rawData, donc utilisable via {{output_column}} par les instances suivantes
 * de la même ligne, sans changement côté templateEngine.ts.
 */
import type { RowContext } from '../rowContext.js';
import type { ColumnsInstance } from '../../config/schema.js';
import { renderTemplateString } from '../../templateEngine.js';
import type { PipelineDeps } from '../deps.js';

export async function runColumnsInstance(
  moduleName: string,
  config: ColumnsInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<void> {
  const value = renderTemplateString(
    moduleName,
    config.template,
    context.rawData,
    context.outputs,
    deps.defaultDateFormat,
  );

  context.rawData[config.output_column] = value;
  await deps.sheetsWriter.writeColumn(context.rowNumber, config.output_column, value);
}
