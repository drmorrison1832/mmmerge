# MMMerge

Outil local de publipostage automatisé, piloté par Google Sheets : génère des Google Docs et/ou PDF à partir de templates, puis compose et envoie (ou met en brouillon) des emails associés — une ligne du tableur à la fois.

Usage personnel, volume faible à modéré (quelques dizaines d'exécutions par mois). Cas d'usage d'origine : gestion de contrats CDDU, mais l'outil est générique — n'importe quel processus de publipostage (factures, relances, invitations...) peut être configuré via un profil.

## Prérequis

- Node.js **24** (LTS) et npm.
- Un compte Google, avec un projet Google Cloud dédié (voir ci-dessous).

## Installation

```bash
npm install
npm run build
```

### Configuration Google Cloud (une seule fois)

1. Aller sur https://console.cloud.google.com/ et créer (ou sélectionner) un projet.
2. **APIs & Services → Library** : activer ces 4 APIs :
   - Google Sheets API
   - Google Docs API
   - Google Drive API
   - Gmail API
3. **APIs & Services → OAuth consent screen** :
   - Type "External" (sauf compte Google Workspace).
   - Statut restera "Testing" — dans "Test users", ajouter ta propre adresse Gmail.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** :
   - Type d'application : **"Desktop app"**.
   - Télécharger le fichier JSON généré.
5. Placer ce fichier à la racine du projet, renommé exactement `credentials.json` (déjà exclu de Git).

**Note (compte en statut "Testing")** : le refresh token expire au bout de **7 jours**. Passé ce délai, une reconnexion manuelle (ouverture du navigateur) est redemandée automatiquement au lancement suivant — c'est normal, pas une erreur.

### Commande globale (optionnel)

```bash
npm link
```

Rend la commande `mmmerge` disponible depuis un terminal, sans publication npm. `configs/`, `credentials.json` et `token.json` sont cherchés relativement à la racine du projet (résolue depuis l'emplacement du script lui-même, pas le dossier courant) — `mmmerge` fonctionne donc depuis n'importe quel dossier une fois lié globalement, pas seulement depuis la racine du projet.

## Première authentification

Au premier lancement (ou après expiration du refresh token), un lien s'affiche dans le terminal :

```
Autorisation Google requise. Ouvrez cette URL dans votre navigateur :
https://accounts.google.com/o/oauth2/v2/auth?...
```

Ouvrir ce lien, se connecter avec le compte ajouté comme "test user", accepter les permissions. Un `token.json` est alors créé automatiquement (exclu de Git) et réutilisé aux lancements suivants.

## Préparer un Google Sheet

Le tableur doit contenir, en plus des colonnes libres servant de balises (ex: `Nom`, `Email`, `Date`...), 3 colonnes réservées :

| Colonne | Rôle |
|---|---|
| `mmm_status` | Statut de la ligne (texte libre). Vide, `En cours d'exécution`, ou `Erreur: ...` = éligible au traitement. Toute autre valeur (ex: `skip`) exclut la ligne. |
| `mmm_outputs` | JSON généré automatiquement — résultats (fichiers/emails) indexés par instance. Ne pas éditer à la main. |
| `mmm_last_run` | Horodatage de la dernière écriture sur la ligne — généré automatiquement. |

Si l'une de ces colonnes manque, `mmmerge` s'arrête avec une erreur explicite. Ajoute `--init-columns` pour les créer automatiquement (en fin d'en-tête) plutôt que d'échouer.

La ligne **1** est l'en-tête ; la première ligne de données possible est la ligne **2**.

## Configurer un profil

Chaque profil est un fichier JSON dans `configs/<nom-du-profil>.json`. Exemple complet (voir aussi `configs/exemple.json`, utilisé par les tests) :

```json
{
  "sheetId": "1AbCDeFGhIJKlmNoPQRstuVwxYZ0123456789abcdefghij",
  "sheetTabName": "Contrats",
  "autoCreateFolders": true,
  "defaultDateFormat": "d/M/yyyy",
  "gdocs": [
    {
      "name": "Contrat CDDU",
      "template_id": "1TemplateGdocsIdXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "template_link": "https://docs.google.com/document/d/1TemplateGdocsIdXXXXXXXXXXXXXXXXXXXXXXXXXXXX/edit",
      "output_folder": "Contrats/{{Annee:date[format:yyyy]}}",
      "output_filename": "CDDU {{Nom}} {{Prenom}}",
      "share": {
        "email": { "addresses": ["{{Email}}"], "permission": "reader" }
      }
    }
  ],
  "pdf": [
    {
      "name": "Contrat CDDU (PDF)",
      "template_id": "1TemplatePdfIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_folder_id": "1DriveFolderIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_filename": "CDDU {{Nom}} {{Prenom}}"
    }
  ],
  "mail": [
    {
      "name": "Envoi contrat",
      "to": "{{Email}}",
      "subject": "Votre contrat CDDU",
      "template_html": "<p>Bonjour {{Prenom}},</p><p>Voici votre contrat : {{link:pdf[0]}}</p>",
      "draft_only": true,
      "attach": "generated",
      "generated": ["pdf[0]"]
    }
  ],
  "columns": [
    {
      "name": "Nom complet",
      "template": "{{Prenom}} {{Nom}}",
      "output_column": "NomComplet"
    }
  ]
}
```

Points clés :
- `gdocs`/`pdf` : chaque instance a **exactement une** des deux clés `output_folder` (chemin dynamique, balises autorisées, créé automatiquement selon `autoCreateFolders`) ou `output_folder_id` (ID Drive littéral).
- `share` (gdocs uniquement) : partage du document généré — `email` et/ou `link`, permission `reader`/`commenter`/`editor`.
- `mail` : corps via **exactement une** des deux clés `template_html` (inline) ou `template_html_path` (fichier externe). `attach` (`all`/`generated`/`external`/`none`) détermine les pièces jointes ; `generated` référence uniquement des instances `pdf[]` (un gDoc ne s'attache pas — utiliser `{{link:gdocs[i]}}` dans le corps pour un lien de consultation).
- `columns` : calcule une valeur (`template`, même syntaxe de balise qu'ailleurs) et l'écrit dans une colonne du Sheet (`output_column`) — créée automatiquement si elle n'existe pas encore. S'exécute **avant** `gdocs`/`pdf`/`mail` (mais après `lookup`), donc `{{NomComplet}}` (exemple ci-dessus) est utilisable comme une balise normale dans leurs templates, pour la même ligne (voir exemple dédié plus bas).
- `lookup` : enrichit une ligne à partir d'un fichier JSON externe (`file`), indexé par la valeur d'une colonne du Sheet (`key_column`) — voir exemple dédié plus bas. S'exécute **en premier**, avant même `columns`.
- `gdocs[0]`, `pdf[1]`, `mail[0]`, `columns[0]`, `lookup[0]`... sont les identifiants techniques de position — stables, utilisés dans les erreurs, `generated`, `{{link:...}}`. La clé `name` (optionnelle) n'est qu'un affichage, jamais une référence.
- `disable` (optionnel, tous types d'instance, défaut `false`) : désactive l'instance — ignorée à l'exécution, sans décaler les index des autres. Pratique pour désactiver temporairement un module en cours de configuration d'un profil. Une instance `mail[]` ne peut pas référencer (`generated`, `{{link:...}}`) une instance désactivée — erreur de configuration immédiate au chargement du profil, jamais au milieu d'une exécution.
- `filter` (optionnel, tous types d'instance) : contrairement à `disable` (statique), exécute l'instance **seulement pour les lignes** dont les colonnes satisfont la condition configurée — voir exemple ci-dessous. Une instance filtrée pour une ligne donnée est simplement ignorée pour cette ligne, sans erreur.
- `pdf[].output_filename` : l'extension `.pdf` est ajoutée automatiquement si absente (`CDDU {{Nom}}` devient `CDDU Dupont.pdf`) — insensible à la casse, jamais de doublon si `.pdf`/`.PDF` est déjà présent dans le nom résolu. Ne s'applique qu'au module `pdf` (un `gdocs[].output_filename` n'a pas d'extension à ajouter).
- `template_link` (optionnel, `gdocs`/`pdf` uniquement, chaîne libre) : **purement décoratif, jamais lu par l'application** — un aide-mémoire pratique pour retrouver l'URL du template source directement depuis le profil, sans avoir à la reconstruire à partir du seul `template_id`. Absent de `mail` (son "template" est `template_html`/`template_html_path`, déjà dans le profil).
- `link_column` (optionnel, `gdocs`/`pdf`/`mail`, chaîne — nom de colonne) : en plus de `mmm_outputs`, écrit l'URL de sortie de l'instance dans la colonne du Sheet nommée par cette clé, créée si elle n'existe pas encore. Absent → rien n'est écrit. Le nom est choisi par l'utilisateur (comme `columns[].output_column`) — jamais dérivé de `name`, qui reste purement cosmétique partout ailleurs dans l'outil.

### Autres exemples de profils

**Profil minimal (gDocs seul, pas de PDF ni d'email)** :

```json
{
  "sheetId": "1AbCDeFGhIJKlmNoPQRstuVwxYZ0123456789abcdefghij",
  "sheetTabName": "Feuille 1",
  "gdocs": [
    {
      "template_id": "1TemplateGdocsIdXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_folder_id": "1DriveFolderIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_filename": "CDDU {{Nom}} {{Prenom}}"
    }
  ]
}
```

**Module désactivé (`disable`)** — utile en cours de configuration d'un profil, quand un template n'est pas encore prêt : l'instance `pdf[0]` est ignorée, mais garde son identifiant de position (un `mail[]` qui la référencerait dans `generated` lèverait une erreur de configuration explicite, pas une erreur en cours d'exécution) :

```json
{
  "pdf": [
    {
      "disable": true,
      "template_id": "1TemplatePdfIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_folder_id": "1DriveFolderIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_filename": "CDDU {{Nom}} {{Prenom}}"
    }
  ]
}
```

**Exécution conditionnelle par ligne (`filter`)** — l'instance `pdf[0]` n'est générée que pour les lignes où `Statut` vaut `Actif` **et** `Type` vaut `CDD` ; les autres lignes l'ignorent simplement (pas d'erreur) :

```json
{
  "pdf": [
    {
      "template_id": "1TemplatePdfIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_folder_id": "1DriveFolderIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_filename": "CDDU {{Nom}} {{Prenom}}",
      "filter": {
        "match": "all",
        "conditions": [
          { "label": "Statut", "criterium": "equals", "value": "Actif" },
          { "label": "Type", "criterium": "equals", "value": "CDD" }
        ]
      }
    }
  ]
}
```

`match` combine les conditions : `all` (toutes vraies), `any` (au moins une), `none` (aucune). Une instance `mail[]` qui référence (`generated`) une instance filtrée reçoit un message d'erreur explicite si le filtre n'a pas été satisfait pour la ligne en cours.

**Colonne calculée (`columns`), réutilisée dans un nom de fichier** — `NomComplet` est calculé une fois puis utilisé tel quel par l'instance `pdf[0]`, sans dupliquer `{{Prenom}} {{Nom}}` dans chaque `output_filename` :

```json
{
  "columns": [
    {
      "template": "{{Prenom}} {{Nom}}",
      "output_column": "NomComplet"
    }
  ],
  "pdf": [
    {
      "template_id": "1TemplatePdfIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_folder_id": "1DriveFolderIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_filename": "CDDU {{NomComplet}}"
    }
  ]
}
```

Si `NomComplet` n'existe pas déjà comme colonne du Sheet, elle est créée automatiquement (ajoutée en fin d'en-tête) — aucun flag à activer. `columns[]` s'exécute avant `gdocs`/`pdf`/`mail` (mais après `lookup[]`, voir plus bas).

**Enrichissement depuis un fichier JSON externe (`lookup`)** — chaque ligne du Sheet est complétée à partir d'un fichier JSON, en retrouvant son entrée via la valeur de la colonne `Matricule` :

```json
{
  "lookup": [
    {
      "file": "data/employes.json",
      "key_column": "Matricule"
    }
  ]
}
```

Le fichier JSON associe une valeur de clé (celle de `key_column`, ici `Matricule`) à un objet colonne → valeur :

```json
{
  "M-001": { "Statut": "Actif", "Type": "CDD" },
  "M-002": { "Statut": "Inactif", "Type": "CDI" }
}
```

Pour la ligne dont `Matricule` vaut `M-001`, les colonnes `Statut` et `Type` du Sheet sont mises à jour avec `Actif`/`CDD`. Points clés :
- `s'exécute en premier`, avant `columns`/`gdocs`/`pdf`/`mail` : les colonnes renseignées sont utilisables via `{{Statut}}` dans les templates suivants, pour la même ligne.
- Les colonnes cibles (`Statut`, `Type` ci-dessus — les clés du fichier JSON, pas de clé de config dédiée) **doivent déjà exister** dans le Sheet — contrairement à `columns[].output_column`/`link_column`, aucune création automatique ici : une colonne manquante est une erreur explicite (toutes les colonnes manquantes sont listées en une fois).
- Une valeur de `key_column` sans correspondance dans le fichier JSON : la ligne est simplement ignorée pour cette instance, avec un avertissement — pas une erreur.
- Une valeur JSON non textuelle (nombre, booléen) est convertie en chaîne (`42` → `"42"`).
- Le fichier est relu à chaque ligne (comme `mail[].template_html_path`) — pas de mise en cache.

**Lien de sortie visible directement dans le Sheet (`link_column`)** — l'URL du PDF généré est écrite dans la colonne `"Lien contrat"` (créée automatiquement si absente), en plus de `mmm_outputs` :

```json
{
  "pdf": [
    {
      "template_id": "1TemplatePdfIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_folder_id": "1DriveFolderIdXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "output_filename": "CDDU {{Nom}} {{Prenom}}",
      "link_column": "Lien contrat"
    }
  ]
}
```

**Email avec pièce jointe externe** (`attach: "external"`, un fichier déjà présent sur Drive, pas généré par ce profil) :

```json
{
  "mail": [
    {
      "to": "{{Email}}",
      "subject": "Votre attestation {{Annee:date[format:yyyy]}}",
      "template_html": "<p>Bonjour {{Prenom}},</p><p>Veuillez trouver ci-joint votre attestation.</p>",
      "draft_only": false,
      "attach": "external",
      "externalFolder": "Attestations/{{Annee:date[format:yyyy]}}",
      "external": ["Attestation {{Nom}}.pdf"]
    }
  ]
}
```

**Email combinant pièce jointe générée et lien de consultation** (le PDF est joint, le gDoc n'est que consultable — un gDoc ne peut pas être joint à un email) :

```json
{
  "mail": [
    {
      "to": "{{Email}}",
      "subject": "Votre contrat CDDU",
      "template_html": "<p>Bonjour {{Prenom}},</p><p>Contrat joint en PDF. Version modifiable : {{link:gdocs[0]}}</p>",
      "draft_only": true,
      "attach": "generated",
      "generated": ["pdf[0]"]
    }
  ]
}
```

Détail complet du format (schéma Zod, toutes les clés, règles de validation) : `docs/specs.md` (comportement) et `docs/architecture.md` (technique).

## Syntaxe des balises

`{{variable}}`, `{{variable[modificateurs]}}`, ou `{{variable:type[modificateurs]}}` (type omis = `string`).

- Génériques (tous types) : `required`, `uppercase`, `lowercase`, `capitalize`.
- Type `string` : `initial` (première lettre + point).
- Type `date` : `format:<token>` (tokens `date-fns`, ex: `MMMM`, `yyyy`), locale française. Sans `format:`, utilise `defaultDateFormat` du profil. Voir tableau de référence des tokens ci-dessous.
- Type `number` : `format:<n>` (`n` = nombre entier de décimales fixes, ex: `format:2`). Format français par défaut (séparateur milliers, virgule décimale — ex: `1123.43` → `1 123,43`), y compris sans `format:` explicite.
- Type `euro` : automatique — 0 décimale si le montant est rond, 2 sinon (ex: `12` → `12 €`, `12,3` → `12,30 €`, `12,335` → `12,34 €` — arrondi au centime). `format:<n>` impose un nombre de décimales fixe, prioritaire sur cette règle automatique. Séparateur des milliers en espace fine insécable et espace insécable avant `€` (typographie française native, `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`) — ex: `1234.5` → `1 234,50 €`.
- `nospace` (types `number`/`euro` uniquement) : retire le séparateur de milliers (ex: `1234,56 €` au lieu de `1 234,56 €`) — utile pour coller une valeur dans un champ/formulaire qui rejette les espaces. Garde l'espace insécable avant `€`. Se combine avec `format:<n>` dans n'importe quel ordre (contrairement aux autres modificateurs, `nospace` n'est pas positionnel — voir tableau ci-dessous).
- `prefix(texte)` / `suffix(texte)` : ajoute `texte` avant/après la valeur, **uniquement si la cellule n'est pas vide** — pratique pour chaîner des champs optionnels sans laisser d'espace double ou orphelin (pour un montant en euros avec le symbole déjà inclus, voir plutôt le type `euro` ci-dessus). Le contenu est pris à la lettre (espaces compris), peut contenir une virgule, et peut apparaître à n'importe quelle position dans la liste de modificateurs.
- Les modificateurs s'appliquent dans l'ordre d'écriture — `[lowercase, capitalize]` ≠ `[capitalize, lowercase]` — **sauf** `nospace`, qui s'applique quelle que soit sa position dans la liste.
- `{{link:gdocs[0]}}` / `{{link:pdf[0]}}` (mail uniquement — `to`, `cc`, `subject`, corps) : résout l'URL d'une instance déjà générée pour cette ligne.

### Exemples de balises, par type

| Balise | Donnée (cellule) | Résultat |
|---|---|---|
| `{{Nom}}` | `Dupont` | `Dupont` |
| `{{Nom[uppercase]}}` | `Dupont` | `DUPONT` |
| `{{Nom[required]}}` | *(vide)* | → `Erreur` |
| `{{Ville[capitalize]}}` | `saint-jean-de-luz` | `Saint-Jean-De-Luz` |
| `{{Prenom:string[initial]}}` | `Marie` | `M.` |
| `{{prenom2[prefix( )]}}` | *(vide)* | *(chaîne vide, rien avant)* |
| `{{prenom2[prefix( )]}}` | `Sébastien` | ` Sébastien` |
| `{{Date:date}}` | `46224` *(numéro de série Sheets)* | `21/7/2026` *(= `defaultDateFormat`)* |
| `{{Date:date[format:MMMM yyyy]}}` | `46224` | `juillet 2026` |
| `{{Date:date[format:EEEE d MMMM yyyy]}}` | `46224` | `mardi 21 juillet 2026` |
| `{{Montant:number}}` | `1234.5` | `1 234,5` |
| `{{Montant:number[format:2]}}` | `1234` | `1 234,00` |
| `{{Montant:number[nospace]}}` | `1234.5` | `1234,5` |
| `{{brut_total:euro}}` | `1123.43` | `1 123,43 €` |
| `{{brut_total:euro}}` | `1200` | `1 200 €` *(montant rond → 0 décimale)* |
| `{{brut_total:euro[format:2]}}` | `1200` | `1 200,00 €` |
| `{{brut_total:euro[nospace]}}` | `1234.56` | `1234,56 €` |
| `{{brut_total:euro[nospace, format:2]}}` | `1234` | `1234,00 €` |
| `{{link:pdf[0]}}` | *(instance `pdf[0]` déjà générée pour cette ligne)* | `https://drive.google.com/file/d/.../view` |

Exemple combiné : `{{nom:string[required, uppercase]}} {{date:date[required, format:MMMM yyyy]}}` → `DUPONT juillet 2026`.

Exemple (champs optionnels sans espaces doubles) : `{{prenom1}}{{prenom2[prefix( )]}}{{prenom3[prefix( )]}} {{nom}}` avec `prenom2` vide → `Étienne Paul Dupont` (pas `Étienne  Paul Dupont`).

### Tokens `date-fns` courants (type `date`, locale française)

| Token | Signification | Exemple (mardi 21 juillet 2026) |
|---|---|---|
| `d` | Jour du mois | `21` |
| `dd` | Jour du mois, 2 chiffres | `21` |
| `M` | Mois numérique | `7` |
| `MM` | Mois numérique, 2 chiffres | `07` |
| `MMM` | Mois abrégé | `juil.` |
| `MMMM` | Mois complet | `juillet` |
| `yy` | Année, 2 chiffres | `26` |
| `yyyy` | Année, 4 chiffres | `2026` |
| `EEE` | Jour de la semaine abrégé | `mar.` |
| `EEEE` | Jour de la semaine complet | `mardi` |
| `HH` | Heure (24h), 2 chiffres | `14` |
| `mm` | Minutes, 2 chiffres | `32` |
| `ss` | Secondes, 2 chiffres | `05` |

Se combinent librement dans un même `format:` : `format:EEEE d MMMM yyyy` → `mardi 21 juillet 2026`, `format:dd/MM/yyyy` → `21/07/2026`, `format:HH:mm` → `14:32`. Liste complète des tokens : [documentation `date-fns` (`format`)](https://date-fns.org/docs/format).

## Utilisation

```bash
mmmerge <profil> [options]
# ou, sans npm link :
node dist/cli.js <profil> [options]
```

| Flag | Effet |
|---|---|
| `--dry-run` | Simule (console uniquement) — aucune écriture Sheets/Drive/Gmail. |
| `--lines=4,14,15` | Restreint le traitement à ces numéros de ligne (numérotation visuelle Sheets). Accepte aussi des plages (`--lines=2,4-6,9` → 2, 4, 5, 6, 9). Ligne hors tableau, ou plage inversée (`6-4`) → erreur. |
| `--force` | Ignore le filtre de statut : retraite les lignes ciblées quel que soit leur `mmm_status`. |
| `--validate` | Vérifie la config, l'accessibilité du Sheet et des `template_id`/`output_folder_id` — sans lire de ligne de données ni lancer le pipeline. |
| `--init-columns` | Crée les colonnes système `mmm_*` manquantes au lieu d'échouer. |
| `--list` | Affiche les lignes éligibles (numéro + statut actuel) sans exécuter le pipeline — pour vérifier avant un lancement réel. |
| `--quiet` | Supprime le logging de progression en temps réel (actif par défaut) — aucun effet sur le comportement. |
| `--verbose` | Affiche en fin d'exécution le détail ligne par ligne de chaque document/email généré, groupé par instance (voir exemple ci-dessous). Indépendant de `--quiet`, qui ne concerne que le logging de progression. |
| `--help-templates` | Affiche la syntaxe des balises (voir section précédente) et quitte — utilisable sans profil. |

Par défaut, chaque appel réseau (Sheets/Drive/Docs/Gmail) est annoncé en console avant d'être lancé, puis confirmé par une ligne `→ OK` une fois terminé — utile pour savoir précisément où en est une exécution longue, ou ce qui est en cours si le script semble bloqué :

```
Authentification : vérification du jeton stocké...
→ OK
Lecture de l'en-tête du Sheet (onglet "Contrats")...
→ OK
```

`--quiet` revient à un affichage minimal (avertissements, résumé final, ligne en cause en cas d'erreur).

Code de sortie `0` (succès, ou aucune ligne à traiter) ou `1` (erreur — le statut est toujours écrit sur le Sheet avant l'arrêt). En fin d'exécution (hors `--validate`/`--list`), un résumé est affiché : lignes traitées, lignes enrichies via JSON, colonnes renseignées, documents/PDF générés, emails composés, et la ligne en cause en cas d'arrêt sur erreur.

### `--verbose` : détail des documents générés

En plus du résumé numérique, `--verbose` affiche chaque document/email réellement généré, groupé par instance (dans l'ordre du profil), avec son titre (`name`, si configuré), puis une ligne par ligne de Sheet traitée (numéro de ligne réel, pas un simple compteur) :

```
Documents générés :

gdocs[0] - "Contrat CDDU"
  ligne 5 : CDDU Dupont Étienne.pdf : https://docs.google.com/document/d/.../edit
  ligne 8 : CDDU Martin Paul.pdf : https://docs.google.com/document/d/.../edit

pdf[0] - "Contrat CDDU (PDF)"
  ligne 5 : CDDU Dupont Étienne.pdf : https://drive.google.com/file/d/.../view
  ligne 8 : CDDU Martin Paul.pdf : https://drive.google.com/file/d/.../view

mail[0]
  ligne 5 : dupont@example.com - Votre contrat CDDU - https://mail.google.com/mail/u/0/#drafts?compose=...
  ligne 8 : martin@example.com - Votre contrat CDDU - https://mail.google.com/mail/u/0/#drafts?compose=...
```

Une instance sans `name` configuré n'affiche que son identifiant (`mail[0]`, sans le `- "..."`). Une instance désactivée (`disable`), ou qui n'a généré aucune sortie (toutes ses lignes en erreur avant qu'elle ne s'exécute), n'apparaît pas du tout. `columns[]` n'apparaît jamais dans ce détail (juste dans le compteur "Colonnes renseignées" du résumé) — le format ligne par ligne ne se prête pas à une simple valeur calculée.

### Exemples de commandes

```bash
# Avant tout lancement réel : quelles lignes seraient traitées, et avec quel statut actuel ?
mmmerge CDDUA10 --list

# Test à blanc complet — aucune écriture Sheets/Drive/Gmail, juste la console
mmmerge CDDUA10 --dry-run

# Ne traiter que les lignes 5, 12 et 13 du Sheet
mmmerge CDDUA10 --lines=5,12,13

# Retraiter la ligne 8, même si mmm_status vaut déjà "Succès"
mmmerge CDDUA10 --force --lines=8

# Vérifier la config (Sheet, colonnes mmm_*, template_id/output_folder_id) sans rien exécuter
mmmerge CDDUA10 --validate

# Premier lancement sur un nouveau Sheet : créer mmm_status/mmm_outputs/mmm_last_run automatiquement
mmmerge CDDUA10 --init-columns

# Lancement réel, mais sans le détail de progression (juste avertissements + résumé)
mmmerge CDDUA10 --quiet

# Lancement réel, avec la liste détaillée des documents/emails générés en plus du résumé
mmmerge CDDUA10 --verbose

# Combiner plusieurs flags : test à blanc, lignes ciblées, sans logs de progression
mmmerge CDDUA10 --dry-run --lines=2,3 --quiet

# Rappel de la syntaxe des balises et modificateurs — utilisable sans profil
mmmerge --help-templates
```

## Développement

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc → dist/
```

Documentation technique complète : `docs/architecture.md` (modules, schéma, flux d'appels API), `docs/specs.md` (spécifications fonctionnelles), `docs/schema-fonctionnement.md` (vue d'ensemble visuelle du pipeline).
