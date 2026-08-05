import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './loader.js';

const CONFIGS_DIR = join(process.cwd(), 'configs');

function writeFixture(name: string, content: string): void {
  if (!existsSync(CONFIGS_DIR)) mkdirSync(CONFIGS_DIR, { recursive: true });
  writeFileSync(join(CONFIGS_DIR, `${name}.json`), content, 'utf-8');
}

function removeFixture(name: string): void {
  rmSync(join(CONFIGS_DIR, `${name}.json`), { force: true });
}

function baseProfileFields(): Record<string, unknown> {
  return { sheetId: 'sheet-id', sheetTabName: 'Contrats' };
}

describe('loadConfig', () => {
  afterEach(() => {
    removeFixture('__test-json-invalide');
    removeFixture('__test-zod-invalide');
    removeFixture('__test-disable-defaut');
    removeFixture('__test-disable-generated');
    removeFixture('__test-disable-link');
    removeFixture('__test-template-link');
    removeFixture('__test-filter-valide');
    removeFixture('__test-filter-match-invalide');
    removeFixture('__test-filter-conditions-vide');
    removeFixture('__test-columns-valide');
    removeFixture('__test-columns-reserved');
    removeFixture('__test-link-column');
    removeFixture('__test-link-column-reserved');
  });

  it('charge le profil "exemple" et applique les valeurs par défaut absentes du fichier', () => {
    const config = loadConfig('exemple', []);

    expect(config.sheetId).toBe('1AbCDeFGhIJKlmNoPQRstuVwxYZ0123456789abcdefghij');
    expect(config.sheetTabName).toBe('Contrats');
    expect(config.autoCreateFolders).toBe(true);
    expect(config.defaultDateFormat).toBe('d/M/yyyy');
    expect(config.gdocs).toHaveLength(1);
    expect(config.pdf).toHaveLength(1);
    expect(config.mail).toHaveLength(1);
  });

  it('un override CLI (--autoCreateFolders=false) prend le pas sur le défaut du schéma', () => {
    const config = loadConfig('exemple', ['--autoCreateFolders=false']);
    expect(config.autoCreateFolders).toBe(false);
  });

  it('un override CLI (--sheetId=...) prend le pas sur la valeur du profil', () => {
    const config = loadConfig('exemple', ['--sheetId=OVERRIDDEN']);
    expect(config.sheetId).toBe('OVERRIDDEN');
  });

  it('lève une erreur explicite si le fichier de profil est introuvable', () => {
    expect(() => loadConfig('ce-profil-n-existe-pas', [])).toThrow(/introuvable/);
  });

  it('lève une erreur explicite si le JSON du profil est invalide', () => {
    writeFixture('__test-json-invalide', '{ "sheetId": ');
    expect(() => loadConfig('__test-json-invalide', [])).toThrow(/JSON invalide/);
  });

  it('lève une erreur listant les problèmes si la validation Zod échoue', () => {
    writeFixture('__test-zod-invalide', JSON.stringify({ sheetId: 'x' }));
    expect(() => loadConfig('__test-zod-invalide', [])).toThrow(/sheetTabName/);
  });

  it('"disable" vaut false par défaut, une instance désactivée non référencée charge sans erreur', () => {
    writeFixture(
      '__test-disable-defaut',
      JSON.stringify({
        ...baseProfileFields(),
        gdocs: [{ template_id: 't', output_folder_id: 'f', output_filename: 'n' }],
        pdf: [{ disable: true, template_id: 't2', output_folder_id: 'f2', output_filename: 'n2' }],
      }),
    );
    const config = loadConfig('__test-disable-defaut', []);
    expect(config.gdocs[0].disable).toBe(false);
    expect(config.pdf[0].disable).toBe(true);
  });

  it('"link_column" est absent par défaut, et accepte un nom de colonne choisi par l\'utilisateur sur gdocs/pdf/mail', () => {
    writeFixture(
      '__test-link-column',
      JSON.stringify({
        ...baseProfileFields(),
        gdocs: [{ template_id: 't', output_folder_id: 'f', output_filename: 'n' }],
        pdf: [{ link_column: 'Lien PDF', template_id: 't2', output_folder_id: 'f2', output_filename: 'n2' }],
        mail: [
          {
            link_column: 'Lien mail',
            to: '{{Email}}',
            subject: 'x',
            template_html: '<p>x</p>',
            draft_only: true,
            attach: 'none',
          },
        ],
      }),
    );
    const config = loadConfig('__test-link-column', []);
    expect(config.gdocs[0].link_column).toBeUndefined();
    expect(config.pdf[0].link_column).toBe('Lien PDF');
    expect(config.mail[0].link_column).toBe('Lien mail');
  });

  it('"link_column" ne peut pas cibler une colonne système réservée', () => {
    writeFixture(
      '__test-link-column-reserved',
      JSON.stringify({
        ...baseProfileFields(),
        pdf: [{ link_column: 'mmm_outputs', template_id: 't', output_folder_id: 'f', output_filename: 'n' }],
      }),
    );
    expect(() => loadConfig('__test-link-column-reserved', [])).toThrow(/mmm_outputs.*réservée/s);
  });

  it('mail[].generated référençant une instance pdf[] désactivée → erreur explicite', () => {
    writeFixture(
      '__test-disable-generated',
      JSON.stringify({
        ...baseProfileFields(),
        pdf: [{ disable: true, template_id: 't', output_folder_id: 'f', output_filename: 'n' }],
        mail: [
          {
            to: '{{Email}}',
            subject: 'x',
            template_html: '<p>x</p>',
            draft_only: true,
            attach: 'generated',
            generated: ['pdf[0]'],
          },
        ],
      }),
    );
    expect(() => loadConfig('__test-disable-generated', [])).toThrow(/pdf\[0\].*désactivée/);
  });

  it('{{link:...}} référençant une instance gdocs[] désactivée → erreur explicite', () => {
    writeFixture(
      '__test-disable-link',
      JSON.stringify({
        ...baseProfileFields(),
        gdocs: [{ disable: true, template_id: 't', output_folder_id: 'f', output_filename: 'n' }],
        mail: [
          {
            to: '{{Email}}',
            subject: 'x',
            template_html: '<p>Voici : {{link:gdocs[0]}}</p>',
            draft_only: true,
            attach: 'none',
          },
        ],
      }),
    );
    expect(() => loadConfig('__test-disable-link', [])).toThrow(/gdocs\[0\].*désactivée/);
  });

  it('"template_link" (gdocs/pdf) est accepté, purement informatif, jamais requis', () => {
    writeFixture(
      '__test-template-link',
      JSON.stringify({
        ...baseProfileFields(),
        gdocs: [
          {
            template_id: 't',
            template_link: 'https://docs.google.com/document/d/t/edit',
            output_folder_id: 'f',
            output_filename: 'n',
          },
        ],
        pdf: [{ template_id: 't2', output_folder_id: 'f2', output_filename: 'n2' }],
      }),
    );
    const config = loadConfig('__test-template-link', []);
    expect(config.gdocs[0].template_link).toBe('https://docs.google.com/document/d/t/edit');
    expect(config.pdf[0].template_link).toBeUndefined();
  });

  it('"filter" (multi-conditions, match "all") est accepté et chargé tel quel', () => {
    writeFixture(
      '__test-filter-valide',
      JSON.stringify({
        ...baseProfileFields(),
        gdocs: [
          {
            template_id: 't',
            output_folder_id: 'f',
            output_filename: 'n',
            filter: {
              match: 'all',
              conditions: [
                { label: 'Statut', criterium: 'equals', value: 'Actif' },
                { label: 'Type', criterium: 'equals', value: 'CDD' },
              ],
            },
          },
        ],
      }),
    );
    const config = loadConfig('__test-filter-valide', []);
    expect(config.gdocs[0].filter).toEqual({
      match: 'all',
      conditions: [
        { label: 'Statut', criterium: 'equals', value: 'Actif' },
        { label: 'Type', criterium: 'equals', value: 'CDD' },
      ],
    });
  });

  it('"filter.match" doit être "all", "any" ou "none" — une valeur arbitraire est rejetée', () => {
    writeFixture(
      '__test-filter-match-invalide',
      JSON.stringify({
        ...baseProfileFields(),
        gdocs: [
          {
            template_id: 't',
            output_folder_id: 'f',
            output_filename: 'n',
            filter: { match: 'quelconque', conditions: [{ label: 'Statut', criterium: 'equals', value: 'Actif' }] },
          },
        ],
      }),
    );
    expect(() => loadConfig('__test-filter-match-invalide', [])).toThrow(/match/);
  });

  it('"filter.conditions" ne peut pas être vide (au moins une condition requise)', () => {
    writeFixture(
      '__test-filter-conditions-vide',
      JSON.stringify({
        ...baseProfileFields(),
        gdocs: [
          { template_id: 't', output_folder_id: 'f', output_filename: 'n', filter: { match: 'all', conditions: [] } },
        ],
      }),
    );
    expect(() => loadConfig('__test-filter-conditions-vide', [])).toThrow(/conditions/);
  });

  it('"columns" (template + output_column) est accepté et chargé tel quel', () => {
    writeFixture(
      '__test-columns-valide',
      JSON.stringify({
        ...baseProfileFields(),
        columns: [{ template: '{{Prenom}} {{Nom}}', output_column: 'NomComplet' }],
      }),
    );
    const config = loadConfig('__test-columns-valide', []);
    expect(config.columns[0]).toMatchObject({ template: '{{Prenom}} {{Nom}}', output_column: 'NomComplet', disable: false });
  });

  it('"columns[].output_column" ne peut pas cibler une colonne système réservée', () => {
    writeFixture(
      '__test-columns-reserved',
      JSON.stringify({
        ...baseProfileFields(),
        columns: [{ template: '{{Nom}}', output_column: 'mmm_status' }],
      }),
    );
    expect(() => loadConfig('__test-columns-reserved', [])).toThrow(/mmm_status.*réservée/s);
  });
});
