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

describe('loadConfig', () => {
  afterEach(() => {
    removeFixture('__test-json-invalide');
    removeFixture('__test-zod-invalide');
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
});
