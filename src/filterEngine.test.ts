import { describe, expect, it } from 'vitest';
import { matchesFilter } from './filterEngine.js';
import { ModuleError } from './pipeline/rowContext.js';
import type { Filter } from './config/schema.js';

describe('matchesFilter', () => {
  it('retourne true sans filtre configuré', () => {
    expect(matchesFilter('gdocs[0]', undefined, {})).toBe(true);
  });

  describe('match: "all"', () => {
    it('true si toutes les conditions sont satisfaites (colonnes différentes)', () => {
      const filter: Filter = {
        match: 'all',
        conditions: [
          { label: 'Statut', criterium: 'equals', value: 'Actif' },
          { label: 'Type', criterium: 'equals', value: 'CDD' },
        ],
      };
      expect(matchesFilter('gdocs[0]', filter, { Statut: 'Actif', Type: 'CDD' })).toBe(true);
      expect(matchesFilter('gdocs[0]', filter, { Statut: 'Actif', Type: 'CDI' })).toBe(false);
    });
  });

  describe('match: "any"', () => {
    it('true si au moins une condition est satisfaite (ex: valeur parmi plusieurs, même colonne)', () => {
      const filter: Filter = {
        match: 'any',
        conditions: [
          { label: 'Type', criterium: 'equals', value: 'CDD' },
          { label: 'Type', criterium: 'equals', value: 'CDI' },
        ],
      };
      expect(matchesFilter('gdocs[0]', filter, { Type: 'CDD' })).toBe(true);
      expect(matchesFilter('gdocs[0]', filter, { Type: 'CDI' })).toBe(true);
      expect(matchesFilter('gdocs[0]', filter, { Type: 'Stage' })).toBe(false);
    });
  });

  describe('match: "none"', () => {
    it("true si aucune condition n'est satisfaite (négation de \"any\")", () => {
      const filter: Filter = {
        match: 'none',
        conditions: [
          { label: 'Type', criterium: 'equals', value: 'CDD' },
          { label: 'Type', criterium: 'equals', value: 'CDI' },
        ],
      };
      expect(matchesFilter('gdocs[0]', filter, { Type: 'Stage' })).toBe(true);
      expect(matchesFilter('gdocs[0]', filter, { Type: 'CDD' })).toBe(false);
    });
  });

  it('comparaison stricte (sensible à la casse, aucun trim)', () => {
    const filter: Filter = { match: 'all', conditions: [{ label: 'Type', criterium: 'equals', value: 'CDD' }] };
    expect(matchesFilter('gdocs[0]', filter, { Type: 'cdd' })).toBe(false);
    expect(matchesFilter('gdocs[0]', filter, { Type: ' CDD' })).toBe(false);
    expect(matchesFilter('gdocs[0]', filter, { Type: 'CDD' })).toBe(true);
  });

  it('lève une ModuleError explicite si la colonne référencée est absente du tableau', () => {
    const filter: Filter = { match: 'all', conditions: [{ label: 'Inconnue', criterium: 'equals', value: 'x' }] };
    expect(() => matchesFilter('gdocs[0]', filter, { Type: 'CDD' })).toThrow(ModuleError);
    expect(() => matchesFilter('gdocs[0]', filter, { Type: 'CDD' })).toThrow(/colonne "Inconnue" absente/);
  });
});
