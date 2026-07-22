/**
 * Parsing des valeurs de flags CLI nécessitant une conversion (au-delà de ce que mri fait nativement).
 */
export function parseLines(raw: unknown): number[] | undefined {
  if (raw === undefined) return undefined;
  return String(raw)
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(
          `--lines : valeur invalide "${part}" (attendu des numéros de ligne entiers, séparés par des virgules).`,
        );
      }
      return n;
    });
}
