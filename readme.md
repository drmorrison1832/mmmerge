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

Rend la commande `mmmerge` disponible depuis un terminal, sans publication npm. `configs/`, `credentials.json` et `token.json` sont cherchés relativement au dossier **courant** — lancer `mmmerge` depuis la racine de ce projet, même une fois la commande liée globalement.

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
  ]
}
```

Points clés :
- `gdocs`/`pdf` : chaque instance a **exactement une** des deux clés `output_folder` (chemin dynamique, balises autorisées, créé automatiquement selon `autoCreateFolders`) ou `output_folder_id` (ID Drive littéral).
- `share` (gdocs uniquement) : partage du document généré — `email` et/ou `link`, permission `reader`/`commenter`/`editor`.
- `mail` : corps via **exactement une** des deux clés `template_html` (inline) ou `template_html_path` (fichier externe). `attach` (`all`/`generated`/`external`/`none`) détermine les pièces jointes ; `generated` référence uniquement des instances `pdf[]` (un gDoc ne s'attache pas — utiliser `{{link:gdocs[i]}}` dans le corps pour un lien de consultation).
- `gdocs[0]`, `pdf[1]`, `mail[0]`... sont les identifiants techniques de position — stables, utilisés dans les erreurs, `generated`, `{{link:...}}`. La clé `name` (optionnelle) n'est qu'un affichage, jamais une référence.

Détail complet du format (schéma Zod, toutes les clés, règles de validation) : `docs/specs.md` (comportement) et `docs/architecture.md` (technique).

## Syntaxe des balises

`{{variable}}`, `{{variable[modificateurs]}}`, ou `{{variable:type[modificateurs]}}` (type omis = `string`).

- Génériques (tous types) : `required`, `uppercase`, `lowercase`, `capitalize`.
- Type `string` : `initial` (première lettre + point).
- Type `date` : `format:<token>` (tokens `date-fns`, ex: `MMMM`, `yyyy`), locale française. Sans `format:`, utilise `defaultDateFormat` du profil.
- Les modificateurs s'appliquent dans l'ordre d'écriture — `[lowercase, capitalize]` ≠ `[capitalize, lowercase]`.
- `{{link:gdocs[0]}}` / `{{link:pdf[0]}}` (mail uniquement — `to`, `cc`, `subject`, corps) : résout l'URL d'une instance déjà générée pour cette ligne.

Exemple : `{{nom:string[required, uppercase]}} {{date:date[required, format:MMMM yyyy]}}` → `DUPONT juillet 2026`.

## Utilisation

```bash
mmmerge <profil> [options]
# ou, sans npm link :
node dist/cli.js <profil> [options]
```

| Flag | Effet |
|---|---|
| `--dry-run` | Simule (console uniquement) — aucune écriture Sheets/Drive/Gmail. |
| `--lines=4,14,15` | Restreint le traitement à ces numéros de ligne (numérotation visuelle Sheets). Ligne hors tableau → erreur. |
| `--force` | Ignore le filtre de statut : retraite les lignes ciblées quel que soit leur `mmm_status`. |
| `--validate` | Vérifie la config, l'accessibilité du Sheet et des `template_id`/`output_folder_id` — sans lire de ligne de données ni lancer le pipeline. |
| `--init-columns` | Crée les colonnes système `mmm_*` manquantes au lieu d'échouer. |
| `--verbose` | Détail technique supplémentaire en console (aucun effet sur le comportement). |

Code de sortie `0` (succès, ou aucune ligne à traiter) ou `1` (erreur — le statut est toujours écrit sur le Sheet avant l'arrêt).

## Développement

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc → dist/
```

Documentation technique complète : `docs/architecture.md` (modules, schéma, flux d'appels API), `docs/specs.md` (spécifications fonctionnelles), `docs/schema-fonctionnement.md` (vue d'ensemble visuelle du pipeline).
