/**
 * Vérifie que chaque profil d'exemple sous configs/exemples/ charge sans erreur de
 * schéma — ces fichiers sont de la documentation vivante (readme.md), pas juste des
 * fixtures de test : un profil qui ne charge plus signale une dérive du schéma à corriger.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig } from './loader.js';

const EXAMPLE_PROFILES = [
  'exemples/gdocsExempleBasic',
  'exemples/gdocsExempleAdvanced',
  'exemples/pdfExempleBasic',
  'exemples/pdfExempleAdvanced',
  'exemples/mailExempleBasic',
  'exemples/mailExempleAdvanced',
  'exemples/columnsExempleBasic',
  'exemples/columnsExempleAdvanced',
  'exemples/json2columnsExempleBasic',
  'exemples/json2columnsExempleAdvanced',
  'exemples/multiModuleExemple',
];

describe('profils d\'exemple (configs/exemples/)', () => {
  it.each(EXAMPLE_PROFILES)('%s charge sans erreur', (profileName) => {
    expect(() => loadConfig(profileName, [])).not.toThrow();
  });
});
