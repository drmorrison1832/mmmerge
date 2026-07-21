/**
 * Flux OAuth2 Google (Desktop app), lecture/écriture de credentials.json et token.json.
 * Voir architecture.md §2.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { URL } from 'node:url';
import { google, type Auth } from 'googleapis';

const CREDENTIALS_PATH = join(process.cwd(), 'credentials.json');
const TOKEN_PATH = join(process.cwd(), 'token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.compose',
];

type InstalledCredentials = { client_id: string; client_secret: string };

export function readClientCredentials(path: string = CREDENTIALS_PATH): InstalledCredentials {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new Error(
      `"credentials.json" introuvable à la racine du projet. Téléchargez vos identifiants OAuth2 ` +
        `(type "Desktop app") depuis Google Cloud Console et placez le fichier à cet emplacement.`,
    );
  }

  let parsed: { installed?: Partial<InstalledCredentials> };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`"credentials.json" : JSON invalide — ${(err as Error).message}`);
  }

  const { client_id, client_secret } = parsed.installed ?? {};
  if (!client_id || !client_secret) {
    throw new Error('"credentials.json" invalide : "client_id"/"client_secret" manquants sous la clé "installed".');
  }
  return { client_id, client_secret };
}

export function readStoredToken(path: string = TOKEN_PATH): Auth.Credentials | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function persistToken(tokens: Auth.Credentials, path: string = TOKEN_PATH): void {
  writeFileSync(path, JSON.stringify(tokens, null, 2), 'utf-8');
}

/** Ouvre un serveur local éphémère et attend la redirection Google contenant le code d'autorisation. */
async function captureAuthorizationCode(
  oAuth2Client: Auth.OAuth2Client,
): Promise<{ code: string; redirectUri: string }> {
  const server = createServer();

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error("Impossible de démarrer le serveur local d'authentification."));
        return;
      }
      resolve(address.port);
    });
  });

  const redirectUri = `http://127.0.0.1:${port}`;
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    redirect_uri: redirectUri,
  });

  console.log('Autorisation Google requise. Ouvrez cette URL dans votre navigateur :');
  console.log(authUrl);

  const code = await new Promise<string>((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.end('Autorisation refusée. Vous pouvez fermer cette fenêtre.');
        reject(new Error(`Autorisation Google refusée : ${error}`));
        return;
      }
      if (!authCode) {
        res.statusCode = 400;
        res.end('Requête inattendue.');
        return;
      }
      res.end('Autorisation réussie. Vous pouvez fermer cette fenêtre et retourner au terminal.');
      resolve(authCode);
    });
  });

  server.close();
  return { code, redirectUri };
}

async function runInteractiveFlow(oAuth2Client: Auth.OAuth2Client): Promise<void> {
  const { code, redirectUri } = await captureAuthorizationCode(oAuth2Client);
  const { tokens } = await oAuth2Client.getToken({ code, redirect_uri: redirectUri });
  oAuth2Client.setCredentials(tokens);
  persistToken(tokens);
}

export async function authenticate(): Promise<Auth.OAuth2Client> {
  const { client_id, client_secret } = readClientCredentials();
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);

  // Persiste tout rafraîchissement automatique du access_token — sinon token.json ne bouge jamais.
  oAuth2Client.on('tokens', (tokens) => {
    persistToken({ ...oAuth2Client.credentials, ...tokens });
  });

  const storedToken = readStoredToken();
  if (storedToken) {
    oAuth2Client.setCredentials(storedToken);
    try {
      await oAuth2Client.getAccessToken();
      return oAuth2Client;
    } catch {
      console.warn('Jeton stocké invalide ou expiré (statut "Testing" : 7 jours) — reconnexion manuelle requise.');
    }
  }

  await runInteractiveFlow(oAuth2Client);
  return oAuth2Client;
}
