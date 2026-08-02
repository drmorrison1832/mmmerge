# Spécifications Techniques & Fonctionnelles : "MMMerge"

> **Dernière mise à jour :** 2026-08-02 — v22
> **Résumé des derniers changements :** Correction d'un bug de perte de données (§2) : la purge en début de ligne mettait à la corbeille (et perdait la trace dans `mmm_outputs`) le fichier d'une instance `gdocs[i]`/`pdf[i]` désactivée ou dont le `filter` ne correspondait pas à la ligne — alors que cette instance ne va simplement pas s'exécuter cette fois-ci, ce n'est ni un résidu ni une régénération. Un module mis en pause (`disable: true`), ou une ligne qui ne correspond temporairement plus à un filtre, effaçait ainsi un fichier valide sans jamais le régénérer. La purge distingue désormais explicitement : instance orpheline (retirée du profil) → purgée normalement ; instance active qui va se régénérer cette ligne → purgée normalement ; instance désactivée ou filtrée pour cette ligne → **ni purgée, ni perdue** (fichier conservé sur Drive, entrée conservée telle quelle dans `mmm_outputs`). S'applique aussi à `mail[i]` (jamais purgé, mais son entrée disparaissait quand même de `mmm_outputs` si désactivé/filtré — désormais conservée). Voir architecture.md v24 pour le détail technique.
>
> **Résumé v21 (2026-08-02) :** Nouveau module `columns` (§2, §3), tableau d'instances comme `gdocs`/`pdf`/`mail` : calcule une valeur (même syntaxe de balise que pour un nom de fichier) et l'écrit dans une colonne du Sheet (`output_column`), créée automatiquement si absente de l'en-tête — sans flag à activer, contrairement à `--init-columns` (colonnes système uniquement). S'exécute en **premier**, avant `gdocs[]`/`pdf[]`/`mail[]` : la valeur écrite est immédiatement utilisable via `{{output_column}}` par les instances suivantes de la même ligne. Accepte `name`/`description`/`disable`/`filter` comme les trois autres modules. Pas de `mmm_outputs` (pas un fichier à tracer/purger). Le résumé de fin d'exécution (§5) gagne une ligne "Colonnes renseignées". `output_column` ne peut pas être un nom de colonne système réservé — `Erreur` de configuration. Voir architecture.md v23 pour le détail technique.
>
> **Résumé v20 (2026-08-02) :** Correction sur `filter` (§3, v19) : la comparaison `equals` est désormais **insensible à la casse** (`"CDD"` équivaut à `"cdd"`) — toujours sans normalisation des espaces (`" CDD"` ≠ `"CDD"`). Voir architecture.md v22 pour le détail technique.
>
> **Résumé v19 (2026-08-02) :** Nouvelle clé `filter` (§3), commune à `gdocs`/`pdf`/`mail` : exécution conditionnelle **par ligne** (par opposition à `disable`, statique) — l'instance n'est exécutée pour une ligne donnée que si les valeurs de ses colonnes satisfont la condition configurée. Forme : `{ "match": "all" | "any" | "none", "conditions": [{ "label", "criterium": "equals", "value" }, ...] }` — comparaison stricte, sensible à la casse (voir correction ci-dessus). Colonne référencée absente du Sheet → `Erreur` immédiate (même règle que pour une balise de template). Instance filtrée pour une ligne → simplement ignorée pour cette ligne (comme `disable`, mais décidé ligne par ligne, jamais une `Erreur`), journalisé hors `--quiet`. Le résumé de fin d'exécution (§5) compte désormais les sorties **réellement produites** plutôt que `lignes traitées × instances actives`, qui aurait surcompté dès qu'un filtre exclut une instance sur certaines lignes. Contrairement à `disable`, une référence `generated`/`{{link:...}}` vers une instance filtrée ne peut pas être détectée statiquement (la ligne n'est pas connue au chargement du profil) : si une instance Mail référence (`generated`) une instance PDF dont le filtre n'a pas été satisfait pour la ligne en cours, le message d'erreur le précise désormais explicitement plutôt que de laisser un simple "introuvable" sans piste. Voir architecture.md v21 pour le détail technique.
>
> **Résumé v18 (2026-08-01) :** `mmmerge` fonctionne désormais depuis n'importe quel dossier une fois lié via `npm link` (`configs/`/`credentials.json`/`token.json` résolus depuis l'emplacement du script, plus depuis le dossier courant). La confirmation de succès du logging de progression (§5) devient une ligne compacte `→ OK` plutôt que la répétition du message complet. Voir architecture.md v20 pour le détail technique.
>
> **Résumé v17 (2026-08-01) :** `--verbose` réintroduit (§5), avec un rôle entièrement différent de son ancien sens (v13, où il gouvernait le logging de progression — rôle repris par le fait que ce logging est désormais actif par défaut) : affiche en fin d'exécution le détail ligne par ligne de chaque document/email généré, groupé par instance. Indépendant de `--quiet`. `mmm_outputs.mail[i]` (§1) gagne un champ `to` (destinataire résolu), nécessaire pour ce détail. Voir architecture.md v19 pour le détail technique.
>
> **Résumé v16 (2026-07-31) :** Nouveau champ `template_link` (§3, `gdocs`/`pdf` uniquement) : chaîne libre purement informative (typiquement l'URL du template), jamais lue par l'application — un aide-mémoire pour l'utilisateur. Correction d'une régression sur l'affichage des erreurs fatales : la trace de pile technique s'affichait par défaut au lieu d'un message clair (introduit par erreur lors du remplacement de `--verbose` par `--quiet` en v13), pouvant faire passer une simple erreur de saisie (ex: `--lines=1`, qui cible la ligne d'en-tête) pour un crash. Toujours `Erreur : <message>` désormais, quel que soit `--quiet`. Voir architecture.md v18 pour le détail technique.
>
> **Résumé v15 (2026-07-31) :** Deux corrections. (1) Module PDF (§3) : l'extension `.pdf` est désormais ajoutée automatiquement à `output_filename` si absente — un fichier créé sur Drive sans extension pouvait ne pas s'ouvrir correctement selon le client, et affectait aussi le nom de la pièce jointe d'un email qui joint ce PDF. (2) Nouveau modificateur `nospace` (§3), types `number`/`euro` : retire le séparateur de milliers du résultat, pour les cas où la valeur est destinée à être copiée-collée dans un champ qui rejette tout espace. Voir architecture.md v17 pour le détail technique des deux.
>
> **Résumé v14 (2026-07-30) :** Nouvelle clé `disable` (§3), commune à `gdocs`/`pdf`/`mail` : désactive une instance sans la retirer du profil ni décaler les index des autres — pensée pour désactiver temporairement un module en cours de configuration d'un profil. Une instance `mail[]` référençant (`generated`/`{{link:...}}`) une instance désactivée est une `Erreur` de configuration au chargement du profil (extension de la validation statique déjà existante pour une référence vers une instance inexistante), jamais une erreur en cours d'exécution. `--validate` (§5) ignore les instances désactivées lors de la vérification d'accessibilité Drive. Le résumé de fin d'exécution (§5) ne compte plus que les instances actives. Nouvelle notification de démarrage listant les modules désactivés, affichée même sous `--quiet`. Voir architecture.md v16 pour le détail technique.
>
> **Résumé v13 (2026-07-23) :** Suite à un signalement utilisateur (exécution figée sans aucun message console, impossible de savoir ce qui se passait) : le logging de progression en temps réel (§5), auparavant limité à `--verbose` (ligne/instance en cours uniquement, implémentation partielle documentée comme telle depuis v6), devient la **valeur par défaut**, et couvre désormais chaque appel réseau individuellement (pas seulement le niveau ligne/instance) — voir architecture.md v15 pour le détail technique. `--verbose` est remplacé par `--quiet`, qui restaure l'affichage minimal des versions précédentes.
>
> **Résumé v12 (2026-07-23) :** Nouveau type de balise `euro` (§3) : montant formaté selon la typographie française native (`Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`) — séparateur de milliers en espace fine insécable, espace insécable avant `€`, vérifiés en conditions réelles sur un document existant. Nombre de décimales automatique (0 si le montant est rond après arrondi au centime, 2 sinon), `format:<n>` disponible pour l'imposer explicitement. Voir architecture.md v14 pour le détail technique (arrondi robuste aux imprécisions flottantes, ex: `12,335` → `12,34 €`).
>
> **Résumé v11 (2026-07-23) :** Correction d'un bug (§1) : deux colonnes du Sheet portant le même titre étaient silencieusement fusionnées (la valeur de la dernière écrasant celle des précédentes dans `rawData`, ou dans la résolution des colonnes réservées `mmm_*`) au lieu de lever une erreur — voir architecture.md v13 pour le détail technique.
>
> **Résumé v10 (2026-07-23) :** Nouveau type de balise `number` (§3) : formate une valeur numérique de cellule en notation française (séparateur de milliers, virgule décimale — ex: `1123.43` → `1 123,43`) au lieu de la notation JS par défaut (point décimal, sans séparateur de milliers), qui apparaissait telle quelle dans les documents générés quand une cellule numérique était utilisée sans type déclaré (type `string` implicite). `format:<n>` (`n` = décimales fixes) disponible en complément. Se combine correctement avec `prefix(...)`/`suffix(...)` même sans `format:` explicite (ex: `{{brut_total:number[suffix( €)]}}` → `1 123,43 €`) — voir architecture.md v12 pour le détail d'un bug corrigé au passage sur l'ordre d'application des modificateurs.
>
> **Résumé v9 (2026-07-23) :** Correction d'un bug (constaté en test réel) : une balise invalide dans un template gDocs/PDF (ex: type inconnu) pouvait laisser un fichier orphelin sur Drive — une copie du template, sans aucun remplacement, jamais référencée dans `mmm_outputs` et donc jamais nettoyée par la purge (§2). Les balises du template sont désormais résolues **avant** toute copie ; une erreur de balise n'a donc plus aucun effet sur Drive. Voir architecture.md v11 pour le détail technique.
>
> **Résumé v8 (2026-07-22) :** Nouveaux modificateurs génériques `prefix(texte)`/`suffix(texte)` (§3) : ajoutent `texte` avant/après la valeur d'une balise, uniquement si la cellule n'est pas vide — résout le problème des espaces doubles/orphelins quand plusieurs champs optionnels se suivent dans un template (ex: prénoms multiples). Contenu pris à la lettre, peut contenir une virgule, utilisable à n'importe quelle position dans la liste de modificateurs.
>
> **Résumé v7 (2026-07-22) :** Suite à une relecture externe du code. Nouveau flag `--list` (§5) : liste les lignes éligibles (numéro + statut actuel) sans exécuter le pipeline. Nouveau flag `--help-templates` (§5) : affiche la syntaxe des balises, utilisable sans profil. Résumé final systématique en fin d'exécution (lignes traitées, documents/PDF/emails générés, ligne en cause si arrêt sur erreur) — hors `--validate`/`--list`. Messages d'ambiguïté de dossier/fichier externe (§3, §7) incluent désormais les IDs Drive des éléments en conflit.
>
> **Résumé v6 (2026-07-22) :** `mmm_outputs` : chaque entrée `mail[i]` gagne un champ `draftOnly` (reflète `draft_only` de l'instance), pour interpréter `url` sans consulter le profil (§1). Le lien de brouillon (`#drafts?compose=<id>`) est documenté comme fragile — cesse de fonctionner si le brouillon est modifié/restauré après coup, limite de la plateforme Gmail plutôt qu'un défaut MMMerge ; retenu quand même car aucune alternative (lien générique vers le dossier Brouillons) n'apporte d'information utile.
>
> **Résumé v5 (2026-07-22) :** URLs Gmail (§1) vérifiées en conditions réelles et corrigées suite au test : un brouillon s'ouvre via `https://mail.google.com/mail/u/0/#drafts?compose=<id>` (pas `#drafts/<id>`, qui ne fonctionne plus dans l'UI Gmail actuelle), et `<id>` est l'identifiant du **message** sous-jacent, pas celui du brouillon lui-même. URL d'un mail envoyé (`#sent/<id>`) confirmée correcte telle quelle.
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
    "to": "marie.dupont@example.com",
    "subject": "Votre contrat de juillet",
    "url": "https://mail.google.com/mail/u/0/#drafts?compose=ghi789",
    "draftOnly": true,
    "attachments": ["CDDU Marie Dupont"],
    "createdAt": "2026-07-05T14:32:18Z"
  }
}
```

**Note sur l'exemple `mail[0]`** : `to` est le destinataire déjà résolu (balises substituées) pour cette ligne — utilisé notamment par `--verbose` (§5) pour afficher le détail des emails composés sans avoir à re-résoudre `to` depuis le profil. `draftOnly` reflète directement la valeur de `draft_only` de l'instance — permet de savoir comment interpréter `url` sans avoir à consulter le profil. Pour un brouillon (`draft_only: true`), l'URL suit le format `#drafts?compose=<id>` — **vérifiée en conditions réelles**, mais **fragile** : elle cesse de fonctionner si le brouillon est ensuite modifié ou restauré depuis la corbeille (l'ancien format `#drafts/<id>` ne fonctionne plus du tout dans l'UI Gmail actuelle). Cette fragilité est une limite de la plateforme Gmail, pas un bug MMMerge — le lien reste la meilleure option disponible juste après la génération. Pour un mail réellement envoyé (`draft_only: false`), l'URL `#sent/<id>` est stable — **vérifiée en conditions réelles**.

**Colonnes système absentes du Sheet** : par défaut, une `Erreur` explicite liste toutes les colonnes `mmm_*` manquantes d'un coup. Le flag `--init-columns` (§5) permet de les créer automatiquement (ajoutées en fin d'en-tête) plutôt que d'échouer — pas de création automatique par défaut, pour ne pas masquer silencieusement une vraie erreur de configuration (mauvais `sheetTabName`/`sheetId`).

**Deux colonnes portant le même titre dans l'en-tête** (réservées ou libres) → `Erreur` explicite avant toute lecture de ligne, listant le(s) titre(s) en double. Un titre dupliqué est ambigu par nature : `rawData` (construit par colonne, voir architecture.md §3) ne peut retenir qu'une valeur par nom de balise, et la résolution des colonnes réservées `mmm_*` ne peut pointer que sur un seul index — silencieux sinon (retiendrait arbitrairement la première occurrence). Les en-têtes vides ne comptent pas comme doublons entre eux.

**Attention aux zéros non significatifs** : les valeurs des cellules sont lues sans mise en forme (nombre brut plutôt que texte affiché), ce qui garantit une lecture fiable des dates quel que soit leur affichage — mais une colonne contenant des codes à zéros non significatifs (ex: un code postal `01000`) doit être formatée en "Texte brut" dans Google Sheets, sinon le zéro de tête serait perdu à la lecture.

**Si une colonne de type `date` contient une valeur non numérique** (ex: une cellule formatée en "Texte brut" contenant `"27/06/2026"` plutôt qu'une vraie date Sheets) → `Erreur` explicite, plutôt qu'une date invalide silencieuse.

### Comportement en cas d'erreur

Si un module (ou une instance) rencontre une erreur métier, le détail est loggé dans la console, puis inscrit dans `mmm_status` (format `Erreur: <module> - <détail>`, où `<module>` précise l'instance en cause (ex: `pdf[1]`), accompagnée de son `name` entre parenthèses s'il est configuré (ex: `Erreur: pdf[1] ("Copie contrat pour archives") - fichier introuvable`)) — **cette écriture doit être confirmée avant que le script ne s'arrête**. Une fois l'écriture terminée, l'exécution globale du script est interrompue (Crash / Exit).

En cas de crash technique non intercepté, la ligne peut rester bloquée à `En cours d'exécution` — rattrapée par la règle de reprise (§2) à la prochaine exécution, `mmm_last_run` permettant de juger si ce blocage est récent ou ancien.

---

## 2. Architecture Modulaire & Cycle de vie du Pipeline

Le pipeline suit quatre phases :

```
[Filtre des lignes à traiter] → [Colonnes calculées] → [Création de fichiers : gDocs, PDF, ...] → [Mail]
```

gDocs et PDF restent deux modules indépendants, chacun en tableau d'instances (voir §3). Il n'y a pas de phase Attachment séparée : chaque instance Mail résout ses propres pièces jointes en interne, puisque des instances Mail différentes peuvent avoir besoin de combinaisons différentes pour une même ligne.

La phase "Colonnes calculées" (`columns[]`, §3) s'exécute en premier, avant même `gdocs[]` : une valeur qu'elle écrit devient immédiatement utilisable via une balise `{{...}}` normale par les phases suivantes, pour la même ligne.

Au sein de la phase "Création de fichiers" : toutes les instances `gdocs[]` s'exécutent d'abord dans l'ordre du tableau, puis toutes les instances `pdf[]`. Ensuite, toutes les instances `mail[]` s'exécutent dans l'ordre du tableau.

Après la création de chaque fichier (gDocs, PDF) ou l'envoi/mise en brouillon de chaque email (Mail), `mmm_outputs` et `mmm_last_run` sont mis à jour immédiatement, plutôt que d'attendre la fin complète de la ligne — pour une instance gDocs avec `share` configuré, cette écriture précède la tentative de partage (voir §3), afin qu'un échec de partage n'orpheline jamais un fichier réellement créé. Ceci réduit la fenêtre d'exposition aux fichiers orphelins en cas de crash non intercepté, au prix d'un appel Sheets par instance plutôt qu'un seul par ligne (négligeable au volume visé par cette application).

### Règle d'Idempotence, Reprise et Ré-exécution intégrale

- Une ligne est éligible si sa colonne `mmm_status` est vide, vaut exactement `En cours d'exécution`, ou commence par `Erreur:` — liste blanche stricte. Toute autre valeur exclut la ligne, silencieusement.
- Cette règle permet une **exclusion manuelle intentionnelle** (ex: `skip`, ou un texte descriptif) directement dans le Sheet — distincte du filtre de condition par profil (§6, non implémenté).
- Une ligne éligible déclenche une **ré-exécution intégrale et systématique de tout le pipeline depuis le début**. Avant toute nouvelle génération, chaque entrée `gdocs[i]`/`pdf[i]` déjà présente dans `mmm_outputs` est traitée selon l'instance correspondante dans le profil **actuel** :
  - Instance introuvable dans le profil (retirée depuis la dernière exécution) → orpheline, son fichier Drive est envoyé à la corbeille et l'entrée disparaît de `mmm_outputs` — aucune configuration ne la référence plus, rien ne la nettoiera jamais autrement.
  - Instance présente, active, et qui va s'exécuter pour cette ligne (ni `disable`, ni `filter` non satisfait) → son ancien fichier est envoyé à la corbeille (elle est sur le point d'en générer un nouveau) et l'entrée disparaît de `mmm_outputs` (une nouvelle y sera écrite dès que l'instance s'exécute).
  - Instance présente mais désactivée (`disable: true`), ou dont le `filter` n'est pas satisfait pour cette ligne → **ni purgée, ni perdue** : le fichier reste sur Drive et son entrée est conservée telle quelle dans `mmm_outputs`, puisque cette instance ne va simplement pas s'exécuter cette fois-ci — ce n'est ni un résidu ni une régénération. (Avant l'introduction de `filter`/l'usage courant de `disable` en cours d'exécution, la purge ne distinguait pas ce cas — c'était une perte de données non désirée : un module mis en pause, ou une ligne qui ne correspond plus temporairement à un filtre, effaçait un fichier valide sans jamais le régénérer.)
  - Une entrée `mail[i]` n'est **jamais** mise à la corbeille (voir ci-dessous), mais suit la même logique de conservation dans `mmm_outputs` : préservée si son instance est désactivée/filtrée pour cette ligne, abandonnée sinon (régénérée si active, ou simplement orpheline si l'instance a été retirée du profil).
  Un avertissement est loggé pour chaque fichier mis à la corbeille. Si la mise à la corbeille d'un fichier échoue (ex: déjà supprimé manuellement entre deux exécutions), l'échec est loggé mais **n'interrompt pas** la ligne — la régénération se poursuit normalement. Si le `filter` d'une instance ne peut pas être évalué ici (ex: colonne référencée absente), la purge ne tranche pas et préserve l'entrée par sécurité — la même erreur de configuration sera de toute façon levée normalement dès que l'exécution de la ligne atteint cette instance.
- Les brouillons/emails déjà créés par une instance `mail[i]` lors d'une exécution précédente ne sont **pas** nettoyés (voir §3, §6) : relancer plusieurs fois une ligne avec `draft_only: true` peut laisser plusieurs brouillons dans Gmail.

### `--force`

Ignore entièrement la vérification de statut : toute ligne ciblée est retraitée quel que soit son `mmm_status` actuel.

### Lignes masquées

Pour le MVP, toute ligne masquée dans le Google Sheet est **ignorée**, avec une alerte loggée par ligne masquée ignorée.

---

## 3. Description des Modules

### Nom, description et désactivation (`name`, `description`, `disable`) — communs à toutes les instances

Chaque instance (Columns, gDocs, PDF, ou Mail) accepte trois clés optionnelles :
- `name` (chaîne, ≤ 80 caractères) : un intitulé court et lisible (ex: `"CDDU en PDF"`, `"Mail notification manager"`). N'affecte **aucune** référence technique — `generated`, `{{link:...}}`, et les messages d'erreur continuent d'utiliser l'identifiant de position (`gdocs[0]`, `pdf[1]`...) comme référence stable. Quand `name` est renseigné, il s'affiche simplement **en plus** de cet identifiant dans les messages d'erreur.
- `description` (chaîne, ≤ 500 caractères) : notes libres à l'usage de l'utilisateur, jamais utilisées par le système.
- `disable` (booléen, défaut `false`) : contrairement aux deux clés précédentes, **affecte le comportement**. Une instance désactivée n'est jamais exécutée pour aucune ligne — aucun appel Drive/Docs/Gmail, aucune entrée écrite dans `mmm_outputs`. Elle **conserve son identifiant de position** (désactiver `gdocs[0]` ne renomme pas `gdocs[1]` en `gdocs[0]`), pour ne jamais invalider silencieusement une référence `generated`/`{{link:...}}` ailleurs dans le profil. Objectif principal : pouvoir désactiver temporairement un module en cours de configuration d'un profil (ex: template pas encore prêt), sans avoir à le retirer et le rajouter au tableau.
  - Une instance `mail[]` référençant (`generated` ou `{{link:...}}`) une instance désactivée est une `Erreur` de **configuration**, levée au chargement du profil — jamais une erreur d'exécution au milieu d'une ligne. C'est une extension directe de la règle déjà existante pour une référence vers une instance inexistante (voir `{{link:...}}` ci-dessous) : `disable` étant un réglage fixe du profil (jamais dépendant d'une ligne du Sheet), la validité d'une référence vers une instance désactivée est toujours connue statiquement.
  - Si toutes les instances de tous les modules sont désactivées (ou si tous les tableaux sont simplement vides), chaque ligne éligible se termine en `Succès` sans qu'aucune sortie ne soit générée — comportement déjà existant pour un profil sans aucune instance configurée, `disable` n'étant qu'une seconde façon d'y arriver.

### Exécution conditionnelle par ligne (`filter`) — communs à toutes les instances

Une quatrième clé optionnelle, disponible sur `gdocs`/`pdf`/`mail` comme `disable` ci-dessus, mais avec une différence fondamentale : `disable` est un réglage **statique** du profil (jamais dépendant d'une ligne du Sheet), `filter` est évalué **pour chaque ligne**, à partir de ses propres valeurs de colonnes.

```json
"filter": {
  "match": "all",
  "conditions": [
    { "label": "Statut", "criterium": "equals", "value": "Actif" },
    { "label": "Type", "criterium": "equals", "value": "CDD" }
  ]
}
```

- `conditions` (tableau non vide) : chaque condition compare la valeur d'une colonne (`label`) à une valeur attendue (`value`) selon un `criterium` — pour l'instant, uniquement `equals` (insensible à la casse — `"CDD"` et `"cdd"` sont équivalents — mais sans normalisation des espaces : `" CDD"` ne correspond pas à `"CDD"`).
- `match` combine les résultats des conditions : `all` (toutes doivent être vraies — ET), `any` (au moins une — OU), `none` (aucune — NI l'une ni l'autre, négation de `any`). Ce seul combinateur, appliqué à des conditions atomiques d'égalité, couvre déjà "cette valeur parmi plusieurs" (`any` sur des conditions répétant le même `label`) et sa négation, sans qu'un opérateur de comparaison supplémentaire soit nécessaire au MVP.
- Colonne référencée (`label`) absente du Sheet → `Erreur` immédiate (même règle que pour une balise de template référençant une colonne absente, voir ci-dessus) — jamais un simple "condition non satisfaite" silencieux, qui masquerait une faute de frappe dans le profil.
- Une instance dont le `filter` n'est pas satisfait pour une ligne donnée est **ignorée pour cette ligne uniquement** (comme `disable`, sans erreur ni appel Drive/Docs/Gmail), mais reste normalement exécutée pour toute autre ligne qui satisfait la condition. Un avertissement est journalisé (hors `--quiet`).
- Contrairement à `disable`, une référence `generated`/`{{link:...}}` vers une instance filtrée ne peut **jamais** être invalidée statiquement (validable par `--validate`) : la valeur des colonnes qui décide du filtre n'est connue qu'au moment de traiter une ligne réelle. Si une instance Mail référence (`generated`) une instance PDF dont le filtre n'a pas été satisfait pour la ligne en cours, l'erreur "référence introuvable" (voir §3, Mail, ci-dessous) précise explicitement que l'instance référencée a un filtre configuré — piste immédiate sans avoir à consulter le profil.

### Colonnes calculées (`columns`, tableau d'instances)

Calcule une valeur à partir des colonnes (et, transitivement, des colonnes déjà calculées par une instance `columns[]` précédente sur la même ligne — voir ordre d'exécution, §2) en réutilisant exactement la même syntaxe de balise que pour un nom de fichier ou un corps d'email (`{{variable}}`, types, modificateurs — voir "Validation et formatage des balises" ci-dessous), puis écrit le résultat dans une colonne du Sheet, pour cette ligne. Chaque instance :

- `template` (chaîne, avec balises) : la valeur à calculer — mêmes règles de résolution que `output_filename`/`subject`.
- `output_column` (chaîne, nom littéral de colonne — **jamais** de balise) : le titre de la colonne cible. Si cette colonne n'existe pas encore dans l'en-tête du Sheet, elle est **créée automatiquement** (ajoutée en fin d'en-tête), sans flag à activer — contrairement à `--init-columns` qui ne concerne que les 3 colonnes système. Ne peut pas être l'un des noms réservés `mmm_status`/`mmm_outputs`/`mmm_last_run` — `Erreur` de configuration immédiate au chargement du profil.
- S'exécute **avant** `gdocs[]`/`pdf[]`/`mail[]` (§2) : la valeur écrite est immédiatement disponible pour ces instances via une balise `{{output_column}}` ordinaire, exactement comme n'importe quelle autre colonne du Sheet.
- Pas d'entrée dans `mmm_outputs` : une colonne calculée n'est pas un fichier à purger/tracer, juste une cellule recalculée à chaque exécution de la ligne, comme n'importe quelle autre écriture de cellule.
- Deux instances `columns[]` ciblant la même `output_column` ne sont pas rejetées statiquement (un `filter` peut légitimement les rendre mutuellement exclusives) ; si les deux s'appliquent malgré tout à une même ligne, la dernière dans l'ordre du profil l'emporte (exécution séquentielle, §2).

### gDocs (tableau d'instances)

Génère un ou plusieurs documents Google Docs remplis à partir d'un template, destinés à être consultés/édités directement, partagés, ou dont une version PDF sera générée séparément (voir §3, module PDF). Chaque instance copie son propre template Google Doc dans le dossier configuré, applique le mapping des balises (résolution "par tag", voir architecture.md §3), sauvegarde le document et écrit `{"filename": ..., "url": ..., "createdAt": ...}` dans `mmm_outputs` sous la clé `gdocs[i]`.

- `template_link` (optionnel, chaîne) : **purement informatif, jamais lu par l'application**. Un aide-mémoire pour retrouver rapidement le template source (typiquement son URL Google Docs) directement depuis le profil, sans avoir à retrouver le document à partir du seul `template_id`. Disponible aussi sur les instances PDF (voir ci-dessous) ; absent des instances Mail, qui n'ont pas de template externe au sens Drive (`template_html`/`template_html_path` sont déjà le template).
- `share` (optionnel) : configure le partage du document généré, indépendamment par email et par lien. Si `share` est présent, **au moins une** des deux clés suivantes doit l'être aussi (un `share` vide est une `Erreur` de configuration) :
  - `share.email` : `{ "addresses": [...] (balises autorisées), "permission": "reader" | "commenter" | "editor" }`.
  - `share.link` : `{ "permission": "reader" | "commenter" | "editor" }`.
  - En cas d'échec en cours de route (ex: la 3ᵉ adresse d'une liste de `addresses` est invalide), les permissions déjà accordées avant l'échec **restent en place** — elles ne sont pas annulées automatiquement. Le fichier lui-même est déjà tracé dans `mmm_outputs` à ce stade (voir §2) ; l'utilisateur peut ensuite accorder l'accès manquant manuellement, ou relancer le traitement de la ligne (le fichier sera mis à la corbeille et régénéré, le partage retenté dans son intégralité).

### PDF (tableau d'instances)

Génère un ou plusieurs fichiers PDF, indépendamment du module gDocs — un PDF est le format à utiliser pour joindre un document à un email (un Google Doc natif ne peut pas être joint tel quel, voir §3, Mail). Chaque instance est indépendante des instances gDocs, avec son propre `template_id`. En interne : copie du template vers un Google Doc temporaire, remplissage des balises (même mécanisme que gDocs), export en PDF, suppression définitive du document temporaire (jamais visible dans `mmm_outputs`). Écrit `{"filename": ..., "url": ..., "createdAt": ...}` sous la clé `pdf[i]`.

**Extension `.pdf` automatique** : `output_filename` n'a pas besoin d'inclure l'extension — elle est ajoutée automatiquement au nom résolu si absente (comparaison insensible à la casse, jamais de doublon si `.pdf`/`.PDF` est déjà présent). Exemple : `output_filename: "CDDU {{Nom}} {{Prenom}}"` avec `Nom = Dupont`, `Prenom = Étienne` → fichier nommé `CDDU Dupont Étienne.pdf`. Cette extension fait aussi partie de `filename` dans `mmm_outputs` et de l'`attachments` d'un email qui joint ce PDF (`generated`) — un fichier joint sans extension pouvait jusqu'ici ne pas s'ouvrir correctement selon le client mail. Ne s'applique qu'au module PDF ; le module gDocs n'a pas d'extension de fichier au sens classique (ce sont des documents Google natifs).

Pas de clé `share` pour PDF (un PDF exporté n'a pas de notion d'édition collaborative à gérer).

### Validation et formatage des balises (règle commune à gDocs, PDF, et à tout champ dynamique de Mail)

Syntaxe : `{{variable}}`, `{{variable[modificateurs]}}`, ou `{{variable:type[modificateurs]}}` (type omis = `string`).

- Colonne correspondante **absente** du Sheet → `Erreur` immédiate.
- Colonne présente, cellule **vide**, sans modificateur `required` → autorisé, substitué par une chaîne vide.
- Colonne présente, cellule vide, avec `required` → `Erreur` immédiate.
- Modificateur inconnu, ou incompatible avec le type déclaré → `Erreur` de configuration du template.
- Les modificateurs sont appliqués **dans l'ordre où ils apparaissent** dans la liste — l'ordre d'écriture change le résultat (ex: `[lowercase, capitalize]` normalise la casse puis capitalise, ce qui diffère de `[capitalize, lowercase]`).
- **Génériques** (tous types) : `required`, `uppercase`, `lowercase`, `capitalize` (met en majuscule la première lettre de chaque mot, sans modifier le reste — gère correctement les caractères accentués, ex: `"élodie"` → `"Élodie"`), `prefix(texte)`/`suffix(texte)` (ajoute `texte` avant/après la valeur — voir ci-dessous).
- **Type `string`** : `initial` (premier caractère + point, toujours en majuscule).
- **Type `date`** : `format:<token>` (ex: `MMMM`, `yyyy`, `MM`, `dd`), locale française par défaut. Si aucun `format:...` n'est présent, le format par défaut de l'application (`defaultDateFormat`, voir §4) est utilisé — ce n'est pas une erreur de l'omettre.
- **Type `number`** : `format:<n>` (`n` = nombre entier de décimales fixes, ex: `format:2` → `1123` devient `1 123,00`). Sans `format:...`, format français par défaut (séparateur de milliers, virgule décimale — ex: `1123.43` → `1 123,43`), sans imposer de nombre de décimales fixe. Valeur non numérique → `Erreur` explicite (même logique que pour le type `date`).
- **Type `euro`** : montant en euros, formaté selon la typographie française — séparateur de milliers en espace fine insécable (ex: `1234.5` → `1 234,50 €`), espace insécable avant `€`. Nombre de décimales **automatique** : 0 si le montant est rond (après arrondi au centime), 2 sinon (ex: `12` → `12 €`, `12,3` → `12,30 €`, `12,335` → `12,34 €`). `format:<n>` impose un nombre de décimales fixe, prioritaire sur cette règle automatique — la mise en forme (espaces, `€`) reste inchangée. Valeur non numérique → `Erreur` explicite (même logique que pour le type `number`).
- **`nospace`** (types `number`/`euro` uniquement) : retire le séparateur de milliers du résultat (ex: `1234,56 €` au lieu de `1 234,56 €`) — motivé par des formulaires externes qui rejettent toute valeur copiée-collée contenant un espace, y compris invisible (espace fine insécable). Ne retire **que** le séparateur de milliers : l'espace insécable avant `€` reste. Contrairement à tous les autres modificateurs, `nospace` n'est **pas positionnel** — il se combine avec `format:<n>` dans n'importe quel ordre, avec le même résultat (les deux agissent sur le même appel de formatage sous-jacent, pas comme une transformation de texte appliquée après coup).

Exemple : `{{nom:string[required, uppercase]}}` `{{pronom:string[required, uppercase, initial]}}` `{{date:date[required, format:MMMM, lowercase]}}` `{{date:date[required, format:yyyy]}}` → `DUPONT M. juillet 2026`.

Exemple (`nospace`) : `{{brut_total:euro[nospace]}}` avec `brut_total = 1234.56` → `1234,56 €` (au lieu de `1 234,56 €`) ; `{{brut_total:euro[nospace, format:2]}}` avec `brut_total = 1234` → `1234,00 €`.

### Modificateurs conditionnels `prefix(texte)` / `suffix(texte)`

Ajoutent `texte` avant/après la valeur résolue de la balise, **uniquement si cette valeur n'est pas vide** (aucun effet, y compris sur une cellule vide sans `required` — le résultat reste `""`). Objectif : chaîner des champs optionnels sans laisser d'espace double ou orphelin quand l'un d'eux est vide.

- Le contenu entre parenthèses est pris **à la lettre**, espaces compris (`prefix( )` ajoute exactement un espace) — jamais retouché par la normalisation des espaces autour des virgules qui s'applique aux autres modificateurs.
- Peut contenir une virgule littérale (`prefix(Bonjour, )`).
- Parenthèses non équilibrées dans la liste de modificateurs → `Erreur` de configuration du template.
- Peut apparaître à n'importe quelle position dans la liste ; comme tout modificateur, l'ordre d'écriture compte (`[prefix(M. ), uppercase]` majuscule aussi le préfixe, `[uppercase, prefix(M. )]` non).

Exemple (prénoms multiples optionnels) : `{{prenom1}}{{prenom2[prefix( )]}}{{prenom3[prefix( )]}} {{nom}}` — avec `prenom2` vide, produit `Étienne Paul Dupont` (pas `Étienne  Paul Dupont`).

Exemple (unité sur un nombre) : `{{brut_total:number[required, suffix( €)]}}` avec `brut_total = 1123.43` → `1 123,43 €`.

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
  - `Erreur` si un nom résolu est introuvable dans le dossier, si plusieurs fichiers y portent ce nom exact (ambiguïté — le message liste les IDs Drive des fichiers en conflit, pour identifier lequel supprimer/renommer), ou si deux entrées du tableau se résolvent au même nom (doublon).
- Écrit `{"to": ..., "subject": ..., "url": ..., "draftOnly": ..., "attachments": [...], "createdAt": ...}` dans `mmm_outputs` sous la clé `mail[i]` (`to` = destinataire résolu, `attachments` = les `filename` effectivement joints, toutes sources confondues — voir §1 pour l'exemple complet).

---

## 4. Système de Configuration (JSON & CLI)

Le script s'exécute en passant le nom d'un profil de configuration : `mmmerge <nom-du-profil> [options]`.

### Paramètres Globaux

- `sheetId`, `sheetTabName`.
- `autoCreateFolders` (booléen, **défaut `true`**) : si un segment d'un chemin de dossier de **sortie** (`gdocs[].output_folder` / `pdf[].output_folder`) n'existe pas, il est créé automatiquement (`true`, défaut) ou déclenche une `Erreur` (`false`). Avertissement loggé à chaque création automatique de segment. Ne s'applique **jamais** à un dossier d'entrée (`mail[i].externalFolder`), toujours strict.
- `defaultDateFormat` (chaîne, token `date-fns`, **défaut `d/M/yyyy`**) : format utilisé pour une balise de type `date` sans modificateur `format:...` explicite. Distinct du format fixe de `mmm_last_run` (§1), qui n'est pas personnalisable.

Un module est actif dès lors que son tableau est non vide (`gdocs`/`pdf`/`mail` non vides) — pas de clé de filtrage séparée.

### Paramètres Par Module

- **`gdocs`** (tableau) : `template_id`, **exactement une** des deux clés `output_folder` (chemin, balises autorisées, résolu dynamiquement — voir architecture.md §7) ou `output_folder_id`, `output_filename` (chaîne, avec ou sans balises), `share` (optionnel, voir §3), `name`/`description`/`disable`/`template_link` (optionnels, voir §3).
- **`pdf`** (tableau, même structure que `gdocs`, sans `share`) : `template_id`, `output_folder` / `output_folder_id`, `output_filename`, `name`/`description`/`disable`/`template_link`.
- **`mail`** (tableau) : voir §3 pour le détail des clés (`to`, `cc`, `subject`, `template_html`/`template_html_path`, `draft_only`, `attach`, `generated`, `externalFolder`, `external`, `name`/`description`/`disable` — pas de `template_link`, qui n'a de sens que pour un template Drive externe).

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
- `--validate` : Vérifie, **sans lire une seule ligne de données du Sheet** : la cohérence statique du profil (déjà assurée par la validation Zod à chaque lancement — références `generated`/`{{link:...}}` des instances Mail comprises, y compris vers une instance désactivée), l'accessibilité du Sheet et de ses colonnes `mmm_*`, et l'accessibilité Drive de chaque `template_id`/`output_folder_id` référencé par `gdocs[]`/`pdf[]` **actives** (`disable` absent ou `false` — une instance désactivée n'a pas besoin de ressources valides, cas d'usage typique en cours de configuration d'un profil). Toutes les ressources introuvables sont listées ensemble. `output_folder` (chemin dynamique avec balises) n'est **pas** vérifié : sa résolution dépend d'une ligne réelle, hors du périmètre de `--validate`.
- `--init-columns` : Crée automatiquement les colonnes système `mmm_status`/`mmm_outputs`/`mmm_last_run` si elles sont absentes de l'en-tête du Sheet (ajoutées en fin de ligne 1), au lieu de lever une `Erreur`. Sans ce flag, des colonnes manquantes sont toujours une `Erreur` explicite (les listant toutes) — pas de création automatique par défaut.
- `--list` : Affiche les lignes éligibles (numéro de ligne + `mmm_status` actuel) sans exécuter le pipeline — combine les mêmes filtres que l'exécution réelle (`--lines`, `--force`, lignes masquées).
- `--quiet` : Supprime le logging de progression en temps réel (actif par défaut — voir ci-dessous). Aucun effet sur le comportement.
- `--verbose` : Affiche, en plus du résumé numérique, le détail ligne par ligne de chaque document/email généré, groupé par instance (voir "Détail --verbose" ci-dessous). Indépendant de `--quiet` — les deux flags concernent des affichages distincts et sans rapport (progression en cours d'exécution vs récapitulatif final), et peuvent être combinés.
- `--help-templates` : Affiche la syntaxe des balises et modificateurs (voir §3) et quitte immédiatement — utilisable sans nom de profil.

### Logging de progression en temps réel

Par défaut, chaque action impliquant un appel réseau (authentification, lecture/écriture Sheets, copie/lecture/remplissage de template, export PDF, partage, résolution de dossier, recherche/téléchargement de pièce jointe, création de brouillon/envoi d'email...) est annoncée en console juste avant d'être lancée (`"<action>..."`), puis confirmée par une ligne `→ OK` une fois résolue avec succès. Exemple :

```
Authentification : vérification du jeton stocké...
→ OK
Lecture de l'en-tête du Sheet (onglet "Contrats")...
→ OK
```

Objectif : pouvoir déterminer précisément, à tout moment d'une exécution, ce que le script est en train de faire — notamment distinguer une exécution lente en cours d'une exécution réellement bloquée. En cas d'échec, seule l'annonce apparaît (jamais de `→ OK`), ce qui situe déjà l'erreur avant même son message. `--quiet` supprime ces annonces et ne conserve que l'affichage minimal : avertissements (lignes masquées, purge, colonnes système créées...), résumé final, et ligne en cause en cas d'arrêt sur erreur — ce qui correspond à l'affichage par défaut des versions précédentes de MMMerge, avant l'introduction de ce logging.

### Résumé de fin d'exécution

Hors `--validate`/`--list`, chaque exécution (y compris `--dry-run`) affiche un résumé : nombre de lignes traitées avec succès, nombre de colonnes renseignées, de documents gDocs/PDF générés et d'emails composés, et le numéro de la ligne en cause si le script s'est arrêté sur une `Erreur`. Le nombre de sorties par module compte les sorties **réellement produites** (une instance `disable: true`, ou dont le `filter` n'a été satisfait par aucune ligne traitée, n'en produit aucune) — pas simplement `lignes traitées × nombre d'instances actives`, qui surcompterait dès qu'un `filter` exclut une instance active sur au moins une ligne. Contrairement à `gdocs`/`pdf`/`mail`, `columns[]` n'apparaît pas dans le détail `--verbose` (§ ci-dessous) : le format ligne par ligne de ce détail (`<filename> : <url>` ou `<destinataire> - <sujet> - <url>`) ne convient pas à une simple valeur calculée — non traité pour l'instant.

### Détail `--verbose`

En plus du résumé numérique, `--verbose` affiche chaque document/email effectivement généré durant l'exécution, groupé par instance dans l'ordre du profil (`gdocs[]` puis `pdf[]` puis `mail[]`), avec une ligne par ligne du Sheet traitée. Exemple :

```
Documents générés :

gdocs[0] - "Contrat CDDU"
  ligne 5 : CDDU Dupont Étienne.pdf : https://docs.google.com/document/d/.../edit
  ligne 8 : CDDU Martin Paul.pdf : https://docs.google.com/document/d/.../edit

mail[0]
  ligne 5 : dupont@example.com - Votre contrat CDDU - https://mail.google.com/mail/u/0/#drafts?compose=...
```

- Le titre après le tiret (`- "Contrat CDDU"`) est la clé `name` de l'instance (specs.md §3), omis si l'instance n'en a pas.
- Le numéro de ligne est celui du Sheet (numérotation visuelle), pas un simple compteur — permet de retrouver la ligne exacte sans repasser par `--list`.
- Pour `gdocs[]`/`pdf[]` : `<filename> : <url>` (repris de `mmm_outputs`). Pour `mail[]` : `<destinataire résolu> - <sujet résolu> - <url>`.
- Une instance désactivée, ou qui n'a produit aucune sortie sur aucune ligne traitée (ex: toutes les lignes ont échoué avant de l'atteindre), n'apparaît pas du tout dans la liste.
- Si une ligne échoue en cours de route, les instances déjà exécutées avec succès sur cette même ligne apparaissent quand même dans le détail — seule l'instance en échec (et celles qui suivent) en sont absentes pour cette ligne.

### Notification des modules désactivés

Avant toute authentification ou lecture du Sheet, s'il existe au moins une instance `disable: true` dans le profil (tous modules confondus), un message unique les liste (ex: `Module(s) désactivé(s) : gdocs[0], mail[1].`) — affiché même sous `--quiet`, pour qu'une instance manquante à l'exécution ne soit jamais une surprise silencieuse.

---

## 6. Hors Scope (MVP)

- **Détection automatique des fichiers orphelins** en cas de crash technique non intercepté entre la création d'une instance et l'écriture incrémentale de `mmm_outputs` (la fenêtre d'exposition est réduite par l'écriture incrémentale, §2, mais pas éliminée).
- **Nettoyage automatique des brouillons Gmail** de tentatives précédentes (§2, §3) — une ligne relancée plusieurs fois avec `draft_only: true` peut accumuler des brouillons, à supprimer manuellement si besoin.
- **Filtre au niveau de la ligne entière** (distinct de `filter` par instance, §3, implémenté) : restreindre le traitement de **toute la ligne** (avant même l'écriture du statut `En cours d'exécution`) selon des conditions sur ses colonnes — équivalent à un filtre d'éligibilité supplémentaire, en amont de `determineEligibleRows` (§2). Non implémenté ; `filter` par instance (§3) couvre le besoin le plus courant (sauter un document/email précis selon la ligne) sans modifier l'éligibilité de la ligne elle-même.
- **Registre de types/formatteurs étendu** : au-delà de `string`/`date`/`number`/`euro` et de leurs modificateurs actuels. Également envisagé : déclarer des variables requises/typées au niveau du profil plutôt qu'inline.
- **`processHidden`** : choisir explicitement de traiter ou d'ignorer les lignes masquées (actuellement toujours ignorées avec alerte).
- **Export PDF direct** (sans passer par un Google Doc temporaire), à évaluer plus tard si l'API le permet.
- **`ProfileManager`/`ExecutionDispatcher`** : gestion des profils via interface web, et répartition automatique des lignes d'un même Sheet vers plusieurs profils. Idée en réflexion, non détaillée davantage pour l'instant.
