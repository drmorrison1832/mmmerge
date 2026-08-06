/**
 * Vérifie que chaque profil d'exemple sous configs/ charge sans erreur de schéma —
 * ces fichiers sont de la documentation vivante (readme.md), pas juste des fixtures
 * de test : un profil qui ne charge plus signale une dérive du schéma à corriger.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig } from './loader.js';

const EXAMPLE_PROFILES = [
  'gdocsExempleBasic',
  'gdocsExempleAdvanced',
  'pdfExempleBasic',
  'pdfExempleAdvanced',
  'mailExempleBasic',
  'mailExempleAdvanced',
  'columnsExempleBasic',
  'columnsExempleAdvanced',
  'json2columnsExempleBasic',
  'json2columnsExempleAdvanced',
  'multiModuleExemple',
];

describe('profils d\'exemple (configs/)', () => {
  it.each(EXAMPLE_PROFILES)('%s charge sans erreur', (profileName) => {
    expect(() => loadConfig(profileName, [])).not.toThrow();
  });
});
