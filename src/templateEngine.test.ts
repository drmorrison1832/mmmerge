import { describe, expect, it } from 'vitest';
import { resolveTemplateTags, renderTemplateString } from './templateEngine.js';
import { ModuleError, type FileOutput } from './pipeline/rowContext.js';

// 21 juillet 2026, exprimé en numéro de série Google Sheets (jours depuis le 30/12/1899).
const SERIAL_2026_07_21 = 46224;

describe('resolveTemplateTags', () => {
  it('résout une balise simple par colonne', () => {
    const [tag] = resolveTemplateTags('gdocs[0]', 'Bonjour {{Prenom}}', { Prenom: 'Marie' }, 'd/M/yyyy');
    expect(tag).toEqual({ fullMatch: '{{Prenom}}', value: 'Marie' });
  });

  it("respecte l'exemple de specs.md §3 (modificateurs enchaînés, string et date)", () => {
    const template =
      '{{nom:string[required, uppercase]}} {{pronom:string[required, uppercase, initial]}} ' +
      '{{date:date[required, format:MMMM, lowercase]}} {{date:date[required, format:yyyy]}}';
    const rawData = { nom: 'Dupont', pronom: 'Marie', date: String(SERIAL_2026_07_21) };

    const tags = resolveTemplateTags('gdocs[0]', template, rawData, 'd/M/yyyy');
    const rendered = tags.reduce((acc, tag) => acc.replace(tag.fullMatch, tag.value), template);

    expect(rendered).toBe('DUPONT M. juillet 2026');
  });

  it("l'ordre des modificateurs change le résultat (lowercase puis capitalize ≠ capitalize puis lowercase)", () => {
    const rawData = { Nom: 'MARIE' };
    const [lowercaseFirst] = resolveTemplateTags('gdocs[0]', '{{Nom[lowercase, capitalize]}}', rawData, 'd/M/yyyy');
    const [capitalizeFirst] = resolveTemplateTags('gdocs[0]', '{{Nom[capitalize, lowercase]}}', rawData, 'd/M/yyyy');

    expect(lowercaseFirst.value).toBe('Marie');
    expect(capitalizeFirst.value).toBe('marie');
  });

  it('capitalize gère les caractères accentués', () => {
    const [tag] = resolveTemplateTags('gdocs[0]', "{{Nom[capitalize]}}", { Nom: "élodie d'artagnan" }, 'd/M/yyyy');
    expect(tag.value).toBe("Élodie D'Artagnan");
  });

  it('applique defaultDateFormat quand aucun modificateur format: n\'est présent', () => {
    const [tag] = resolveTemplateTags(
      'gdocs[0]',
      '{{Date:date}}',
      { Date: String(SERIAL_2026_07_21) },
      'd/M/yyyy',
    );
    expect(tag.value).toBe('21/7/2026');
  });

  it('cellule vide sans required → chaîne vide (y compris pour une colonne de type date)', () => {
    const [tag] = resolveTemplateTags('gdocs[0]', '{{Date:date}}', { Date: '' }, 'd/M/yyyy');
    expect(tag.value).toBe('');
  });

  it('cellule vide avec required → erreur', () => {
    expect(() => resolveTemplateTags('gdocs[0]', '{{Nom[required]}}', { Nom: '' }, 'd/M/yyyy')).toThrow(ModuleError);
  });

  it('colonne absente du tableau → erreur', () => {
    expect(() => resolveTemplateTags('gdocs[0]', '{{Inconnue}}', {}, 'd/M/yyyy')).toThrow(/absente/);
  });

  it('modificateur inconnu → erreur', () => {
    expect(() => resolveTemplateTags('gdocs[0]', '{{Nom[bogus]}}', { Nom: 'x' }, 'd/M/yyyy')).toThrow(/bogus/);
  });

  it('modificateur "format" sur un type string → erreur', () => {
    expect(() => resolveTemplateTags('gdocs[0]', '{{Nom:string[format:yyyy]}}', { Nom: 'x' }, 'd/M/yyyy')).toThrow(
      /incompatible/,
    );
  });

  it('modificateur "initial" sur un type date → erreur', () => {
    expect(() =>
      resolveTemplateTags('gdocs[0]', '{{Date:date[initial]}}', { Date: String(SERIAL_2026_07_21) }, 'd/M/yyyy'),
    ).toThrow(/incompatible/);
  });

  it('type déclaré inconnu → erreur', () => {
    expect(() => resolveTemplateTags('gdocs[0]', '{{Nom:number}}', { Nom: 'x' }, 'd/M/yyyy')).toThrow(/type/);
  });

  it('valeur non numérique pour une balise date → erreur explicite', () => {
    expect(() =>
      resolveTemplateTags('gdocs[0]', '{{Date:date}}', { Date: '27/06/2026' }, 'd/M/yyyy'),
    ).toThrow(/texte brut/);
  });

  it('une balise répétée produit une entrée par occurrence', () => {
    const tags = resolveTemplateTags('gdocs[0]', '{{Nom}} et encore {{Nom}}', { Nom: 'x' }, 'd/M/yyyy');
    expect(tags).toHaveLength(2);
  });
});

describe('prefix(...)/suffix(...) (modificateurs conditionnels — appliqués seulement si la valeur est non vide)', () => {
  it('prefix(...) ajoute un préfixe uniquement si la valeur est non vide', () => {
    const [withValue] = resolveTemplateTags('gdocs[0]', '{{Prenom2[prefix( )]}}', { Prenom2: 'Sébastien' }, 'd/M/yyyy');
    const [withoutValue] = resolveTemplateTags('gdocs[0]', '{{Prenom2[prefix( )]}}', { Prenom2: '' }, 'd/M/yyyy');

    expect(withValue.value).toBe(' Sébastien');
    expect(withoutValue.value).toBe('');
  });

  it('suffix(...) ajoute un suffixe uniquement si la valeur est non vide', () => {
    const [tag] = resolveTemplateTags('gdocs[0]', '{{Tel[suffix( (mobile))]}}', { Tel: '0600000000' }, 'd/M/yyyy');
    expect(tag.value).toBe('0600000000 (mobile)');
  });

  it("résout le cas d'origine (prénoms multiples optionnels, sans espaces doubles ni orphelins)", () => {
    const template = '{{prenom1}}{{prenom2[prefix( )]}}{{prenom3[prefix( )]}} {{nom}}';
    const render = (rawData: Record<string, string>) => {
      const tags = resolveTemplateTags('gdocs[0]', template, rawData, 'd/M/yyyy');
      return tags.reduce((acc, tag) => acc.replace(tag.fullMatch, tag.value), template);
    };

    expect(render({ prenom1: 'Étienne', prenom2: 'Sébastien', prenom3: 'Paul', nom: 'Dupont' })).toBe(
      'Étienne Sébastien Paul Dupont',
    );
    expect(render({ prenom1: 'Étienne', prenom2: '', prenom3: 'Paul', nom: 'Dupont' })).toBe('Étienne Paul Dupont');
    expect(render({ prenom1: 'Étienne', prenom2: 'Sébastien', prenom3: '', nom: 'Dupont' })).toBe(
      'Étienne Sébastien Dupont',
    );
  });

  it("se combine avec d'autres modificateurs, y compris à une position non finale — l'ordre change le résultat", () => {
    const [prefixFirst] = resolveTemplateTags('gdocs[0]', '{{Nom[prefix(monsieur ), uppercase]}}', { Nom: 'dupont' }, 'd/M/yyyy');
    const [uppercaseFirst] = resolveTemplateTags('gdocs[0]', '{{Nom[uppercase, prefix(monsieur )]}}', { Nom: 'dupont' }, 'd/M/yyyy');

    expect(prefixFirst.value).toBe('MONSIEUR DUPONT'); // préfixe ajouté avant uppercase → lui aussi majusculé
    expect(uppercaseFirst.value).toBe('monsieur DUPONT'); // préfixe ajouté après uppercase → jamais majusculé
  });

  it('tolère une virgule littérale à l\'intérieur du contenu', () => {
    const [tag] = resolveTemplateTags('gdocs[0]', '{{Nom[prefix(Bonjour, )]}}', { Nom: 'Marie' }, 'd/M/yyyy');
    expect(tag.value).toBe('Bonjour, Marie');
  });

  it('prefix(...) et suffix(...) se combinent librement, et tolèrent des parenthèses dans leur propre contenu', () => {
    const [tag] = resolveTemplateTags(
      'gdocs[0]',
      '{{Tel[prefix(Tél: ), suffix( (mobile))]}}',
      { Tel: '0600000000' },
      'd/M/yyyy',
    );
    expect(tag.value).toBe('Tél: 0600000000 (mobile)');
  });

  it('contenu vide toléré (no-op)', () => {
    const [tag] = resolveTemplateTags('gdocs[0]', '{{Nom[prefix()]}}', { Nom: 'Marie' }, 'd/M/yyyy');
    expect(tag.value).toBe('Marie');
  });

  it('lève une erreur explicite si les parenthèses ne sont pas équilibrées', () => {
    expect(() =>
      resolveTemplateTags('gdocs[0]', '{{Nom[prefix(M. ]}}', { Nom: 'x' }, 'd/M/yyyy'),
    ).toThrow(/parenthèses non équilibrées/);
  });

  it("prefix(...) seul (sans required) n'affecte pas une cellule vide", () => {
    const [tag] = resolveTemplateTags('gdocs[0]', '{{Nom[prefix(M. )]}}', { Nom: '' }, 'd/M/yyyy');
    expect(tag.value).toBe('');
  });
});

describe('renderTemplateString', () => {
  it('substitue les balises directement dans la chaîne', () => {
    const result = renderTemplateString('mail[0]', 'Bonjour {{Prenom}}, à bientôt.', { Prenom: 'Marie' }, {}, 'd/M/yyyy');
    expect(result).toBe('Bonjour Marie, à bientôt.');
  });

  it('résout {{link:...}} vers l\'URL de la sortie référencée', () => {
    const outputs = { 'pdf[0]': { filename: 'CDDU', url: 'https://drive.example/abc', createdAt: '2026-07-21T00:00:00Z' } as FileOutput };
    const result = renderTemplateString('mail[0]', 'Voici : {{link:pdf[0]}}', {}, outputs, 'd/M/yyyy');
    expect(result).toBe('Voici : https://drive.example/abc');
  });

  it('{{link:...}} vers une référence absente des sorties → erreur', () => {
    expect(() => renderTemplateString('mail[0]', '{{link:pdf[0]}}', {}, {}, 'd/M/yyyy')).toThrow(/référence introuvable/);
  });

  it('combine {{link:...}} et des balises de colonnes dans le même texte', () => {
    const outputs = { 'gdocs[0]': { filename: 'CDDU', url: 'https://docs.example/xyz', createdAt: '2026-07-21T00:00:00Z' } as FileOutput };
    const result = renderTemplateString(
      'mail[0]',
      'Bonjour {{Prenom}}, votre document : {{link:gdocs[0]}}',
      { Prenom: 'Marie' },
      outputs,
      'd/M/yyyy',
    );
    expect(result).toBe('Bonjour Marie, votre document : https://docs.example/xyz');
  });

  it('cellule vide avec required → erreur, comme pour resolveTemplateTags', () => {
    expect(() => renderTemplateString('mail[0]', '{{Nom[required]}}', { Nom: '' }, {}, 'd/M/yyyy')).toThrow(ModuleError);
  });
});
