# Spécifications Techniques & Fonctionnelles : "MMMerge"

> **Dernière mise à jour :** 2026-07-22 — v5
> **Résumé des derniers changements :** URLs Gmail (§1) vérifiées en conditions réelles et corrigées suite au test : un brouillon s'ouvre via `https://mail.google.com/mail/u/0/#drafts?compose=<id>` (pas `#drafts/<id>`, qui ne fonctionne plus dans l'UI Gmail actuelle), et `<id>` est l'identifiant du **message** sous-jacent, pas celui du brouillon lui-même. URL d'un mail envoyé (`#sent/<id>`) confirmée correcte telle quelle.
>
> **Résumé v4 (2026-07-22) :** Précisions issues de la première implémentation complète. `--lines` ciblant une ligne hors du tableau de données (ou la ligne d'en-tête) lève désormais une erreur explicite plutôt que d'être ignoré silencieusement (§5). Portée exacte de `--validate` précisée : vérifie l'authentification, les colonnes système du Sheet et l'accessibilité Drive des `template_id`/`output_folder_id` — jamais `output_folder` (chemin dynamique), dont la résolution nécessite une ligne réelle (§5). Nouveau flag `--init-columns` pour créer les colonnes système manquantes plutôt que d'échouer (§1, §5) — pas de création automatique silencieuse, pour ne pas masquer une vraie erreur de configuration (mauvais onglet/Sheet). Purge (§2) : l'échec de mise à la corbeille d'un fichier déjà absent/inaccessible est loggé et n'interrompt pas la régénération de la ligne. URL d'un mail envoyé (`draft_only: false`) précisée par symétrie avec l'exemple brouillon existant (§1) — non vérifiée en conditions réelles à l'époque (voir v5).
>
> **Résumé v3 (2026-07-05) :** Nouvelle colonne réservée `mmm_last_run` (horodatage lisible, format `d/M/yyyy HH:mm`), mise à jour à chaque écriture touchant la ligne — lève l'ambiguïté d'un `En cours d'exécution` qui pourrait dater de quelques secondes comme de plusieurs jours. Chaque entrée de `mmm_outputs` gagne un champ `createdAt` (ISO 8601). La règle de nettoyage avant ré-exécution change : **tous** les fichiers gDocs/PDF référencés dans `mmm_outputs` sont mis à la corbeille en une fois au début du traitement de la ligne (pas seulement ceux sur le point d'être régénérés), pour éviter les résidus si une instance a été retirée du profil entre deux exécutions. Les brouillons Gmail de tentatives précédentes ne sont volontairement pas nettoyés (voir §3, §6). `capitalize` corrigé pour les caractères accentués. Précision sur le comportement si une colonne `date` contient une valeur non numérique (cellule en texte brut).

## 1. Convention de Nommage du Tableur (Google Sheets)

L'indexation des lignes via la commande `--lines` s'aligne strictement sur la numérotation visuelle de Google Sheets. La ligne **1** correspond à la ligne d'en-tête (contenant le nom des colonnes) et n'est pas traitable. La première ligne de données disponible est la ligne **2**.

Les colonnes de données libres servent de balises (ex: une colonne `Nom` remplacera `{{Nom}}` où qu'il apparaisse dans un template ou une valeur de config dynamique). Les colonnes réservées au système utilisent le marqueur `mmm_` :

- `mmm_status` : Statut global de la ligne, texte libre.
- `mmm_last_run` : Horodatage de la dernière écriture touchant la ligne (format lisible `d/M/yyyy HH:mm`, ex: `05/07/2026 14:32`), mis à jour à chaque fois que `mmm_status` ou `mmm_outputs` changent — permet de distinguer un `En cours d'exécution` récent (script probablement toujours actif) d'un ancien (crash probable, à retraiter sans crainte).
- `mmm_outputs` : Chaîne JSON contenant les résultats de tous les fichiers/emails générés pour cette ligne, indexés par instance. Exemple concret de ce qui est réellement stocké dans la cellule :

```json
{
  "gdocs[0]": { "filename": "CDDU Marie Dupont", "url": "https://docs.google.com/document/d/abc123/edit", "createdAt": "2026-07-05T14:32:10Z" },
  "pdf[0]": { "filename": "CDDU Marie Dupont", "url": "https://drive.google.com/file/d/def456/view", "createdAt": "2026-07-05T14:32:14Z" },
  "mail[0]": {
    "subject": "Votre contrat de juillet",
    "url": "https://mail.google.com/mail/u/0/#drafts?compose=ghi789",
    "attachments": ["CDDU Marie Dupont"],
    "createdAt": "2026-07-05T14:32:18Z"
  }
}
```

**Note sur l'exemple `mail[0]`** : l'URL `#drafts?compose=...` correspond à un brouillon (`draft_only: true`) — **vérifiée en conditions réelles** (l'ancien format `#drafts/<id>` ne fonctionne plus dans l'UI Gmail actuelle). Pour un mail réellement envoyé (`draft_only: false`), l'URL est `https://mail.google.com/mail/u/0/#sent/<id>` — **également vérifiée en conditions réelles**.

**Colonnes système absentes du Sheet** : par défaut, une `Erreur` explicite liste toutes les colonnes `mmm_*` manquantes d'un coup. Le flag `--init-columns` (§5) permet de les créer automatiquement (ajoutées en fin d'en-tête) plutôt que d'échouer — pas de création automatique par défaut, pour ne pas masquer silencieusement une vraie erreur de configuration (mauvais `sheetTabName`/`sheetId`).

**Attention aux zéros non significatifs** : les valeurs des cellules sont lues sans mise en forme (nombre brut plutôt que texte affiché), ce qui garantit une lecture fiable des dates quel que soit leur affichage — mais une colonne contenant des codes à zéros non significatifs (ex: un code postal `01000`) doit être formatée en "Texte brut" dans Google Sheets, sinon le zéro de tête serait perdu à la lecture.

**Si une colonne de type `date` contient une valeur non numérique** (ex: une cellule formatée en "Texte brut" contenant `"27/06/2026"` plutôt qu'une vraie date Sheets) → `Erreur` explicite, plutôt qu'une date invalide silencieuse.

### Comportement en cas d'erreur

Si un module (ou une instance) rencontre une erreur métier, le détail est loggé dans la console, puis inscrit dans `mmm_status` (format `Erreur: <module> - <détail>`, où `<module>` précise l'instance en cause (ex: `pdf[1]`), accompagnée de son `name` entre parenthèses s'il est configuré (ex: `Erreur: pdf[1] ("Copie contrat pour archives") - fichier introuvable`)) — **cette écriture doit être confirmée avant que le script ne s'arrête**. Une fois l'écriture terminée, l'exécution globale du script est interrompue (Crash / Exit).

En cas de crash technique non intercepté, la ligne peut rester bloquée à `En cours d'exécution` — rattrapée par la règle de reprise (§2) à la prochaine exécution, `mmm_last_run` permettant de juger si ce blocage est récent ou ancien.

---

## 2. Architecture Modulaire & Cycle de vie du Pipeline

Le pipeline suit trois phases :

```
[Filtre des lignes à traiter] → [Création de fichiers : gDocs, PDF, ...] → [Mail]
```

gDocs et PDF restent deux modules indépendants, chacun en tableau d'instances (voir §3). Il n'y a pas de phase Attachment séparée : chaque instance Mail résout ses propres pièces jointes en interne, puisque des instances Mail différentes peuvent avoir besoin de combinaisons différentes pour une même ligne.

Au sein de la phase "Création de fichiers" : toutes les instances `gdocs[]` s'exécutent d'abord dans l'ordre du tableau, puis toutes les instances `pdf[]`. Ensuite, toutes les instances `mail[]` s'exécutent dans l'ordre du tableau.

Après la création de chaque fichier (gDocs, PDF) ou l'envoi/mise en brouillon de chaque email (Mail), `mmm_outputs` et `mmm_last_run` sont mis à jour immédiatement, plutôt que d'attendre la fin complète de la ligne — pour une instance gDocs avec `share` configuré, cette écriture précède la tentative de partage (voir §3), afin qu'un échec de partage n'orpheline jamais un fichier réellement créé. Ceci réduit la fenêtre d'exposition aux fichiers orphelins en cas de crash non intercepté, au prix d'un appel Sheets par instance plutôt qu'un seul par ligne (négligeable au volume visé par cette application).

### Règle d'Idempotence, Reprise et Ré-exécution intégrale

- Une ligne est éligible si sa colonne `mmm_status` est vide, vaut exactement `En cours d'exécution`, ou commence par `Erreur:` — liste blanche stricte. Toute autre valeur exclut la ligne, silencieusement.
- Cette règle permet une **exclusion manuelle intentionnelle** (ex: `skip`, ou un texte descriptif) directement dans le Sheet — distincte du filtre de condition par profil (§6, non implémenté).
- Une ligne éligible déclenche une **ré-exécution intégrale et systématique de tout le pipeline depuis le début**. Avant toute nouvelle génération, **tous** les fichiers Drive référencés par des entrées `gdocs[i]`/`pdf[i]` déjà présentes dans `mmm_outputs` sont envoyés à la corbeille en une fois (pas seulement ceux dont l'instance correspondante existe encore dans le profil actuel — une instance retirée du profil depuis la dernière exécution ne doit pas laisser de résidu). `mmm_outputs` est ensuite réinitialisé à `{}` avant que la ligne ne recommence. Un avertissement est loggé pour chaque fichier ainsi mis à la corbeille. Si la mise à la corbeille d'un fichier échoue (ex: déjà supprimé manuellement entre deux exécutions), l'échec est loggé mais **n'interrompt pas** la ligne — la régénération se poursuit normalement.
- Les brouillons/emails déjà créés par une instance `mail[i]` lors d'une exécution précédente ne sont **pas** nettoyés (voir §3, §6) : relancer plusieurs fois une ligne avec `draft_only: true` peut laisser plusieurs brouillons dans Gmail.

### `--force`

Ignore entièrement la vérification de statut : toute ligne ciblée est retraitée quel que soit son `mmm_status` actuel.

### Lignes masquées

Pour le MVP, toute ligne masquée dans le Google Sheet est **ignorée**, avec une alerte loggée par ligne masquée ignorée.

---

## 3. Description des Modules

### Nom et description (`name`, `description`) — communs à toutes les instances

Chaque instance (gDocs, PDF, ou Mail) accepte deux clés optionnelles, purement informatives :
- `name` (chaîne, ≤ 80 caractères) : un intitulé court et lisible (ex: `"CDDU en PDF"`, `"Mail notification manager"`). N'affecte **aucune** référence technique — `generated`, `{{link:...}}`, et les messages d'erreur continuent d'utiliser l'identifiant de position (`gdocs[0]`, `pdf[1]`...) comme référence stable. Quand `name` est renseigné, il s'affiche simplement **en plus** de cet identifiant dans les messages d'erreur.
- `description` (chaîne, ≤ 500 caractères) : notes libres à l'usage de l'utilisateur, jamais utilisées par le système.

### gDocs (tableau d'instances)

Génère un ou plusieurs documents Google Docs remplis à partir d'un template, destinés à être consultés/édités directement, partagés, ou dont une version PDF sera générée séparément (voir §3, module PDF). Chaque instance copie son propre template Google Doc dans le dossier configuré, applique le mapping des balises (résolution "par tag", voir architecture.md §3), sauvegarde le document et écrit `{"filename": ..., "url": ..., "createdAt": ...}` dans `mmm_outputs` sous la clé `gdocs[i]`.

- `share` (optionnel) : configure le partage du document généré, indépendamment par email et par lien. Si `share` est présent, **au moins une** des deux clés suivantes doit l'être aussi (un `share` vide est une `Erreur` de configuration) :
  - `share.email` : `{ "addresses": [...] (balises autorisées), "permission": "reader" | "commenter" | "editor" }`.
  - `share.link` : `{ "permission": "reader" | "commenter" | "editor" }`.
  - En cas d'échec en cours de route (ex: la 3ᵉ adresse d'une liste de `addresses` est invalide), les permissions déjà accordées avant l'échec **restent en place** — elles ne sont pas annulées automatiquement. Le fichier lui-même est déjà tracé dans `mmm_outputs` à ce stade (voir §2) ; l'utilisateur peut ensuite accorder l'accès manquant manuellement, ou relancer le traitement de la ligne (le fichier sera mis à la corbeille et régénéré, le partage retenté dans son intégralité).

### PDF (tableau d'instances)

Génère un ou plusieurs fichiers PDF, indépendamment du module gDocs — un PDF est le format à utiliser pour joindre un document à un email (un Google Doc natif ne peut pas être joint tel quel, voir §3, Mail). Chaque instance est indépendante des instances gDocs, avec son propre `template_id`. En interne : copie du template vers un Google Doc temporaire, remplissage des balises (même mécanisme que gDocs), export en PDF, suppression définitive du document temporaire (jamais visible dans `mmm_outputs`). Écrit `{"filename": ..., "url": ..., "createdAt": ...}` sous la clé `pdf[i]`.

Pas de clé `share` pour PDF (un PDF exporté n'a pas de notion d'édition collaborative à gérer).

### Validation et formatage des balises (règle commune à gDocs, PDF, et à tout champ dynamique de Mail)

Syntaxe : `{{variable}}`, `{{variable[modificateurs]}}`, ou `{{variable:type[modificateurs]}}` (type omis = `string`).

- Colonne correspondante **absente** du Sheet → `Erreur` immédiate.
- Colonne présente, cellule **vide**, sans modificateur `required` → autorisé, substitué par une chaîne vide.
- Colonne présente, cellule vide, avec `required` → `Erreur` immédiate.
- Modificateur inconnu, ou incompatible avec le type déclaré → `Erreur` de configuration du template.
- Les modificateurs sont appliqués **dans l'ordre où ils apparaissent** dans la liste — l'ordre d'écriture change le résultat (ex: `[lowercase, capitalize]` normalise la casse puis capitalise, ce qui diffère de `[capitalize, lowercase]`).
- **Génériques** (tous types) : `required`, `uppercase`, `lowercase`, `capitalize` (met en majuscule la première lettre de chaque mot, sans modifier le reste — gère correctement les caractères accentués, ex: `"élodie"` → `"Élodie"`).
- **Type `string`** : `initial` (premier caractère + point, toujours en majuscule).
- **Type `date`** : `format:<token>` (ex: `MMMM`, `yyyy`, `MM`, `dd`), locale française par défaut. Si aucun `format:...` n'est présent, le format par défaut de l'application (`defaultDateFormat`, voir §4) est utilisé — ce n'est pas une erreur de l'omettre.

Exemple : `{{nom:string[required, uppercase]}}` `{{pronom:string[required, uppercase, initial]}}` `{{date:date[required, format:MMMM, lowercase]}}` `{{date:date[required, format:yyyy]}}` → `DUPONT M. juillet 2026`.

### Référencer un lien déjà généré (`{{link:...}}`)

Dans `mail[i].subject`, `mail[i].to`, `mail[i].cc`, ou le corps du mail, une syntaxe distincte permet de référencer l'URL d'une instance déjà générée (par opposition à `{{variable}}` qui lit toujours une colonne du Sheet) : `{{link:gdocs[0]}}` ou `{{link:pdf[0]}}`.

- Référence vers une instance qui n'existe pas dans le profil → `Erreur` de configuration, détectable statiquement par `--validate` (y compris si cette référence se trouve dans un fichier `template_html_path` externe, pas seulement dans une chaîne inline).
- Contrairement à `generated` (réservé aux pièces jointes, donc aux `pdf[]` uniquement), `{{link:...}}` accepte aussi bien `gdocs[i]` que `pdf[i]`, puisqu'il s'agit ici d'un lien de consultation et non d'une pièce jointe.

### Mail (tableau d'instances)

Compose et envoie (ou met en brouillon) un ou plusieurs emails par ligne, avec leurs propres destinataire(s), objet, corps, et pièces jointes — issues des fichiers PDF générés et/ou de fichiers externes. Un gDoc ne peut pas être joint à un email — seul un lien de consultation est possible via `{{link:...}}` ci-dessus. Chaque instance :

- `to` (chaîne, avec balises) : **obligatoire, jamais de valeur par défaut**.
- `cc` (tableau de chaînes, chacune pouvant contenir des balises, optionnel).
- `subject` (chaîne, avec balises).
- Corps du message : **exactement une** des deux clés `template_html` ou `template_html_path`.
- `draft_only` (booléen).
- `attach` (`all` | `generated` | `external` | `none`) : détermine quelles pièces jointes sont utilisées, avec une correspondance stricte et symétrique entre le mode choisi et les listes remplies :
  - `all` : **les deux** listes (`generated` et `external`) doivent être non vides.
  - `generated` : `generated` doit être non vide, et `external` doit être vide (sinon `Erreur` — une liste renseignée mais ignorée par le mode choisi est un signe probable d'erreur de configuration, pas un cas silencieux).
  - `external` : `external` doit être non vide (+ `externalFolder` requis), et `generated` doit être vide.
  - `none` : `generated` **et** `external` doivent être vides tous les deux.
- `generated` (tableau de références **d'instances PDF uniquement**, ex: `["pdf[0]", "pdf[2]"]`) : référence directement des instances `pdf[]` déclarées dans **ce même profil**. Une référence à une instance `gdocs[]` est une `Erreur` de configuration (un gDoc ne s'attache pas). Validable statiquement (`--validate`) : chaque référence doit correspondre à une instance `pdf[]` existante, aucun doublon.
- `externalFolder` (chaîne avec balises, requis si `external` est utilisé) : chemin du dossier Drive dans lequel chercher les fichiers désignés par `external` (résolution dynamique identique à `output_folder`, voir architecture.md §7 — mais toujours stricte, jamais soumise à `autoCreateFolders`).
- `external` (tableau de chaînes avec balises) : chaque entrée se résout en un nom de fichier à chercher dans `externalFolder`.
  - `Erreur` si un nom résolu est introuvable dans le dossier, si plusieurs fichiers y portent ce nom exact (ambiguïté), ou si deux entrées du tableau se résolvent au même nom (doublon).
- Écrit `{"subject": ..., "url": ..., "attachments": [...], "createdAt": ...}` dans `mmm_outputs` sous la clé `mail[i]` (`attachments` = les `filename` effectivement joints, toutes sources confondues).

---

## 4. Système de Configuration (JSON & CLI)

Le script s'exécute en passant le nom d'un profil de configuration : `mmmerge <nom-du-profil> [options]`.

### Paramètres Globaux

- `sheetId`, `sheetTabName`.
- `autoCreateFolders` (booléen, **défaut `true`**) : si un segment d'un chemin de dossier de **sortie** (`gdocs[].output_folder` / `pdf[].output_folder`) n'existe pas, il est créé automatiquement (`true`, défaut) ou déclenche une `Erreur` (`false`). Avertissement loggé à chaque création automatique de segment. Ne s'applique **jamais** à un dossier d'entrée (`mail[i].externalFolder`), toujours strict.
- `defaultDateFormat` (chaîne, token `date-fns`, **défaut `d/M/yyyy`**) : format utilisé pour une balise de type `date` sans modificateur `format:...` explicite. Distinct du format fixe de `mmm_last_run` (§1), qui n'est pas personnalisable.

Un module est actif dès lors que son tableau est non vide (`gdocs`/`pdf`/`mail` non vides) — pas de clé de filtrage séparée.

### Paramètres Par Module

- **`gdocs`** (tableau) : `template_id`, **exactement une** des deux clés `output_folder` (chemin, balises autorisées, résolu dynamiquement — voir architecture.md §7) ou `output_folder_id`, `output_filename` (chaîne, avec ou sans balises), `share` (optionnel, voir §3), `name`/`description` (optionnels, voir §3).
- **`pdf`** (tableau, même structure que `gdocs`, sans `share`) : `template_id`, `output_folder` / `output_folder_id`, `output_filename`, `name`/`description`.
- **`mail`** (tableau) : voir §3 pour le détail des clés (`to`, `cc`, `subject`, `template_html`/`template_html_path`, `draft_only`, `attach`, `generated`, `externalFolder`, `external`, `name`/`description`).

### Hiérarchie de Configuration

1. Options explicites de la ligne de commande.
2. Fichier de profil local.
3. Configuration globale par défaut de l'application.

### Surcharge des clés de configuration via CLI

Syntaxe générale : `--[clé]` ou `--[clé]=[valeur]`, réservée aux **paramètres globaux uniquement** (ex: `--sheetId=...`, `--autoCreateFolders=false`, `--defaultDateFormat=d/M/yyyy`). `gdocs`, `pdf`, et `mail`, étant des tableaux d'instances, ne se configurent que via le fichier de profil.

---

## 5. Commandes CLI (Système)

- `--dry-run` : Simule l'exécution (affichage console, avertissements compris) sans écrire sur Google Drive, Sheets ou Gmail.
- `--lines=4,14,15` : Restreint le traitement aux lignes spécifiées. Une ligne demandée qui n'existe pas dans le tableau de données (hors bornes, ou ligne 1 — l'en-tête) déclenche une `Erreur` explicite avant même l'authentification, plutôt que d'être silencieusement ignorée.
- `--force` : Force la ré-exécution intégrale sur les lignes ciblées, quel que soit leur `mmm_status`.
- `--validate` : Vérifie, **sans lire une seule ligne de données du Sheet** : la cohérence statique du profil (déjà assurée par la validation Zod à chaque lancement — références `generated`/`{{link:...}}` des instances Mail comprises), l'accessibilité du Sheet et de ses colonnes `mmm_*`, et l'accessibilité Drive de chaque `template_id`/`output_folder_id` référencé par `gdocs[]`/`pdf[]`. Toutes les ressources introuvables sont listées ensemble. `output_folder` (chemin dynamique avec balises) n'est **pas** vérifié : sa résolution dépend d'une ligne réelle, hors du périmètre de `--validate`.
- `--init-columns` : Crée automatiquement les colonnes système `mmm_status`/`mmm_outputs`/`mmm_last_run` si elles sont absentes de l'en-tête du Sheet (ajoutées en fin de ligne 1), au lieu de lever une `Erreur`. Sans ce flag, des colonnes manquantes sont toujours une `Erreur` explicite (les listant toutes) — pas de création automatique par défaut.
- `--verbose` : Détail technique complet des appels API en console.

---

## 6. Hors Scope (MVP)

- **Détection automatique des fichiers orphelins** en cas de crash technique non intercepté entre la création d'une instance et l'écriture incrémentale de `mmm_outputs` (la fenêtre d'exposition est réduite par l'écriture incrémentale, §2, mais pas éliminée).
- **Nettoyage automatique des brouillons Gmail** de tentatives précédentes (§2, §3) — une ligne relancée plusieurs fois avec `draft_only: true` peut accumuler des brouillons, à supprimer manuellement si besoin.
- **Filtre de condition par profil** : restreindre le traitement aux lignes respectant des conditions sur les colonnes du Sheet, appliqué *avant* toute écriture de statut. Non implémenté ; l'architecture doit prévoir son emplacement (avant la création du `RowContext`).
- **Registre de types/formatteurs étendu** : au-delà de `string`/`date` et de leurs modificateurs actuels. Également envisagé : déclarer des variables requises/typées au niveau du profil plutôt qu'inline.
- **`processHidden`** : choisir explicitement de traiter ou d'ignorer les lignes masquées (actuellement toujours ignorées avec alerte).
- **Export PDF direct** (sans passer par un Google Doc temporaire), à évaluer plus tard si l'API le permet.
- **`ProfileManager`/`ExecutionDispatcher`** : gestion des profils via interface web, et répartition automatique des lignes d'un même Sheet vers plusieurs profils. Idée en réflexion, non détaillée davantage pour l'instant.
