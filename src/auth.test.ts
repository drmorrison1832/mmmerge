import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { persistToken, readClientCredentials, readStoredToken } from './auth.js';

// Fixtures écrites dans un dossier temporaire isolé — jamais dans le vrai credentials.json/token.json
// du projet (fichiers sensibles, gitignorés, potentiellement déjà présents chez le développeur).
let workDir: string;

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function freshWorkDir(): string {
  workDir = mkdtempSync(join(tmpdir(), 'mmmerge-auth-test-'));
  return workDir;
}

describe('readClientCredentials', () => {
  it('lit client_id/client_secret depuis un credentials.json valide', () => {
    const dir = freshWorkDir();
    const path = join(dir, 'credentials.json');
    writeFileSync(path, JSON.stringify({ installed: { client_id: 'abc', client_secret: 'shh' } }));

    expect(readClientCredentials(path)).toEqual({ client_id: 'abc', client_secret: 'shh' });
  });

  it('lève une erreur explicite si le fichier est introuvable', () => {
    const dir = freshWorkDir();
    expect(() => readClientCredentials(join(dir, 'absent.json'))).toThrow(/introuvable/);
  });

  it('lève une erreur explicite si le JSON est invalide', () => {
    const dir = freshWorkDir();
    const path = join(dir, 'credentials.json');
    writeFileSync(path, '{ "installed": ');

    expect(() => readClientCredentials(path)).toThrow(/JSON invalide/);
  });

  it('lève une erreur explicite si client_id ou client_secret est manquant', () => {
    const dir = freshWorkDir();
    const path = join(dir, 'credentials.json');
    writeFileSync(path, JSON.stringify({ installed: { client_id: 'abc' } }));

    expect(() => readClientCredentials(path)).toThrow(/manquants/);
  });
});

describe('readStoredToken', () => {
  it('retourne le contenu parsé si le fichier existe et est valide', () => {
    const dir = freshWorkDir();
    const path = join(dir, 'token.json');
    writeFileSync(path, JSON.stringify({ refresh_token: 'r', access_token: 'a' }));

    expect(readStoredToken(path)).toEqual({ refresh_token: 'r', access_token: 'a' });
  });

  it('retourne null si le fichier est absent (pas d\'erreur — déclenche juste une reconnexion)', () => {
    const dir = freshWorkDir();
    expect(readStoredToken(join(dir, 'absent.json'))).toBeNull();
  });

  it('retourne null si le JSON est invalide', () => {
    const dir = freshWorkDir();
    const path = join(dir, 'token.json');
    writeFileSync(path, 'pas du json');

    expect(readStoredToken(path)).toBeNull();
  });
});

describe('persistToken', () => {
  it('écrit le token au format JSON lisible, relisible ensuite', () => {
    const dir = freshWorkDir();
    const path = join(dir, 'token.json');
    const tokens = { refresh_token: 'r', access_token: 'a', expiry_date: 123 };

    persistToken(tokens, path);

    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(tokens);
  });
});
