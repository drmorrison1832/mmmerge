/**
 * Résolution des balises {{variable}} — deux fonctions de sortie, un moteur commun.
 * Voir architecture.md §3.
 */
import { formatDate } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ModuleError, type FileOutput, type MailOutput } from './pipeline/rowContext.js';

export type ResolvedTag = { fullMatch: string; value: string };

const TEMPLATE_TAG_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*(?::\s*([a-zA-Z]+))?\s*(?:\[([^\]]*)\])?\s*\}\}/g;
const LINK_TAG_PATTERN = /\{\{link:([a-zA-Z]+\[\d+\])\}\}/g;

function parseSheetDate(moduleName: string, name: string, rawValue: string): Date {
  const serial = Number(rawValue);
  if (Number.isNaN(serial)) {
    throw new ModuleError(
      moduleName,
      `Balise {{${name}}} : la valeur ne correspond pas à une date Sheets native (cellule formatée en texte brut ?)`,
    );
  }
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function parseSheetNumber(moduleName: string, name: string, rawValue: string): number {
  const parsed = Number(rawValue);
  if (Number.isNaN(parsed)) {
    throw new ModuleError(
      moduleName,
      `Balise {{${name}}} : la valeur ne correspond pas à un nombre (cellule formatée en texte brut ?)`,
    );
  }
  return parsed;
}

function formatNumberFr(value: number, decimals?: number, noGroup = false): string {
  return new Intl.NumberFormat('fr-FR', {
    useGrouping: !noGroup,
    ...(decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  }).format(value);
}

/** Vrai si la valeur, arrondie au centime le plus proche, a des centimes non nuls. */
function hasNonZeroCents(value: number): boolean {
  const cents = Math.round((value + Number.EPSILON) * 100);
  return cents % 100 !== 0;
}

/**
 * Format euro français : 0 décimale si la valeur est un montant rond, sinon 2 —
 * sauf si `decimals` est fourni explicitement (modificateur format:<n>), auquel cas
 * il prime toujours sur cette règle automatique. `noGroup` (modificateur nospace)
 * retire uniquement le séparateur de milliers — l'espace insécable avant "€" reste.
 */
function formatEuro(value: number, decimals?: number, noGroup = false): string {
  const fractionDigits = decimals ?? (hasNonZeroCents(value) ? 2 : 0);
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    useGrouping: !noGroup,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function applyModifiers(
  moduleName: string,
  name: string,
  type: string,
  modifiers: string[],
  rawValue: string,
  defaultDateFormat: string,
): string {
  const parsedDate = type === 'date' ? parseSheetDate(moduleName, name, rawValue) : null;
  const parsedNumber = type === 'number' || type === 'euro' ? parseSheetNumber(moduleName, name, rawValue) : null;
  // nospace n'est pas un modificateur "positionnel" comme les autres : il modifie le même appel
  // Intl.NumberFormat que format:<n>, donc il est résolu une fois pour toutes ici (comme required),
  // plutôt que d'être appliqué à sa position dans la liste — nospace et format:<n> se combinent
  // dans n'importe quel ordre.
  const noGroup = modifiers.includes('nospace');

  // Pour date/number/euro, la valeur de départ est déjà mise en forme (format par défaut) —
  // pas la valeur brute — pour que prefix(...)/suffix(...) sans format: explicite
  // s'appliquent au texte réellement affiché plutôt que d'être écrasés en fin de parcours.
  let value = rawValue;
  if (type === 'date') value = formatDate(parsedDate!, defaultDateFormat, { locale: fr });
  if (type === 'number') value = formatNumberFr(parsedNumber!, undefined, noGroup);
  if (type === 'euro') value = formatEuro(parsedNumber!, undefined, noGroup);

  for (const modifier of modifiers) {
    if (modifier === 'required') continue;
    if (modifier === 'nospace') {
      if (type !== 'number' && type !== 'euro') {
        throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "nospace" incompatible avec le type "${type}"`);
      }
      continue;
    }
    if (modifier.startsWith('format:')) {
      const arg = modifier.slice('format:'.length);
      if (type === 'date') {
        value = formatDate(parsedDate!, arg, { locale: fr });
      } else if (type === 'number' || type === 'euro') {
        const decimals = Number(arg);
        if (!Number.isInteger(decimals) || decimals < 0) {
          throw new ModuleError(
            moduleName,
            `Balise {{${name}}} : modificateur "format:${arg}" invalide pour le type "${type}" (attendu un nombre entier de décimales, ex: format:2)`,
          );
        }
        value =
          type === 'number' ? formatNumberFr(parsedNumber!, decimals, noGroup) : formatEuro(parsedNumber!, decimals, noGroup);
      } else {
        throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "format" incompatible avec le type "${type}"`);
      }
    } else if (modifier === 'initial') {
      if (type !== 'string') {
        throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "initial" incompatible avec le type "${type}"`);
      }
      value = value.charAt(0).toUpperCase() + '.';
    } else if (modifier === 'capitalize') {
      value = value.replace(/(^|[\s\-'])(\p{L})/gu, (_match, sep, letter) => sep + letter.toUpperCase());
    } else if (modifier === 'uppercase') {
      value = value.toUpperCase();
    } else if (modifier === 'lowercase') {
      value = value.toLowerCase();
    } else if (modifier.startsWith('prefix(') && modifier.endsWith(')')) {
      value = modifier.slice('prefix('.length, -1) + value;
    } else if (modifier.startsWith('suffix(') && modifier.endsWith(')')) {
      value = value + modifier.slice('suffix('.length, -1);
    } else {
      throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "${modifier}" inconnu`);
    }
  }

  return value;
}

/**
 * Découpe la liste de modificateurs sur les virgules, sauf celles à l'intérieur de
 * parenthèses (contenu de prefix(...)/suffix(...)) — permet une virgule littérale dans
 * ce contenu, ex: prefix(Bonjour, ). Erreur explicite si les parenthèses ne s'équilibrent pas.
 */
function splitModifiersRespectingParens(moduleName: string, name: string, modifiersRaw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of modifiersRaw) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  if (depth !== 0) {
    throw new ModuleError(moduleName, `Balise {{${name}}} : parenthèses non équilibrées dans les modificateurs.`);
  }

  return parts;
}

function parseModifiers(moduleName: string, name: string, modifiersRaw: string | undefined): string[] {
  if (!modifiersRaw) return [];
  return splitModifiersRespectingParens(moduleName, name, modifiersRaw)
    .map((modifier) => modifier.trim())
    .filter((modifier) => modifier.length > 0);
}

/** Logique de résolution partagée par `resolveTemplateTags` et `renderTemplateString`. */
function resolveTagValue(
  moduleName: string,
  name: string,
  typeRaw: string | undefined,
  modifiersRaw: string | undefined,
  rawData: Record<string, string>,
  defaultDateFormat: string,
): string {
  if (!(name in rawData)) {
    throw new ModuleError(moduleName, `Balise {{${name}}} : colonne "${name}" absente du tableau`);
  }

  const type = typeRaw ?? 'string';
  if (type !== 'string' && type !== 'date' && type !== 'number' && type !== 'euro') {
    throw new ModuleError(moduleName, `Balise {{${name}}} : type "${type}" inconnu`);
  }

  const modifiers = parseModifiers(moduleName, name, modifiersRaw);
  const rawValue = rawData[name];

  // Cellule vide : court-circuite avant tout parsing (notamment le parsing de date,
  // pour lequel Number('') vaudrait 0 et non NaN).
  if (rawValue === '') {
    if (modifiers.includes('required')) {
      throw new ModuleError(moduleName, `Balise {{${name}}} : valeur requise, cellule vide`);
    }
    return '';
  }

  return applyModifiers(moduleName, name, type, modifiers, rawValue, defaultDateFormat);
}

export function resolveTemplateTags(
  moduleName: string,
  templateContent: string,
  rawData: Record<string, string>,
  defaultDateFormat: string,
): ResolvedTag[] {
  return [...templateContent.matchAll(TEMPLATE_TAG_PATTERN)].map((match) => {
    const [fullMatch, name, type, modifiersRaw] = match;
    const value = resolveTagValue(moduleName, name, type, modifiersRaw, rawData, defaultDateFormat);
    return { fullMatch, value };
  });
}

export function renderTemplateString(
  moduleName: string,
  template: string,
  rawData: Record<string, string>,
  outputs: Record<string, FileOutput | MailOutput>,
  defaultDateFormat: string,
): string {
  const withLinksResolved = template.replace(LINK_TAG_PATTERN, (_fullMatch, ref: string) => {
    const output = outputs[ref];
    if (!output) {
      throw new ModuleError(moduleName, `{{link:${ref}}} : référence introuvable dans les sorties générées`);
    }
    return output.url;
  });

  return withLinksResolved.replace(
    TEMPLATE_TAG_PATTERN,
    (_fullMatch, name: string, type: string | undefined, modifiersRaw: string | undefined) =>
      resolveTagValue(moduleName, name, type, modifiersRaw, rawData, defaultDateFormat),
  );
}
