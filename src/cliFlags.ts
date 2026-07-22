/**
 * Parsing des valeurs de flags CLI nécessitant une conversion (au-delà de ce que mri fait nativement),
 * et contenu statique associé à certains flags (--help-templates).
 */
export const HELP_TEMPLATES = `Syntaxe des balises :
  {{variable}}
  {{variable[modificateurs]}}
  {{variable:type[modificateurs]}}   (type omis = string)

Modificateurs génériques (tous types) :
  required     - erreur si la cellule est vide
  uppercase    - tout en majuscules
  lowercase    - tout en minuscules
  capitalize   - majuscule en début de mot

Type "string" :
  initial      - première lettre + point (ex: "Marie" → "M.")

Type "date" :
  format:<token>   - format date-fns (ex: MMMM, yyyy, d/M/yyyy), locale française
                     sans "format:", utilise defaultDateFormat du profil

Les modificateurs s'appliquent dans l'ordre d'écriture — [lowercase, capitalize] ≠ [capitalize, lowercase].

Référence à une sortie déjà générée (mail uniquement — to/cc/subject/corps) :
  {{link:gdocs[0]}}
  {{link:pdf[0]}}

Exemple :
  {{nom:string[required, uppercase]}} {{date:date[required, format:MMMM yyyy]}}
  → DUPONT juillet 2026
`;

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
