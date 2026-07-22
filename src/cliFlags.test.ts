import { describe, expect, it } from 'vitest';
import { parseLines, HELP_TEMPLATES } from './cliFlags.js';

describe('parseLines', () => {
  it('retourne undefined si --lines est absent', () => {
    expect(parseLines(undefined)).toBeUndefined();
  });

  it('parse une liste de numéros séparés par des virgules', () => {
    expect(parseLines('4,14,15')).toEqual([4, 14, 15]);
  });

  it('tolère les espaces autour des virgules', () => {
    expect(parseLines('4, 14 , 15')).toEqual([4, 14, 15]);
  });

  it('parse une valeur unique', () => {
    expect(parseLines('4')).toEqual([4]);
  });

  it('lève une erreur explicite sur une valeur non entière', () => {
    expect(() => parseLines('abc')).toThrow(/valeur invalide/);
  });

  it('lève une erreur explicite sur une valeur inférieure à 1', () => {
    expect(() => parseLines('0')).toThrow(/valeur invalide/);
  });
});

describe('HELP_TEMPLATES', () => {
  it('documente la syntaxe des balises et des modificateurs clés', () => {
    expect(HELP_TEMPLATES).toContain('{{variable}}');
    expect(HELP_TEMPLATES).toContain('required');
    expect(HELP_TEMPLATES).toContain('format:<token>');
    expect(HELP_TEMPLATES).toContain('{{link:gdocs[0]}}');
  });
});
