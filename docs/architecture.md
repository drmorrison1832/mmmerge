# Architecture Technique : "MMMerge"

> **Dernière mise à jour :** 2026-07-22 — v6
> **Résumé des derniers changements :** Implémentation complète (tous les modules, précédemment stubs). Ajouts issus de cette implémentation, non prévus par les versions précédentes de ce document :
> - **`PipelineDeps`** (`pipeline/deps.ts`, nouveau) : dépendances partagées par `gdocs.ts`/`pdf.ts`/`mail.ts`, construites une seule fois par exécution par l'orchestrateur (clients Google, `SheetsWriter`, cache de dossiers "par exécution", `defaultDateFormat`, `autoCreateFolders`, `dryRun`, `verbose`).
> - **`--dry-run`** : chaque module du pipeline (`gdocs`/`pdf`/`mail`) résout les champs purs (nom de fichier, destinataires…) puis court-circuite avant tout appel Drive/Docs/Gmail, écrivant une sortie synthétique (`url: '(dry-run)'`). `SheetsWriter` simule ses écritures (`writeCells` en no-op loggé) tout en conservant ses lectures réelles.
> - **`--init-columns`** (nouveau flag) : crée les colonnes système `mmm_*` manquantes (ajoutées en fin d'en-tête) au lieu de lever une erreur — voir §5, §6.
> - **`--validate`** étendu : vérifie aussi l'accessibilité Drive des `template_id`/`output_folder_id` référencés (§6).
> - **`cliFlags.ts`** (nouveau) : `parseLines` extrait de `cli.ts` pour rester testable — importer `cli.ts` déclenche `main()` (c'est un script, pas un module réutilisable).
> - **`googleDocsHelpers.ts`** (nouveau, `pipeline/modules/`) : logique partagée par `gdocs.ts`/`pdf.ts` (résolution du dossier de sortie, remplissage des balises, `resolveShareSettings`, `driveRole`).
> - **`mimeMessage.ts`** (nouveau, `pipeline/modules/`) : construction manuelle du message MIME pour Gmail (`raw`), logique pure séparée de `mail.ts`.
> - Racine de résolution de dossiers Drive (`folderResolver.ts`) : "Mon Drive" (`root`) pour le premier segment d'un chemin comme `Contrats/2026`. Ambiguïté (plusieurs dossiers identiques au même niveau) → `Erreur`, par cohérence avec la règle déjà explicite pour `external` (specs.md §3).
> - `driveRole` (`googleDocsHelpers.ts`) : `reader`/`commenter` inchangés, `editor` → `writer` (rôles natifs de l'API Drive).
> - URL d'un brouillon Gmail : `data.id` (l'identifiant du brouillon retourné par `drafts.create`), pas `data.message.id` — **non vérifié en conditions réelles**.
> - `rawData` (construit par l'orchestrateur) inclut aussi les colonnes réservées `mmm_*`, sans filtrage — rien ne les distingue des colonnes libres à ce stade.
> - "Ligne suivante" pour l'enchaînement `markInitialRow`/`closeRow` (§3, §5) = la prochaine ligne **éligible** de la liste déjà filtrée, pas nécessairement `rowNumber + 1`.
> - `--verbose` implémenté seulement au niveau de l'orchestrateur (ligne/instance en cours) — pas encore instrumenté à l'intérieur des modules pour chaque appel API individuel. Sans incidence sur le comportement (`--verbose` ne change que la verbosité), mais une implémentation partielle.
> - Emplacement du fichier de profil : `configs/<nom-du-profil>.json` (§6) — déduit du dossier `configs/` et de l'usage `mmmerge <profil>`, jamais explicité avant cette implémentation.
>
> **Résumé v5 (2026-07-05) :** `applyModifiers` (`capitalize`) corrigée pour les caractères accentués (regex Unicode `\p{L}` au lieu de `\w`). `parseSheetDate` valide désormais que la valeur brute est numérique, avec un message d'erreur explicite sinon. La corbeille avant régénération devient une purge globale en début de ligne (tous les fichiers de `mmm_outputs` existant, pas seulement les instances sur le point d'être régénérées), suivie d'une réinitialisation de `mmm_outputs` à `{}`. `SheetsWriter` gagne la responsabilité de `mmm_last_run` (horodatage lisible, mis à jour à chaque écriture). `FileOutput`/`MailOutput` gagnent un champ `createdAt` (ISO 8601). Flux gDocs (§7) explicité pour montrer l'écriture incrémentale entre remplissage et partage, cohérent avec §3.

## 1. Stack Technique

### Langage & Runtime
- **TypeScript**, Node.js 24 (LTS). **ESM**. **npm**.

### Parsing & Validation
- **`mri`** (parsing CLI brut, réservé aux paramètres globaux — voir §6) + **Zod** (validation, source des types TS via `z.infer`).

### Client API Google
- **`googleapis`** : Sheets, Docs, Drive, Gmail.

### Dépendance ajoutée
- **`date-fns`** (+ `date-fns/locale/fr`) pour le formatage des dates dans `templateEngine` et pour `mmm_last_run`. Ce nom de librairie est un détail d'implémentation : specs.md ne le mentionne pas, seule la syntaxe des tokens y est exposée.

### Structure de Dossiers

```
mmmerge/
├── src/                       # code source TypeScript, jamais exécuté directement
│   ├── cli.ts                 # point d'entrée : parsing mri, dispatch vers l'orchestrateur
│   ├── auth.ts                # flux OAuth2, lecture/écriture de credentials.json et token.json
│   ├── sheetsWriter.ts        # seul point d'écriture vers l'API Sheets (statuts, mmm_outputs, mmm_last_run)
│   ├── utils.ts               # utilitaires partagés (ex: extractDriveFileId)
│   ├── cliFlags.ts            # parsing de valeurs de flags nécessitant conversion (ex: --lines), séparé de cli.ts pour rester testable
│   ├── templateEngine.ts      # résolution des balises {{variable}} — par tag et en chaîne finale
│   ├── folderResolver.ts      # résolution de chemins de dossiers Drive dynamiques, avec cache
│   ├── config/
│   │   ├── schema.ts          # schémas de validation Zod (profil, instances, types dérivés)
│   │   └── loader.ts          # fusion CLI > profil > défaut, puis validation
│   └── pipeline/
│       ├── orchestrator.ts    # exécute les 3 phases dans l'ordre, pour chaque ligne éligible
│       ├── deps.ts            # PipelineDeps : dépendances partagées par les modules, construites une fois par exécution
│       ├── rowContext.ts      # définition du type RowContext
│       └── modules/
│           ├── gdocs.ts               # génération des instances gDocs + resolveShareSettings
│           ├── pdf.ts                 # génération des instances PDF (cycle temporaire interne)
│           ├── mail.ts                # composition/envoi des instances Mail + résolution de leurs pièces jointes
│           ├── googleDocsHelpers.ts   # logique partagée gdocs/pdf : dossier de sortie, remplissage des balises, partage
│           └── mimeMessage.ts         # construction du message MIME brut pour Gmail (raw), logique pure
├── dist/                      # sortie de compilation (`tsc`) — code JS généré, jamais modifié à la main
│   └── cli.js                 # version compilée de src/cli.ts, ciblée par le champ "bin" (voir ci-dessous)
├── configs/                   # profils JSON de l'utilisateur
├── package.json
├── tsconfig.json
└── .gitignore                 # exclut notamment credentials.json, token.json, dist/
```

### Installation de la commande `mmmerge`

1. **Shebang** en première ligne de `src/cli.ts` (reporté dans `dist/cli.js` après compilation) : `#!/usr/bin/env node`.
2. **Champ `bin` dans `package.json`** : `"bin": { "mmmerge": "./dist/cli.js" }`.
3. **`npm link`** (depuis la racine du projet) : rend `mmmerge` disponible dans le terminal sans publier le package.

`node dist/cli.js <profil> [options]` fonctionne dès la compilation, sans aucune de ces trois étapes — elles ne sont qu'une commodité d'usage.

---

## 2. Authentification

OAuth2 "Desktop app", scopes Sheets/Docs/Drive/Gmail, `credentials.json`/`token.json` locaux, refresh token à 7 jours (compte Gmail personnel, statut "Testing"), reconnexion manuelle acceptée.

Le scope `drive` déjà présent couvre la modification des permissions de partage (`permissions.create`) — aucun scope supplémentaire requis pour `resolveShareSettings`.

---

## 3. Orchestrateur & Pipeline

### Les trois phases

```
[Filtre des lignes à traiter] → [Création de fichiers : gDocs, PDF, ...] → [Mail]
```

Chaque instance Mail résout ses propres pièces jointes en interne, via une fonction utilitaire partagée — pas de phase Attachment séparée.

### Nommage technique des instances

Avant l'exécution, l'orchestrateur annote chaque objet de configuration d'instance avec son identifiant technique de position (`gdocs[0]`, `pdf[1]`, `mail[0]`...), calculé à partir de son index dans le tableau du profil. Cet identifiant est distinct de la clé `name` (optionnelle, définie par l'utilisateur — specs.md §3) : l'identifiant technique sert de référence stable dans tout le système ; `name`, quand présent, ne fait que s'afficher en complément dans les messages d'erreur.

### Purge des sorties existantes en début de ligne

Avant d'exécuter la moindre instance, l'orchestrateur lit `mmm_outputs` tel qu'il existait avant cette exécution (déjà disponible depuis la lecture initiale du Sheet). Pour **chaque** entrée `gdocs[i]`/`pdf[i]` qui y figure (que l'instance correspondante existe encore ou non dans le profil actuel), le fichier Drive référencé est envoyé à la corbeille via `extractDriveFileId` + `files.update(fileId, { trashed: true })`, avec un avertissement loggé. Les entrées `mail[i]` ne sont **pas** nettoyées (les brouillons/emails déjà envoyés restent — specs.md §2, §6). `mmm_outputs` est ensuite réinitialisé à `{}` (écrit immédiatement, avec `mmm_last_run` mis à jour) avant que la génération ne commence.

Cette purge globale remplace une vérification "par instance juste avant sa régénération" : elle garantit qu'une instance retirée du profil depuis la dernière exécution ne laisse pas de résidu orphelin ni dans `mmm_outputs` ni sur Drive.

### Exécution séquentielle

Toutes les instances `gdocs[]` d'abord (ordre du tableau), puis toutes les instances `pdf[]`, puis toutes les instances `mail[]`. Aucun parallélisme.

### `templateEngine` : deux fonctions de sortie, un seul moteur d'analyse

**`resolveTemplateTags`** — pour gDocs et PDF (remplissage d'un Google Doc existant via `documents.batchUpdate`/`replaceAllText`). Retourne une liste de paires `{ fullMatch, value }`.

**`renderTemplateString`** — pour toute valeur qui est une simple chaîne JS à construire en mémoire : `mail[i].to`, chaque entrée de `cc`, `subject`, chaque entrée de `external`, `externalFolder`, `output_folder`, `output_filename`, le corps HTML du mail, et les adresses de `share.email.addresses`. Retourne directement la chaîne finale substituée.

```ts
const TEMPLATE_TAG_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*(?::\s*([a-zA-Z]+))?\s*(?:\[([^\]]*)\])?\s*\}\}/g;

function parseSheetDate(moduleName: string, name: string, rawValue: string): Date {
  const serial = Number(rawValue);
  if (Number.isNaN(serial)) {
    throw new ModuleError(moduleName, `Balise {{${name}}} : la valeur ne correspond pas à une date Sheets native (cellule formatée en texte brut ?)`);
  }
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function applyModifiers(
  moduleName: string,
  name: string,
  type: string,
  modifiers: string[],
  rawValue: string,
  defaultDateFormat: string,
): string {
  let value = rawValue;
  const parsedDate = type === 'date' ? parseSheetDate(moduleName, name, rawValue) : null;
  let formatApplied = false;

  for (const modifier of modifiers) {
    if (modifier === 'required') continue;
    if (modifier.startsWith('format:')) {
      if (type !== 'date') throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "format" incompatible avec le type "${type}"`);
      value = formatDate(parsedDate!, modifier.split(':')[1], { locale: fr });
      formatApplied = true;
    } else if (modifier === 'initial') {
      if (type !== 'string') throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "initial" incompatible avec le type "${type}"`);
      value = value.charAt(0).toUpperCase() + '.';
    } else if (modifier === 'capitalize') {
      value = value.replace(/(^|[\s\-'])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());
    } else if (modifier === 'uppercase') {
      value = value.toUpperCase();
    } else if (modifier === 'lowercase') {
      value = value.toLowerCase();
    } else {
      throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "${modifier}" inconnu`);
    }
  }

  if (type === 'date' && !formatApplied) {
    value = formatDate(parsedDate!, defaultDateFormat, { locale: fr });
  }
  return value;
}
```

`resolveTemplateTags` et `renderTemplateString` partagent `applyModifiers` et la même logique de détection "colonne absente"/"required vide" — elles ne diffèrent que dans la forme du résultat retourné (liste de paires vs. chaîne unique).

**`renderTemplateString` résout `{{link:...}}` en un premier passage séparé**, avant d'appliquer `TEMPLATE_TAG_PATTERN` :

```ts
function renderTemplateString(
  moduleName: string,
  template: string,
  rawData: Record<string, string>,
  outputs: Record<string, FileOutput | MailOutput>,
  defaultDateFormat: string,
): string {
  let result = template.replace(LINK_TAG_PATTERN, (_fullMatch, ref) => {
    const output = outputs[ref];
    if (!output) throw new ModuleError(moduleName, `{{link:${ref}}} : référence introuvable dans les sorties générées`);
    return output.url;
  });

  result = result.replace(TEMPLATE_TAG_PATTERN, (_fullMatch, name, type, modifiersRaw) => {
    // ... même logique de résolution que resolveTemplateTags (colonne absente,
    // required, applyModifiers), mais retourne directement la valeur substituée.
  });

  return result;
}
```

**Lecture des cellules du Sheet** : les valeurs sont lues via `valueRenderOption: 'UNFORMATTED_VALUE'`. L'API renvoie un mélange de types natifs JS (nombre, chaîne, booléen) — **chaque valeur est convertie via `String(valeur)`** au moment de construire `rawData`, pour que son typage déclaré (`Record<string, string>`) soit honnête. Une colonne non-date contenant des zéros non significatifs doit être formatée en "Texte brut" dans Sheets (specs.md §1) — mais dans ce cas précis, `parseSheetDate` échouerait proprement si cette même cellule était utilisée comme balise `date`.

### Référencer un lien déjà généré (`{{link:...}}`)

Reconnu uniquement par `renderTemplateString`, pas par `resolveTemplateTags`. Voir le code ci-dessus pour le mécanisme en deux passes.

### Partage de documents (`resolveShareSettings`, module gDocs uniquement)

```ts
async function resolveShareSettings(
  moduleName: string,
  fileId: string,
  shareConfig: { email?: { addresses: string[]; permission: 'reader'|'commenter'|'editor' }; link?: { permission: 'reader'|'commenter'|'editor' } },
  rawData: Record<string, string>,
): Promise<void> {
  if (shareConfig.link) {
    await drive.permissions.create({ fileId, requestBody: { type: 'anyone', role: driveRole(shareConfig.link.permission) } });
  }
  if (shareConfig.email) {
    for (const addressTemplate of shareConfig.email.addresses) {
      const address = renderTemplateString(moduleName, addressTemplate, rawData);
      await drive.permissions.create({ fileId, requestBody: { type: 'user', emailAddress: address, role: driveRole(shareConfig.email.permission) } });
    }
  }
}
```

`driveRole` traduit `reader`/`commenter`/`editor` vers les rôles Drive natifs : `reader`→`reader`, `commenter`→`commenter` (inchangés), `editor`→`writer` (seul le nom diffère). Échec en cours de boucle → permissions déjà accordées restent en place. Le fichier lui-même est déjà tracé dans `mmm_outputs` avant cet appel, donc un échec ici n'orpheline jamais le fichier.

### Résolution des pièces jointes par instance Mail

```ts
async function resolveAttachmentsForInstance(
  moduleName: string,
  mailInstanceConfig: MailInstanceConfig,
  context: RowContext,
): Promise<{ fileId: string; filename: string }[]> {
  const fromGenerated = mailInstanceConfig.attach === 'all' || mailInstanceConfig.attach === 'generated'
    ? mailInstanceConfig.generated.map((ref) => {
        const output = context.outputs[ref] as FileOutput | undefined;
        if (!output) throw new ModuleError(moduleName, `Référence "${ref}" introuvable dans les sorties générées`);
        return { fileId: extractDriveFileId(output.url), filename: output.filename };
      })
    : [];

  const fromExternal = mailInstanceConfig.attach === 'all' || mailInstanceConfig.attach === 'external'
    ? await resolveExternalFiles(moduleName, mailInstanceConfig.external, mailInstanceConfig.externalFolder, context.rawData)
    : [];

  return [...fromGenerated, ...fromExternal];
}
```

`resolveExternalFiles` : résout `externalFolder` via `folderResolver.resolveFolderPath` (autoCreate forcé à `false`), résout chaque entrée de `external` via `renderTemplateString`, détecte les doublons de noms résolus, puis un `drive.files.list` par nom recherché (0 ou plusieurs résultats → `Erreur`).

### Composition du message (Gmail, `mimeMessage.ts`)

L'API Gmail n'offre pas de méthode haut niveau pour composer un message avec pièces jointes : `users.drafts.create`/`users.messages.send` attendent un message RFC 2822 complet, encodé en base64url, dans le champ `raw`. `mimeMessage.ts` construit ce message brut (logique pure, sans appel réseau) :
- Sujet encodé en `=?UTF-8?B?<base64>?=` (RFC 2047), systématiquement — valide même pour un sujet purement ASCII, évite de détecter au cas par cas.
- Corps HTML et chaque pièce jointe en base64 (`Content-Transfer-Encoding: base64`), lignes limitées à 76 caractères (RFC 2045).
- Contenu des pièces jointes téléchargé via `drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })`, bufferisé puis encodé en base64.
- Message final encodé en base64url (`toBase64Url`) pour le champ `raw`, requis par l'API Gmail.
- `draft_only: true` → `users.drafts.create`, URL `mmm_outputs` = `#drafts/<data.id>` (l'ID du brouillon, pas `data.message.id` — **non vérifié en conditions réelles**). `draft_only: false` → `users.messages.send`, URL = `#sent/<data.id>` — **inféré par symétrie, non vérifié**.

### Étapes de l'orchestrateur

1. Charge et valide la configuration.
2. S'authentifie (§2).
3. Détermine la liste des lignes à traiter (filtre structurel + `--lines`/`--force`).
4. Écrit `En cours d'exécution` (+ `mmm_last_run`) sur la première ligne. Liste vide → sortie propre (code `0`).
5. Pour chaque ligne : purge les sorties existantes, construit un `RowContext` (`outputs: {}`), annote chaque instance avec son identifiant technique, puis exécute dans l'ordre : instances `gdocs[]` (création → écriture incrémentale → `resolveShareSettings` si configuré), instances `pdf[]` (création → écriture incrémentale), instances `mail[]` (composition/envoi → écriture incrémentale). Toute erreur interrompt la ligne et le script (§8). Succès complet → `SheetsWriter.closeRow` final, qui ouvre aussi la ligne suivante (`markInitialRow` fusionné dans le même appel) — "ligne suivante" désigne la prochaine ligne **éligible** de la liste déjà filtrée à l'étape 3, pas nécessairement `rowNumber + 1`.
6. `--dry-run` : respecté individuellement par chaque module et `SheetsWriter`. Concrètement, chaque module (`gdocs`/`pdf`/`mail`) résout d'abord ses champs purs (nom de fichier, destinataires…, sans appel API), puis court-circuite avant tout appel Drive/Docs/Gmail réel si `dryRun` est actif, en écrivant une sortie synthétique (`url: '(dry-run)'`) via `SheetsWriter` — lui-même en écriture simulée (lectures réelles conservées).
7. `--verbose` : implémenté au niveau de l'orchestrateur uniquement (log à chaque changement de ligne/instance en cours) — pas encore instrumenté à l'intérieur des modules pour chaque appel API individuel. `--verbose` ne changeant que la verbosité (jamais le comportement), cette implémentation partielle n'affecte pas la correction du pipeline.

---

## 4. RowContext

### Forme

```ts
type FileOutput = { filename: string; url: string; createdAt: string };
type MailOutput = { subject: string; url: string; attachments: string[]; createdAt: string };

type RowContext = {
  rowNumber: number;
  rawData: Record<string, string>;
  outputs: Record<string, FileOutput | MailOutput>;
  error?: { module: string; message: string };
};
```

`createdAt` (`new Date().toISOString()`) est en ISO 8601, contrairement à `mmm_last_run` (lecture humaine) — cette valeur n'est jamais lue directement à l'œil.

`rawData` (construit par l'orchestrateur à la lecture du Sheet) contient **toutes** les colonnes de la ligne, y compris les colonnes réservées `mmm_*` — aucun filtrage. Rien n'empêche donc une balise `{{mmm_status}}` dans un template, même si ça n'a pas d'usage prévu.

### Ce que chaque module lit et écrit

| Module | Lit | Écrit |
|---|---|---|
| `gdocs[i]` | `rawData` | `outputs['gdocs[i]']` (`FileOutput`) |
| `pdf[i]` | `rawData` | `outputs['pdf[i]']` (`FileOutput`) |
| `mail[i]` | `rawData`, `outputs` | `outputs['mail[i]']` (`MailOutput`) |

### Mutabilité

Mutation directe, exécution strictement séquentielle.

---

## 5. SheetsWriter

`markInitialRow` / `closeRow`, batching à 3 cas. Chacune des trois méthodes (`markInitialRow`, `updateOutput`, `closeRow`) met aussi à jour `mmm_last_run` (format `d/M/yyyy HH:mm`) dans le même appel API.

### Construction du message d'erreur final (`resolveInstanceName`)

```ts
function resolveInstanceName(ref: string, profile: Config): string | undefined {
  const match = ref.match(/^(gdocs|pdf|mail)\[(\d+)\]$/);
  if (!match) return undefined;
  const [, arrayName, indexStr] = match;
  return profile[arrayName as 'gdocs' | 'pdf' | 'mail']?.[Number(indexStr)]?.name;
}

function formatErrorStatus(error: { module: string; message: string }, profile: Config): string {
  const name = resolveInstanceName(error.module, profile);
  return `Erreur: ${error.module}${name ? ` ("${name}")` : ''} - ${error.message}`;
}
```

`context.error` présent → `mmm_status = formatErrorStatus(context.error, profile)` ; sinon → `"Succès"`.

**Écriture incrémentale** : `updateOutput(rowNumber, key, value)` met à jour `mmm_outputs` (fusion, pas écrasement) et `mmm_last_run`, sans toucher à `mmm_status`.

---

## 6. Système de Configuration

### Étapes 1-3 — parsing, séparation, fusion

Seuls les flags globaux (`sheetId`, `sheetTabName`, `autoCreateFolders`, `defaultDateFormat`, commandes système) sont reconnus par `mri` — `gdocs`/`pdf`/`mail` ne se configurent que via le profil.

### Étape 4 — Validation (Zod)

```ts
import { readFileSync } from 'node:fs';

const InstanceMetaSchema = z.object({
  name: z.string().max(80).optional(),
  description: z.string().max(500).optional(),
});

const FileModuleFieldsSchema = z.object({
  template_id: z.string(),
  output_folder: z.string().optional(),
  output_folder_id: z.string().optional(),
  output_filename: z.string(),
}).merge(InstanceMetaSchema);

const outputFolderXorRefine = (i: { output_folder?: string; output_folder_id?: string }) =>
  Boolean(i.output_folder) !== Boolean(i.output_folder_id);
const outputFolderXorMessage = { message: 'Exactement une des deux clés output_folder / output_folder_id doit être fournie.' };

const PdfInstanceSchema = FileModuleFieldsSchema.refine(outputFolderXorRefine, outputFolderXorMessage);

const ShareConfigSchema = z.object({
  email: z.object({ addresses: z.array(z.string()), permission: z.enum(['reader', 'commenter', 'editor']) }).optional(),
  link: z.object({ permission: z.enum(['reader', 'commenter', 'editor']) }).optional(),
}).refine(
  (share) => Boolean(share.email) || Boolean(share.link),
  { message: 'share doit contenir au moins une des deux clés email ou link.' }
).optional();

const GdocsInstanceSchema = FileModuleFieldsSchema
  .extend({ share: ShareConfigSchema })
  .refine(outputFolderXorRefine, outputFolderXorMessage);

const MailInstanceSchema = z.object({
  to: z.string(),
  cc: z.array(z.string()).optional().default([]),
  subject: z.string(),
  template_html: z.string().optional(),
  template_html_path: z.string().optional(),
  draft_only: z.boolean(),
  attach: z.enum(['all', 'generated', 'external', 'none']),
  generated: z.array(z.string()).optional().default([]),
  externalFolder: z.string().optional(),
  external: z.array(z.string()).optional().default([]),
}).merge(InstanceMetaSchema).refine(
  (mail) => Boolean(mail.template_html) !== Boolean(mail.template_html_path),
  { message: 'Exactement une des deux clés template_html / template_html_path doit être fournie.' }
).refine(
  (mail) => !(mail.attach === 'all' && (mail.generated.length === 0 || mail.external.length === 0)),
  { message: 'attach: "all" nécessite que generated ET external soient tous les deux non vides.' }
).refine(
  (mail) => !(mail.attach === 'generated' && (mail.generated.length === 0 || mail.external.length > 0)),
  { message: 'attach: "generated" nécessite generated non vide et external vide.' }
).refine(
  (mail) => !(mail.attach === 'external' && (mail.external.length === 0 || mail.generated.length > 0)),
  { message: 'attach: "external" nécessite external non vide et generated vide.' }
).refine(
  (mail) => !(mail.attach === 'none' && (mail.generated.length > 0 || mail.external.length > 0)),
  { message: 'attach: "none" nécessite generated ET external vides.' }
).refine(
  (mail) => mail.external.length === 0 || Boolean(mail.externalFolder),
  { message: 'externalFolder est requis dès que external est utilisé.' }
);

const ProfileSchema = z.object({
  sheetId: z.string(),
  sheetTabName: z.string(),
  autoCreateFolders: z.boolean().default(true),
  defaultDateFormat: z.string().default('d/M/yyyy'),
  gdocs: z.array(GdocsInstanceSchema).optional().default([]),
  pdf: z.array(PdfInstanceSchema).optional().default([]),
  mail: z.array(MailInstanceSchema).optional().default([]),
}).superRefine((config, ctx) => {
  const pdfRefs = new Set(config.pdf.map((_, i) => `pdf[${i}]`));
  const linkableRefs = new Set([
    ...config.gdocs.map((_, i) => `gdocs[${i}]`),
    ...pdfRefs,
  ]);

  const LINK_TAG_PATTERN = /\{\{link:([a-zA-Z]+\[\d+\])\}\}/g;
  const extractLinkRefs = (text: string) => [...text.matchAll(LINK_TAG_PATTERN)].map((m) => m[1]);

  config.mail.forEach((mailInstance, mailIndex) => {
    const seenGenerated = new Set<string>();
    for (const ref of mailInstance.generated) {
      if (!pdfRefs.has(ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mail[${mailIndex}].generated : "${ref}" doit référencer une instance pdf[] (un gDoc ne peut pas être joint à un email)` });
      }
      if (seenGenerated.has(ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mail[${mailIndex}].generated : référence "${ref}" dupliquée` });
      }
      seenGenerated.add(ref);
    }

    let bodyContent = mailInstance.template_html ?? '';
    if (mailInstance.template_html_path) {
      try {
        bodyContent = readFileSync(mailInstance.template_html_path, 'utf-8');
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mail[${mailIndex}].template_html_path : fichier "${mailInstance.template_html_path}" introuvable ou illisible` });
      }
    }

    const fieldsToScan = [mailInstance.to, ...mailInstance.cc, mailInstance.subject, bodyContent];
    for (const field of fieldsToScan) {
      for (const ref of extractLinkRefs(field)) {
        if (!linkableRefs.has(ref)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mail[${mailIndex}] : {{link:${ref}}} référence une instance introuvable` });
        }
      }
    }
  });
});
```

Toutes ces validations sont **statiques** — détectables via `--validate` sans lire une seule ligne du Sheet. Elles s'exécutent à chaque lancement (au chargement de la config, via `loadConfig`), pas seulement avec `--validate`.

### Emplacement du fichier de profil

`configs/<nom-du-profil>.json` (`loader.ts`) — un fichier par profil, nommé exactement comme l'argument positionnel de la commande (`mmmerge <profil>`).

### `--validate`

En plus des validations statiques ci-dessus (déjà systématiques), `--validate` authentifie, résout les colonnes `mmm_*` via `SheetsWriter.create`, puis vérifie l'accessibilité Drive de chaque `template_id`/`output_folder_id` référencé par `gdocs[]`/`pdf[]` (`validateResourceAccessibility`, `orchestrator.ts`) — un `drive.files.get` par ressource, en parallèle, toutes les ressources introuvables étant rapportées ensemble plutôt qu'au premier échec. Ne lit aucune ligne de données : `output_folder` (chemin dynamique) n'est donc pas vérifiable par cette voie.

### `--init-columns`

Si une ou plusieurs colonnes `mmm_status`/`mmm_outputs`/`mmm_last_run` sont absentes de l'en-tête, `SheetsWriter.create` lève par défaut une erreur les listant toutes. Avec `--init-columns`, elles sont ajoutées à la fin de la ligne d'en-tête (`values.update` sur la plage `<onglet>!1:1`) plutôt que de lever une erreur — respecte `--dry-run` (log de simulation, aucune écriture). Choix délibéré de ne pas les créer automatiquement par défaut : une colonne manquante peut aussi bien signifier un premier lancement sur ce Sheet qu'une erreur de configuration (mauvais `sheetTabName`/`sheetId`), que l'on ne veut pas masquer silencieusement.

---

## 7. Gestion des Fichiers Drive

### Résolution de chemins dynamiques (`folderResolver.ts`)

Substitution de balises via `renderTemplateString`, cache par exécution, création automatique des segments manquants selon `autoCreateFolders` (défaut `true`). Le premier segment est résolu depuis la racine "Mon Drive" (`root`) — un chemin comme `Contrats/2026` part donc de la racine du Drive du compte authentifié, pas d'un dossier configurable ailleurs. Si plusieurs dossiers portent le même nom au même niveau (ambiguïté), `Erreur` — même règle que pour la recherche de fichiers externes (§3, §7 ci-dessous), bien que specs.md ne l'explicite que pour ce second cas.

### Copie du template (instances gDocs)

`files.copy` → `documents.batchUpdate` (via `resolveTemplateTags`) → **écriture incrémentale de `mmm_outputs`/`mmm_last_run`** (§5) → si `share` configuré, `resolveShareSettings` (§3). L'écriture incrémentale précède délibérément le partage. URL stockée : `https://docs.google.com/document/d/<fileId>/edit` (format standard Google, non documenté ailleurs).

### Cycle interne des instances PDF

`files.copy` (temporaire, nommé `[tmp] <nom final>`, pas de parent — racine Drive, sans conséquence puisqu'il est supprimé) → `documents.batchUpdate` → `files.export` (`mimeType: 'application/pdf'`, `responseType: 'stream'`) → `files.create` (destination finale, `media.body` = le flux exporté) → `files.delete` (suppression définitive du temporaire, pas une mise à la corbeille) → écriture incrémentale. URL stockée : `https://drive.google.com/file/d/<fileId>/view` — confirmée par l'exemple `mmm_outputs` de specs.md §1.

### Recherche des fichiers externes (résolution interne à chaque instance Mail)

`externalFolder` résolu via `renderTemplateString` (jamais soumis à `autoCreateFolders`), puis chaque nom de fichier résolu, puis `files.list` filtré sur ce nom exact + le dossier résolu. 0 résultat, plusieurs résultats, ou doublon résolu → `Erreur`.

### Purge globale avant régénération

Voir §3 ("Purge des sorties existantes en début de ligne").

---

## 8. Gestion des Erreurs

`ModuleError` (avec `module` incluant l'instance en cause), un seul `try/catch` dans l'orchestrateur englobant les trois phases, écriture confirmée du statut avant `process.exit(1)`, codes de sortie `0`/`1`, `--verbose` n'affecte que la verbosité du log.
