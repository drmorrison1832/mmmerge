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

  Tokens date-fns courants (mardi 21 juillet 2026, locale française) :
    d     jour du mois              21
    dd    jour du mois, 2 chiffres  21
    M     mois numérique            7
    MM    mois numérique, 2 chiffres 07
    MMM   mois abrégé               juil.
    MMMM  mois complet              juillet
    yy    année, 2 chiffres         26
    yyyy  année, 4 chiffres         2026
    EEE   jour semaine abrégé       mar.
    EEEE  jour semaine complet      mardi
    HH    heure (24h), 2 chiffres   14
    mm    minutes, 2 chiffres       32
    ss    secondes, 2 chiffres      05
  Combinables librement : format:EEEE d MMMM yyyy → mardi 21 juillet 2026
  Liste complète : https://date-fns.org/docs/format

Type "number" :
  format:<n>       - nombre fixe de décimales (ex: format:2)
                     sans "format:", format français par défaut (séparateur
                     milliers, virgule décimale) : 1123.43 → "1\u00A0123,43"
  nospace          - retire le séparateur de milliers (number ET euro,
                     voir plus bas) : 1123.43 → "1123,43" (pas de "1\u00A0123,43")

Type "euro" :
  format:<n>       - impose un nombre fixe de décimales (prioritaire sur la
                     règle automatique ci-dessous)
                     sans "format:" : 0 décimale si le montant est rond, 2 sinon
                     (ex: 12 → "12\u00A0€", 12,3 → "12,30\u00A0€", arrondi au centime)
                     séparateur milliers en espace fine insécable, ex: 1234.5 → "1\u202F234,50\u00A0€"
  nospace          - retire le séparateur de milliers, garde l'espace insécable
                     avant "€" : 1234.56 → "1234,56\u00A0€" (pas de "1\u202F234,56\u00A0€")
                     se combine avec format:<n> dans n'importe quel ordre —
                     seul modificateur non positionnel de la liste

prefix(texte) / suffix(texte) :
  ajoute "texte" avant/après la valeur, uniquement si la cellule n'est pas vide —
  pratique pour chaîner des champs optionnels sans espace double ni orphelin.
  Contenu pris à la lettre (espaces compris), peut contenir une virgule, peut
  apparaître à n'importe quelle position dans la liste de modificateurs.

Les modificateurs s'appliquent dans l'ordre d'écriture — [lowercase, capitalize] ≠ [capitalize, lowercase].

Référence à une sortie déjà générée (mail uniquement — to/cc/subject/corps) :
  {{link:gdocs[0]}}
  {{link:pdf[0]}}

Exemple :
  {{nom:string[required, uppercase]}} {{date:date[required, format:MMMM yyyy]}}
  → DUPONT juillet 2026

Exemple (nombre avec unité) :
  {{brut_total:number[required, suffix( €)]}}
  avec brut_total = 1123.43 → 1\u202F123,43 €

Exemple (montant en euros) :
  {{brut_total:euro[required]}}
  avec brut_total = 1123.43 → 1\u202F123,43\u00A0€

Exemple (euro sans espace, pour un champ qui les rejette) :
  {{brut_total:euro[required, nospace]}}
  avec brut_total = 1123.43 → 1123,43\u00A0€

Exemple (champs optionnels sans espaces doubles) :
  {{prenom1}}{{prenom2[prefix( )]}}{{prenom3[prefix( )]}} {{nom}}
  avec prenom2 vide → Étienne Paul Dupont (pas "Étienne  Paul Dupont")
`;

function parseLinesPart(part: string): number[] {
  const rangeMatch = part.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (start < 1 || end < start) {
      throw new Error(`--lines : plage invalide "${part}" (le début doit être ≥ 1 et inférieur ou égal à la fin).`);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  const n = Number(part);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `--lines : valeur invalide "${part}" (attendu un numéro de ligne entier, ou une plage "début-fin", séparés par des virgules).`,
    );
  }
  return [n];
}

export function parseLines(raw: unknown): number[] | undefined {
  if (raw === undefined) return undefined;
  return String(raw)
    .split(',')
    .map((part) => part.trim())
    .flatMap(parseLinesPart);
}
