# Architecture Technique : "MMMerge"

> **Dernière mise à jour :** 2026-08-06 — v36
> **Résumé des derniers changements :** Nouvelle clé `output_subfolder` (gdocs/pdf, §3 §6 §7) et son équivalent mail `externalFolderId`/`externalSubfolder` (§3 §6 §7) : comblent le manque entre `output_folder` (chemin de noms complet, depuis la racine) et `output_folder_id` (ID fixe, sans sous-chemin possible), jusqu'ici mutuellement exclusifs sans intermédiaire. `folderResolver.ts#resolveFolderPath` gagne un neuvième paramètre optionnel `startParentId` (défaut `'root'`) pour descendre depuis un ID connu plutôt que la racine ; sa clé de cache inclut désormais `startParentId` (corrige une collision de cache potentielle entre deux dossiers conteneurs différents partageant un même nom de sous-dossier). Nouvelle fonction exportée `resolveConfiguredFolderId` factorise la règle "chemin XOR (ID + sous-chemin optionnel résolu sous cet ID)", partagée telle quelle par `googleDocsHelpers.ts#resolveOutputFolderId` et `mail.ts#resolveExternalFiles` (signature générique `folder`/`folderId`/`subfolder`, chaque appelant mappe ses propres noms de champs). Validation statique (`schema.ts`) : `output_subfolder`/`externalSubfolder` requièrent respectivement `output_folder_id`/`externalFolderId` (erreur explicite avec `output_folder`/`externalFolder`), et rejettent une chaîne vide littérale au chargement du profil plutôt que de laisser échouer la première ligne traitée au runtime (`resolveFolderPath` lève déjà "chemin résolu en chaîne vide", mais seulement pour un `{{tag}}` qui se résout vide à l'exécution — une chaîne vide statique est, elle, toujours une erreur de configuration, détectable immédiatement). `externalFolder`/`externalFolderId` mutuellement exclusifs, comme `output_folder`/`output_folder_id`. Tests ajoutés : `loader.test.ts` (9, validation statique), `folderResolver.test.ts` (5, `startParentId` + `resolveConfiguredFolderId`), `googleDocsHelpers.test.ts` (1), `mail.test.ts` (2).
>
> **Résumé v35 (2026-08-06) :** Nouveau critère `not_equals` sur `FilterConditionSchema.criterium` (`config/schema.ts`, était `z.enum(['equals'])`, devient `z.enum(['equals', 'not_equals'])`) — extension anticipée depuis v21 (commentaire déjà présent dans le code). `filterEngine.ts#evaluateCondition` calcule désormais `isEqual` (même comparaison qu'avant : insensible à la casse, sans normalisation d'espaces) puis retourne `condition.criterium === 'not_equals' ? !isEqual : isEqual` — un seul point de calcul de l'égalité, la négation ne duplique aucune logique de comparaison. Se combine librement avec `equals` dans les mêmes `conditions[]`, sous n'importe quel `match` (`all`/`any`/`none`) : aucun changement à `matchesFilter`, qui reste agnostique du `criterium` de chaque condition. Tests ajoutés dans `filterEngine.test.ts` : négation simple, insensibilité à la casse identique à `equals`, combinaison avec `equals` sous `match: 'all'`.
>
> **Résumé v34 (2026-08-06) :** Correction d'un bug de perte de données réel (§3, `purgeRowOutputs`, `orchestrator.ts`) : lancer un profil pouvait mettre à la corbeille un fichier gDocs/PDF généré par un **autre** profil ciblant le même Sheet. Cause : `mmm_outputs` est une cellule du Sheet, partagée entre tous les profils qui le traitent, mais la branche `if (instance) { ... }` de `purgeRowOutputs` ne s'exécutait que quand `resolveInstanceByRef(key, profile)` résolvait — sinon la clé tombait dans le chemin par défaut ("orpheline, purge normale"), sans distinction possible entre "instance retirée de ce profil" et "clé écrite par un autre profil". Correctif : la clause est inversée en un premier `if (!instance) { preserved[key] = value; continue; }` explicite — une clé non résolue est désormais **toujours** conservée telle quelle, jamais purgée, quelle qu'en soit la raison. `resolveInstanceByRef` (`utils.ts`) est inchangé ; seule la décision prise par `purgeRowOutputs` sur son résultat `undefined` change. Contrepartie assumée et documentée (specs.md §2) : le nettoyage automatique d'une instance réellement retirée d'un profil ne se fait plus tout seul — à faire manuellement sur Drive si besoin. Tests `orchestrator.test.ts` mis à jour : l'ancien test combinant "instance active" et "orpheline" dans un seul cas est scindé en deux (une clé active qui régénère est toujours purgée ; une clé non résolue — `gdocs[0]`/`pdf[0]`/`mail[0]` sur un profil dont les trois tableaux sont vides — n'est plus jamais purgée).
>
> **Résumé v33 (2026-08-06) :** Nouveau comportement par défaut de `readSheetRows` (`orchestrator.ts`) : la boucle de lecture (`for (let i = 1; i < values.length; i++)`) s'arrête (`break`) dès qu'une ligne a toutes ses colonnes vides (`Object.values(rawData).every((value) => value === '')`), avant même de la pousser dans `rows` — cette ligne et toutes les suivantes ne sont donc ni lues ni traitées, comme si le tableau se terminait là. Un `console.log` (non filtré par `--quiet`, comme "Aucune ligne éligible.") indique le numéro de la ligne où la lecture s'est arrêtée. Nouveau flag `--ignore-empty-rows` (`cli.ts`, ajouté à la liste `boolean` de `mri`) désactive ce comportement — `CliFlags` gagne un champ `ignoreEmptyRows: boolean` (obligatoire, câblé partout où `CliFlags` est construit : `cli.ts`, `orchestrator.test.ts#baseCliFlags`), transmis à `readSheetRows` comme nouveau paramètre. Cas particulier volontairement non traité spécialement : une ligne vide gardée via `--ignore-empty-rows` reste éligible au traitement normal (son `mmm_status` vide passe `isStatusEligible`), exactement le comportement d'avant l'introduction de cette option — `--ignore-empty-rows` restaure ce comportement plutôt que d'ajouter un filtrage supplémentaire.
>
> **Résumé v32 (2026-08-06) :** `json2columns` écrivait systématiquement du texte vers Sheets (`String(value)`), y compris pour les nombres/booléens du fichier JSON source — en mode d'écriture `RAW`, une chaîne comme `"123.45"` reste du texte brut, jamais analysée selon la locale du Sheet (le problème n'était donc pas la locale, mais la perte du type numérique avant même l'envoi). Correctif : `CellWrite.value`/`writeColumn`/`writeColumns` (`sheetsWriter.ts`) élargis de `string` à `string | number | boolean`, pour que le type d'origine traverse jusqu'au `batchUpdate` sans passer par une conversion texte — Sheets stocke alors une valeur JSON numérique/booléenne comme un nombre/booléen natif, sans aucune analyse de texte donc sans ambiguïté de locale. `pipeline/modules/json2columns.ts` calcule désormais deux versions de chaque valeur lue dans le fichier JSON : `rawValues` (toujours `String(value)`, pour `context.rawData`, consommé par templates/filtres qui attendent des `string`) et `writeValues` (type préservé pour `number`/`boolean`, coercé en chaîne sinon), et passe `writeValues` à `sheetsWriter.writeColumns`. Aucun changement pour `columns[].output_column`/`link_column`/`gdocs`/`pdf`/`mail` (`writeColumn`), qui continuent de fournir des chaînes — seul le type accepté est élargi, pas leur usage actuel.
>
> **Résumé v31 (2026-08-06) :** Réorganisation de `configs/` : les profils d'exemple (v30) déplacés sous `configs/exemples/`, les fichiers JSON compagnons de `json2columns` sous `configs/data/json2columns/`, les corps HTML de `mail[].template_html_path` sous `configs/html/`. Aucun changement à `loader.ts`/`readProfileFile` : `join(PROJECT_ROOT, 'configs', \`${profileName}.json\`)` accepte déjà nativement un `profileName` contenant un séparateur (`exemples/multiModuleExemple`), le `join` construisant simplement le chemin imbriqué — seuls les appelants (tests, exemples eux-mêmes) changent. `EXAMPLE_PROFILES` (`exampleProfiles.test.ts`) et les 3 tests `loader.test.ts` repointés en v30 utilisent désormais le préfixe `exemples/`. Les références internes `json2columns[].file`/`mail[].template_html_path` des profils déplacés, qui pointaient vers les anciens chemins plats, ont été corrigées vers leurs nouveaux emplacements (un déplacement de fichier ne réécrit pas le contenu qui le référence).
>
> **Résumé v30 (2026-08-06) :** Nouveau fichier `src/config/exampleProfiles.test.ts` : `it.each` sur onze noms de profil, vérifie juste que `loadConfig(name, [])` ne lève pas — traite les profils d'exemple comme de la documentation vivante (readme.md) plutôt que de simples fixtures, pour détecter une dérive du schéma. Les onze profils, tous sous `configs/` : une paire Basic/Advanced par module (`gdocsExempleBasic`/`Advanced`, `pdfExemple*`, `mailExemple*`, `columnsExemple*`, `json2columnsExemple*`) — chaque `Advanced` a plusieurs instances et la plupart des clés optionnelles, mais reste volontairement mono-module : `mail[].attach: "generated"` et `{{link:...}}` exigent une vraie instance `gdocs[]`/`pdf[]` dans le **même** profil (vérifié statiquement par `superRefine`), donc absents des profils mono-module et réservés à `multiModuleExemple.json`, qui fait collaborer les cinq modules sur une ligne (`json2columns` → `columns` → `gdocs`/`pdf` → `mail`). `json2columnsExemple*`/`multiModuleExemple` référencent des fichiers de données JSON compagnons (`json2columnsData*.json`, chemins relatifs à `process.cwd()` — même limitation déjà connue que `mail[].template_html_path`, non résolue via `PROJECT_ROOT`) ; `mailExempleAdvanced` référence `mailExempleAdvancedBody.html` pour illustrer `template_html_path`. `configs/exemple.json` (utilisé jusqu'ici par 3 tests de `loader.test.ts`) est retiré ; ces 3 tests pointent désormais vers `multiModuleExemple` (mêmes assertions : `gdocs`/`pdf`/`mail` de longueur 1 chacun, `autoCreateFolders`/`defaultDateFormat` par défaut).
>
> **Résumé v29 (2026-08-06) :** Renommage pur du module introduit en v28 : `lookup` → `json2columns`, avant toute adoption réelle. Tout renommé en une passe : `LookupInstanceSchema`/`LookupInstance` → `Json2ColumnsInstanceSchema`/`Json2ColumnsInstance` (`config/schema.ts`), le champ `ProfileSchema.lookup` → `json2columns`, le fichier `pipeline/modules/lookup.ts` → `json2columns.ts`, `runLookupInstance` → `runJson2ColumnsInstance`, `loadLookupTable` → `loadJson2ColumnsTable`, la variable/compteur `lookupEnriched` → `json2ColumnsEnriched` (`orchestrator.ts`, dans `processRow`/`runPipeline`/`printSummary`), et tous les commentaires/messages d'erreur mentionnant `lookup[i]`. Aucun changement de comportement. L'entrée v28 ci-dessous a été mise à jour avec le nom final plutôt que laissée avec l'ancien nom, pour éviter toute confusion à la lecture.
>
> **Résumé v28 (2026-08-06) :** Nouveau module `json2columns` (§3, §6), tableau d'instances au même niveau que `columns`/`gdocs`/`pdf`/`mail`. `Json2ColumnsInstanceSchema` = `{ file: z.string(), key_column: z.string() }.merge(InstanceMetaSchema)` ; `ProfileSchema` gagne `json2columns: z.array(Json2ColumnsInstanceSchema).optional().default([])`. Son `superRefine` (même fonction que les autres checks statiques) lit et valide chaque fichier au chargement du profil : `readFileSync` (erreur si introuvable/illisible), `JSON.parse` (erreur si invalide), puis vérifie la forme — objet de premier niveau, chaque valeur elle-même un objet, aucune valeur de feuille non simple (objet/tableau imbriqué rejeté, tout le reste sera coercé en chaîne à l'exécution). Nouveau fichier `pipeline/modules/json2columns.ts` : `runJson2ColumnsInstance` lit `context.rawData[config.key_column]` (erreur si colonne absente), relit et reparse `config.file` (`loadJson2ColumnsTable`, pas de cache — même choix que `mail[].template_html_path`), cherche la clé dans la table ; absente → `console.warn` et retourne `false` (ligne ignorée, pas une erreur) ; trouvée → coerce chaque valeur en chaîne (`String(value)`), vérifie **toutes** les colonnes cibles via le nouveau `deps.sheetsWriter.hasColumn` avant d'écrire quoi que ce soit (erreur agrégée listant toutes les colonnes manquantes si au moins une l'est — tout ou rien), écrit dans `context.rawData` (disponible pour les instances suivantes) puis appelle `deps.sheetsWriter.writeColumns` (nouveau, batch en un seul `writeCells`) et retourne `true`. `sheetsWriter.ts` : `hasColumn(columnName): boolean` (lecture pure de `this.headers`, jamais de création) et `writeColumns(rowNumber, entries)` (résout chaque nom déjà connu comme valide — le caller a vérifié via `hasColumn` — et batch une seule écriture + `mmm_last_run`). `orchestrator.ts` : `processRow` gagne une boucle `profile.json2columns` **avant** `profile.columns` (même pattern `disable`/`skipIfFiltered`) ; `runJson2ColumnsInstance` retourne un booléen (contrairement aux autres modules) consommé pour incrémenter un nouveau compteur `json2ColumnsEnriched`, retourné par `processRow`, accumulé par `runPipeline` et passé à `printSummary` (nouveau paramètre) qui affiche `Lignes enrichies via JSON : N` ; `listDisabledInstances` inclut `json2columns[i]`. Délibérément **non fait**, par cohérence avec `columns[]` : pas d'entrée `mmm_outputs`, pas de détail `--verbose` par ligne. Délibérément **différent** de `columns[].output_column`/`link_column` : aucune création automatique des colonnes cibles ici (`hasColumn` ne crée jamais) — ces noms viennent d'un fichier externe non revu par l'utilisateur au moment de la configuration, contrairement aux noms de colonnes du profil lui-même. Délibérément **non fait**, sur demande explicite : aucune vérification d'unicité de `key_column` à travers les lignes (jugée trop coûteuse pour le bénéfice) — deux lignes partageant la même clé reçoivent simplement le même contenu, sans erreur ni avertissement.
>
> **Résumé v27 (2026-08-05) :** `parseLines` (`cliFlags.ts`, §5) accepte désormais des plages `"début-fin"` en plus des numéros individuels, mélangeables librement dans la même liste séparée par des virgules (ex: `--lines=2,4-6,9`). Nouvelle fonction privée `parseLinesPart(part)` : détecte une plage via `/^(\d+)-(\d+)$/` — si elle matche, valide `start >= 1` et `end >= start` (sinon `Erreur` explicite "plage invalide"), puis l'étend en tableau via `Array.from({ length: end - start + 1 }, (_, i) => start + i)` ; sinon, retombe sur le parsing d'un entier unique existant (même message d'erreur, légèrement reformulé pour mentionner les plages). `parseLines` devient `.split(',').map(trim).flatMap(parseLinesPart)` — un seul point de sortie, `number[]`. Aucun changement en aval : `determineEligibleRows` (orchestrator.ts) traite déjà `cliFlags.lines` via `new Set(...)`, donc l'ordre et les doublons introduits par des plages qui se chevauchent (ex: `2,2-4`) n'ont aucun effet observable.
>
> **Résumé v26 (2026-08-05) :** `link_column` (v25) passe de `z.boolean().optional().default(false)` à `z.string().optional()`, sur `FileModuleFieldsSchema` et `MailInstanceSchema` — l'utilisateur fournit désormais directement le nom de colonne, plus de nom auto-dérivé de `moduleName`. `gdocs.ts`/`pdf.ts`/`mail.ts` : `writeLinkColumn` perd son paramètre `moduleName` (devenu inutile) — signature `writeLinkColumn(config, rowNumber, url, deps)` ; corps simplifié à `if (!config.link_column) return; await deps.sheetsWriter.writeColumn(rowNumber, config.link_column, url);`, `config.link_column` étant désormais lui-même le nom de colonne (plus de template literal `` `${moduleName} output` ``). `config/schema.ts` : la garde statique "colonne système réservée" (jusqu'ici seulement sur `columns[].output_column`) est généralisée dans le même `superRefine` — parcourt `gdocs`/`pdf`/`mail` et signale `<array>[<index>].link_column` si sa valeur (quand définie) fait partie de `RESERVED_COLUMN_NAMES`. Aucun changement à `sheetsWriter.ts` (`writeColumn`/`resolveOrCreateColumn` déjà génériques depuis v23). Remplace v25 avant toute adoption réelle (champ ajouté le même cycle de travail) — pas de migration nécessaire pour un profil existant.
>
> **Résumé v25 (2026-08-02) :** Nouveau champ `link_column: z.boolean().optional().default(false)` sur `FileModuleFieldsSchema` (donc `gdocs`/`pdf`) et sur `MailInstanceSchema` — pas sur `InstanceMetaSchema` (partagé avec `columns[]`, qui n'a pas de sortie de type "lien", donc pas de champ pertinent à y ajouter). Dans `gdocs.ts`/`pdf.ts`/`mail.ts` : nouvelle fonction privée par fichier `writeLinkColumn(moduleName, config, rowNumber, url, deps)` — no-op si `config.link_column` est faux, sinon `deps.sheetsWriter.writeColumn(rowNumber, \`${moduleName} output\`, url)` (réutilise tel quel `writeColumn`/`resolveOrCreateColumn` de v23, aucun changement à `sheetsWriter.ts`). Appelée juste après chaque `updateOutput` existant — dans la branche `--dry-run` (avec l'URL synthétique `(dry-run)`) et dans le chemin réel de chacun des trois modules, deux points d'appel par fichier. Nom de colonne dérivé de `moduleName` (l'identifiant technique, ex: `gdocs[0]`), jamais de `config.name` : consciemment écarté en conception — `name` est documenté (specs.md §3) comme n'affectant jamais aucune référence technique, un renommage doit rester sans effet de bord ; le dériver aurait fait apparaître une nouvelle colonne et abandonné l'ancienne (orpheline) à chaque renommage, puisque mmmerge ne supprime jamais de colonne.
>
> **Résumé v24 (2026-08-02) :** Correction d'un bug de perte de données dans `purgeRowOutputs` (§3, `orchestrator.ts`) : la fonction ne recevait ni le profil ni assez de contexte pour savoir qu'une instance `gdocs[i]`/`pdf[i]` référencée dans `mmm_outputs` ne allait *pas* s'exécuter cette ligne (`disable: true`, ou `filter` non satisfait) — elle mettait donc son fichier à la corbeille et perdait sa trace dans `mmm_outputs` sans jamais le régénérer. Signature changée : `purgeRowOutputs(drive, sheetsWriter, row, profile, quiet = true)` (nouveau paramètre `profile`, avant `quiet`). Nouvelle logique, par entrée `mmm_outputs` : `resolveInstanceByRef(key, profile)` retrouve la config actuelle ; si l'instance est introuvable (retirée du profil) → orpheline, purgée normalement (comportement historique inchangé) ; si trouvée et `!instance.disable && matchesFilter(key, instance.filter, row.rawData)` → elle va se régénérer cette ligne, purge normale (fichier remplacé juste après) ; sinon (désactivée, ou filtre non satisfait) → **ni purgée, ni perdue**, l'entrée est recopiée telle quelle dans un objet `preserved` qui devient le nouveau contenu de `mmm_outputs`. `matchesFilter` est appelé dans un `try/catch` local : si l'évaluation échoue (ex: colonne référencée absente du Sheet), la purge ne plante pas et préserve par sécurité — la même erreur de configuration réapparaît normalement via `skipIfFiltered` une fois l'exécution de la ligne arrivée à cette instance (qui, elle, est dans le `try` principal de `processRow` et gère déjà `ModuleError` correctement). `sheetsWriter.ts` : `resetOutputs(rowNumber, preserved: Record<string, FileOutput | MailOutput> = {})` — écrit désormais `JSON.stringify(preserved)` au lieu du littéral `'{}'` codé en dur ; défaut `{}` gardé pour la compatibilité des appelants/tests existants qui n'ont rien à préserver. `mail[i]` suit la même règle par cohérence (jamais purgé physiquement, comme avant, mais son entrée ne disparaît plus non plus de `mmm_outputs` si désactivée/filtrée cette ligne) — avant ce correctif, `resetOutputs(rowNumber)` réinitialisait *tout* `mmm_outputs` à `{}` sans condition, donc une instance mail désactivée/filtrée perdait aussi silencieusement sa référence, invisible jusqu'ici puisque mail s'exécutait toujours avant l'introduction de `disable`/`filter`.
>
> **Résumé v23 (2026-08-02) :** Nouveau module `columns` (§3, §6), tableau d'instances au même niveau que `gdocs`/`pdf`/`mail`. `ColumnsInstanceSchema` = `{ template: z.string(), output_column: z.string() }.merge(InstanceMetaSchema)` (donc `name`/`description`/`disable`/`filter` gratuits) ; `ProfileSchema` gagne `columns: z.array(ColumnsInstanceSchema).optional().default([])`, et son `superRefine` un nouveau check : `output_column` ne peut pas être l'un de `RESERVED_COLUMN_NAMES` (dupliqué localement dans `schema.ts` — un import de `sheetsWriter.ts`, qui importe déjà `Config` depuis `schema.ts`, créerait un cycle). Nouveau fichier `pipeline/modules/columns.ts` : `runColumnsInstance` résout `config.template` via `renderTemplateString` (exactement le même moteur que `output_filename`/`subject` — aucun changement à `templateEngine.ts`), écrit le résultat dans `context.rawData[config.output_column]` **avant** d'appeler `deps.sheetsWriter.writeColumn` — c'est cette seule ligne qui rend la valeur utilisable via une balise `{{output_column}}` ordinaire par `gdocs[]`/`pdf[]`/`mail[]` sur la même ligne, sans aucun mécanisme dédié. `orchestrator.ts` : `processRow` gagne une quatrième boucle (`profile.columns`, même pattern `disable`/`skipIfFiltered` que les trois autres), placée **avant** la boucle `gdocs[]` ; retourne désormais aussi `columnsWritten` (compteur incrémenté à chaque instance exécutée avec succès pour la ligne) ; `runPipeline` accumule ce compteur sur toute l'exécution et le passe à `printSummary` (nouveau paramètre), qui affiche `Colonnes renseignées : N` si au moins une instance `columns[]` est active ; `listDisabledInstances` inclut désormais `columns[i]`. `sheetsWriter.ts` : `SheetsWriter` conserve maintenant l'en-tête complet (`headers: string[]`, plus seulement les index des 3 colonnes réservées) comme état mutable ; nouvelle méthode privée `resolveOrCreateColumn` (cherche par titre, sinon ajoute en fin d'en-tête via `values.update` sur `!1:1` — même mécanisme que la création des colonnes système manquantes, mais **sans** flag `--init-columns` : toujours automatique) et nouvelle méthode publique `writeColumn` (résout/crée la colonne puis écrit la cellule + `mmm_last_run`, cohérent avec l'invariant existant "mmm_last_run reflète la dernière écriture touchant la ligne"). Délibérément **non fait** : pas d'entrée `mmm_outputs` pour `columns[]` (pas un fichier à purger — juste une cellule recalculée à chaque exécution, comme n'importe quelle colonne) ; pas de détail `--verbose` par ligne (le format `<filename> : <url>` / `<destinataire> - <sujet> - <url>` du manifeste existant ne convient pas à une valeur scalaire) ; pas de détection statique des `output_column` dupliqués entre deux instances `columns[]` (un `filter` peut légitimement les rendre mutuellement exclusifs — contrairement à un doublon dans `mail[].generated`, qui n'a aucun usage légitime).
>
> **Résumé v21 (2026-08-02) :** Nouvelle clé `filter` (§3, §6) sur `InstanceMetaSchema` (`config/schema.ts`), donc commune à `gdocs`/`pdf`/`mail` — exécution conditionnelle **par ligne** (contrairement à `disable`, réglage statique du profil), évaluée sur `rawData`. Forme : `{ "match": "all" | "any" | "none", "conditions": [{ "label", "criterium": "equals", "value" }, ...] }` (`conditions` non vide) — un combinateur (`match`) sur des conditions atomiques d'égalité stricte donne gratuitement les sémantiques "toutes", "au moins une", "aucune", sans avoir besoin d'opérateurs de comparaison variés dès le MVP ; `criterium` reste un enum à un seul membre pour l'instant, réservé à une extension future (`contains`, `not_equals`...) sans casser le format. Nouveau fichier `filterEngine.ts` : `matchesFilter(moduleName, filter, rawData)`, fonction pure — colonne référencée absente de `rawData` → `ModuleError` immédiate (cohérent avec la règle déjà existante pour une balise référençant une colonne absente, §3). Comparaison stricte, sensible à la casse, sans normalisation d'espaces (comportement par défaut retenu en l'absence d'un besoin contraire exprimé — voir correction v22 ci-dessus). `orchestrator.ts` : `processRow` gagne `skipIfFiltered` (appelé juste après le test `disable`, dans les trois boucles gdocs/pdf/mail), qui `continue` l'instance sans erreur si `matchesFilter` renvoie `false`, avec un log dédié (`"<ligne> : <instance> : filtre non satisfait, ignoré."`, hors `--quiet`). Contrairement à `disable`, une référence `generated`/`{{link:...}}` vers une instance filtrée ne peut **pas** être validée statiquement (la ligne n'est pas connue au chargement du profil) — `printSummary` (§5), qui comptait jusqu'ici `processedRows × nombre d'instances actives`, aurait donc surcompté dès qu'un filtre exclut une instance sur au moins une ligne traitée : remplacé par un calcul basé sur `report` (`ModuleReport`, déjà accumulé pour `--verbose`, v19) via la nouvelle fonction `countByPrefix` — compte les sorties **réellement produites**, correction plus qu'ajout puisque `report` existait déjà. **"Pourquoi a-t-elle été ignorée ?"** : `disable` étant déjà exclu statiquement (superRefine, §6), un `filter` non satisfait est désormais la seule cause restante d'une référence `generated` introuvable à l'exécution — `PipelineDeps` gagne un champ `profile: Config` (le profil complet, pour permettre à un module de retrouver la config d'une autre instance) ; nouvelle fonction partagée `resolveInstanceByRef(ref, profile)` (`utils.ts`, même regex que l'ancien `resolveInstanceName` privé de `sheetsWriter.ts`) ; `mail.ts` (`resolveAttachments`, branche `generated`) enrichit son message d'erreur d'une phrase dédiée quand l'instance référencée a un `filter` configuré. Le cas symétrique côté `{{link:...}}` dans le corps d'un mail est volontairement **non traité** : `templateEngine.ts`/`renderTemplateString` sont profil-agnostiques par conception (couche de rendu pure) — leur faire porter la connaissance du profil pour ce seul message d'erreur aurait été une régression de pureté disproportionnée par rapport au gain (l'erreur brute "référence introuvable" reste correcte, seulement moins détaillée).
>
> **Résumé v20 (2026-08-01) :** Deux améliorations de confort en attente depuis plusieurs sessions. (1) Nouveau module `paths.ts` : `PROJECT_ROOT`, résolu depuis `import.meta.url` (via `fileURLToPath`, indispensable car le chemin du projet contient un espace — voir le commentaire du fichier) plutôt que `process.cwd()`. `loader.ts` (`configs/`) et `auth.ts` (`credentials.json`/`token.json`) l'utilisent désormais — `mmmerge` fonctionne depuis n'importe quel dossier une fois lié via `npm link`, vérifié en conditions réelles (lancé depuis `/tmp`). `paths.ts` doit rester à la racine de `src/` (comme il compile à la racine de `dist/`) pour que "un niveau au-dessus" pointe correctement vers la racine du projet, que le module soit exécuté compilé (`dist/paths.js`) ou directement (`src/paths.ts`, sous vitest). (2) `loggedStep` (`pipeline/log.ts`) : la confirmation de succès devient une ligne compacte `→ OK` plutôt que la répétition complète de `"<message> : OK"` — une vingtaine d'appels par exécution rendait la répétition redondante. Nouveau fichier de test `pipeline/log.test.ts` (n'existait pas jusqu'ici).
>
> **Résumé v19 (2026-08-01) :** `--verbose` réintroduit (§3 étape 9, §5), sans rapport avec son ancien rôle (v13 — désormais assuré par le logging de progression actif par défaut) : détail ligne par ligne des documents/emails générés, groupé par instance. `rowContext.ts` : `MailOutput` gagne `to: string` (destinataire résolu), écrit dans les trois branches de `runMailInstance` (dry-run, brouillon, envoi) — nécessaire pour afficher ce détail côté mail sans re-résoudre `config.to`. `orchestrator.ts` : `processRow` retourne désormais `{ success, outputs }` au lieu d'un booléen (`outputs` = `RowContext.outputs` de la ligne, même partiel en cas d'échec) ; nouveau type `ModuleReport` (`Map<string, Array<{ rowNumber, output }>>`) accumulé ligne par ligne dans `runPipeline` via la nouvelle fonction `recordOutputs` ; nouvelle fonction `printVerboseManifest` (avec sa garde de type `isMailOutput`, basée sur la présence de `to`) affichée après `printSummary`, réussite ou échec. `CliFlags.verbose` (nouveau, indépendant de `quiet`) n'est pas propagé à `PipelineDeps` : il n'est nécessaire qu'une fois, en toute fin de `runPipeline`, jamais à l'intérieur des modules.
>
> **Résumé v18 (2026-07-31) :** Trois changements. (1) Nouveau champ `template_link` (`FileModuleFieldsSchema`, donc `gdocs`/`pdf` uniquement) : `z.string().optional()`, purement décoratif — aucune logique associée nulle part, jamais lu, jamais validé. (2) `cli.ts` : correction d'une régression sur l'affichage des erreurs fatales non interceptées — voir §8 pour le détail complet (la trace de pile brute s'affichait par défaut au lieu du message seul, un renversement accidentel introduit en v13 lors du remplacement de `--verbose` par `--quiet`). Désormais toujours `Erreur : <message>`, indépendant de `--quiet`. (3) Documentation seulement : correction de plusieurs exemples déjà en place où l'espace attendu avant/dans un montant en euros ou un nombre à séparateur de milliers était un espace ASCII ordinaire au lieu du caractère réellement produit (U+00A0 avant `€`, U+202F pour le séparateur de milliers) — aucun changement de code, seulement de texte.
>
> **Résumé v17 (2026-07-31) :** Deux corrections signalées par l'utilisateur sur le même profil réel (`configs/CDDUA10.json`).
> (1) `pdf.ts` : `ensurePdfExtension` ajoute `.pdf` au nom résolu s'il est absent (insensible à la casse, jamais de doublon) — `drive.files.create` ne déduit jamais d'extension depuis `mimeType`, contrairement à un upload via l'UI Drive. Le nom du doc temporaire (`[tmp] ...`) garde volontairement le nom **sans** extension (`renderedFilename`, distinct de `filename`) puisqu'il ne s'agit pas encore d'un PDF ; seul le fichier final (`files.create`) et `output.filename` (donc aussi le nom de pièce jointe côté `mail.ts` en mode `generated`) portent l'extension. `gdocs.ts` volontairement inchangé (un gDoc n'a pas d'extension de fichier classique).
> (2) `templateEngine.ts` : nouveau modificateur `nospace` (types `number`/`euro`) — motivé par des formulaires externes qui rejettent une valeur copiée-collée contenant un espace, y compris l'espace fine insécable (U+202F) que produit le séparateur de milliers par défaut. `formatNumberFr`/`formatEuro` gagnent un paramètre `noGroup` (`Intl.NumberFormat`'s `useGrouping: false`) — vérifié que `useGrouping` n'affecte que le séparateur de milliers, jamais l'espace insécable (U+00A0) avant `€` généré par `style: 'currency'`. Contrainte de conception : `nospace` et `format:<n>` alimentent le **même** appel `Intl.NumberFormat`, donc ne peuvent pas être composés comme deux transformations de texte indépendantes appliquées successivement (à la différence de `prefix`/`suffix`/`uppercase`) — `nospace` est résolu une fois pour toutes en `noGroup` avant la boucle des modificateurs (même traitement que `required`), et simplement ignoré (`continue`, après validation du type) à sa position dans la liste. Conséquence assumée : `nospace` est le premier modificateur qui n'est pas positionnel — `[nospace, format:2]` et `[format:2, nospace]` produisent un résultat identique.
>
> **Résumé v16 (2026-07-30) :** Nouvelle clé `disable` (§3, §6) sur `InstanceMetaSchema` (`config/schema.ts`), donc commune à `gdocs`/`pdf`/`mail` : `z.boolean().optional().default(false)`. `orchestrator.ts` : `processRow` saute (`continue`) toute instance `disable: true` avant tout appel, sans jamais recalculer les index de position des autres instances du même tableau (`.entries()` porte sur le tableau complet, non filtré) ; `validateResourceAccessibility` exclut les instances désactivées de la liste à vérifier ; `printSummary` ne compte que les instances actives dans son calcul (`processedRows × nombre d'instances actives`) — bug latent sinon dès qu'une instance désactivée existe (comptait toujours le total brut du tableau) ; nouvelle fonction `listDisabledInstances` (parcourt les trois tableaux, retourne les refs `type[i]` désactivées dans l'ordre du profil), utilisée pour une notification unique en tout début de `runPipeline`, avant authentification, non affectée par `--quiet`. `config/schema.ts` : le `superRefine` existant (déjà chargé de vérifier qu'une référence `generated`/`{{link:...}}` pointe vers une instance *existante*) gagne un second filtre : la même référence ne doit pas non plus pointer vers une instance *désactivée* — extension directe du même mécanisme statique, `disable` étant un réglage fixe du profil (jamais dépendant d'une ligne du Sheet), donc toujours vérifiable sans lire le Sheet. Aucun changement côté runtime des modules (`gdocs.ts`/`pdf.ts`/`mail.ts`) : ils ne voient jamais une instance désactivée, celle-ci étant filtrée en amont dans `processRow`.
>
> **Résumé v15 (2026-07-23) :** Suite à un signalement utilisateur (exécution figée sans aucun message console — impossible de savoir si le script travaillait encore ou était bloqué). Nouveau fichier `pipeline/log.ts` : `loggedStep(quiet, message, action)`, logge `"<message>..."` avant `action()` puis `"<message> : OK"` une fois résolue (rien si `action` rejette — l'absence de `: OK` situe déjà l'erreur). `PipelineDeps.verbose`/`CliFlags.verbose` renommés en `quiet` (sémantique inversée : `false` = verbeux, nouveau comportement par défaut). `--verbose` remplacé par `--quiet` dans `cli.ts` (y compris pour le choix trace complète/message seul sur une erreur non interceptée par `main()`). Chaque appel réseau individuel est désormais enveloppé (pas seulement le niveau ligne/instance, comme le faisait l'ancien `--verbose` — voir résumé v6 et le point 7 des étapes de l'orchestrateur, §3) :
> - `auth.ts` : `authenticate(quiet)`, avant `getAccessToken()`.
> - `sheetsWriter.ts` : `SheetsWriter` gagne un champ `quiet` (constructeur + `create(..., quiet = true)`) ; `writeCells`/`readOutputs`, chokepoints uniques par lesquels passent toutes les méthodes publiques (`markInitialRow`/`updateOutput`/`resetOutputs`/`closeRow`), enveloppent leur appel `batchUpdate`/`get` réel (la branche `dryRun`, qui ne fait aucun appel réseau, reste inchangée et inconditionnelle) ; log dédié avant la lecture initiale de l'en-tête.
> - `orchestrator.ts` : `readSheetRows`/`readHiddenRowNumbers` gagnent un paramètre `quiet` ; `purgeRowOutputs(..., quiet = true)` gagne un log avant chaque tentative de mise à la corbeille (le résultat, succès ou échec, était déjà annoncé sans condition via `console.warn`) ; `processRow` enveloppe chaque appel d'instance (`runGdocsInstance`/`runPdfInstance`/`runMailInstance`) avec `loggedStep` au lieu du `if (deps.verbose) console.log(...)` précédent, et logge le démarrage de la ligne avant la purge.
> - `folderResolver.ts` : `resolveFolderPath`/`resolveOrCreateSegment` gagnent un paramètre `quiet = true` ; enveloppe `files.list` par segment (la création automatique garde son `console.warn` inconditionnel existant).
> - `googleDocsHelpers.ts` : `resolveShareSettings` gagne `rowNumber = 0, quiet = true` ; enveloppe chaque `permissions.create` (lien, puis un par adresse email).
> - `gdocs.ts`/`pdf.ts` : enveloppent lecture du template, copie (temporaire pour pdf), remplissage des balises, et (pdf uniquement) export/création finale/suppression du temporaire.
> - `mail.ts` : enveloppe la résolution des pièces jointes (globalement, puis chaque recherche de fichier externe individuellement), chaque téléchargement de pièce jointe (utile en particulier ici : `Promise.all` est le seul point de concurrence réelle du pipeline — specs.md §2 — donc les messages incluent systématiquement le nom du fichier pour rester non ambigus malgré l'entrelacement), et la création de brouillon/l'envoi.
>
> Beaucoup de ces fonctions exportées et testées directement (`resolveFolderPath`, `resolveShareSettings`, `purgeRowOutputs`, `SheetsWriter.create`) ont leur nouveau paramètre `quiet` par défaut à `true`, uniquement pour ne pas devoir modifier tous leurs sites d'appel dans les tests existants (qui n'ont pas besoin de ce log) — les véritables appelants runtime (`orchestrator.ts`, modules du pipeline) passent toujours `deps.quiet`/`cliFlags.quiet` explicitement, sans jamais dépendre de cette valeur par défaut.
>
> **Résumé v14 (2026-07-23) :** Nouveau type de balise `euro` dans `templateEngine.ts` (§3) : `formatEuro`, basée sur `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })` — choisie après vérification en conditions réelles (lecture directe, via l'API Docs, du document `181sHDTAC-k_7300kA_i9v1vYkf8ODCQJFjmlc7SZfz8` fourni par l'utilisateur comme référence typographique) que cette formule produit nativement le séparateur de milliers en espace fine insécable (U+202F) et l'espace insécable (U+00A0) avant `€` attendus, sans code de composition manuel. Nombre de décimales géré par `hasNonZeroCents` (arrondi au centime, corrigé de l'imprécision flottante via `Number.EPSILON` — nécessaire pour que `12.335` arrondisse vers `12,34` et non `12,33`, ce dernier cas ayant été vérifié par calcul direct avant l'implémentation) : 0 décimale si le montant est rond, 2 sinon. `format:<n>` (même mécanisme que pour `number`) impose un nombre de décimales fixe et prime toujours sur cette règle automatique, sans affecter la mise en forme (espaces, `€`).
>
> **Résumé v13 (2026-07-23) :** Correction d'un bug rapporté par l'utilisateur : deux colonnes du Sheet portant le même titre étaient silencieusement fusionnées. `SheetsWriter.create` (§5) gagne `findDuplicateHeaders`, appelée juste après la lecture de l'en-tête, avant la logique des colonnes `mmm_*` manquantes — `Erreur` explicite listant le(s) titre(s) en double (réservés ou libres), en-têtes vides ignorés. Un seul point de vérification, `SheetsWriter.create` s'exécutant toujours en premier dans `runPipeline` (couvre aussi `--validate`) — `readSheetRows` (orchestrator.ts §3), qui relit l'en-tête séparément pour `rawData`, n'a pas besoin de sa propre vérification.
>
> **Résumé v12 (2026-07-23) :** Nouveau type de balise `number` dans `templateEngine.ts` (§3) : `parseSheetNumber` (parse + erreur explicite si non numérique, symétrique à `parseSheetDate`) et `formatNumberFr` (`Intl.NumberFormat('fr-FR', ...)`, séparateur de milliers ` ` espace fine insécable + virgule décimale). Nouveau modificateur type-spécifique `format:<n>` (`n` = décimales fixes). Motivé par un cas réel : une cellule numérique Sheets (`brut_total = 1123.43`) utilisée sans type déclaré (`string` implicite) affichait `1123.43` dans le document généré — notation JS (`String(1123.43)`), pas française. **Bug corrigé au passage, plus large que `number`** : `applyModifiers` appliquait jusqu'ici le format par défaut (`defaultDateFormat` pour `date`) comme une étape *finale*, après la boucle des modificateurs — un `prefix(...)`/`suffix(...)` sans `format:` explicite était donc silencieusement écrasé par ce format par défaut (jamais remarqué faute de test combinant les deux). Restructuré : la valeur de départ (avant la boucle) est désormais déjà mise en forme par défaut pour `date`/`number` ; un `format:` explicite, où qu'il apparaisse dans la liste, écrase cette valeur à son tour — `prefix`/`suffix` qui suivent s'appliquent donc toujours au texte réellement affiché. Aucun test existant ne dépendait de l'ancien comportement (vérifié).
>
> **Résumé v11 (2026-07-23) :** Correction d'un bug réel constaté en test (profil utilisateur, balise `{{heures_action_culturelle}}` avec un type inconnu `number`) : `gdocs.ts`/`pdf.ts` copiaient le template sur Drive **avant** de résoudre ses balises — une balise invalide levait donc son erreur *après* la copie, laissant un fichier orphelin (identique au template, aucun remplacement) jamais tracé dans `mmm_outputs` et donc jamais nettoyé par la purge (§3). Pour PDF c'était pire : le doc temporaire n'était jamais supprimé non plus. `googleDocsHelpers.ts` : `fillTemplateTags` (résolution + application en un seul appel, sur le même document) remplacé par deux fonctions séparées, `resolveTemplateTagsForDoc` (lit et résout les balises d'un document, ici toujours appelée sur `config.template_id`, avant toute copie) et `applyTemplateTags` (applique des balises déjà résolues via `batchUpdate`, appelée après `files.copy` sur le `fileId` de la copie). Voir §7 pour le détail des deux flux corrigés. **Fichier orphelin déjà créé lors du test ayant révélé ce bug : à supprimer manuellement sur Drive, mmmerge ne peut pas le retrouver rétroactivement (jamais tracé dans `mmm_outputs`).**
>
> **Résumé v10 (2026-07-22) :** Nouveaux modificateurs `prefix(texte)`/`suffix(texte)` dans `templateEngine.ts` (§3), génériques (tous types), conditionnés gratuitement par le court-circuit déjà existant pour cellule vide dans `resolveTagValue` (`applyModifiers` n'est jamais appelée pour une valeur vide). Le découpage des modificateurs (`parseModifiers`) passe d'un simple `.split(',')` à `splitModifiersRespectingParens`, conscient de la profondeur de parenthèses — ne coupe pas sur une virgule à l'intérieur de `prefix(...)`/`suffix(...)`, lève une `Erreur` explicite si les parenthèses ne s'équilibrent pas. Un `.trim()` uniforme (comme avant) reste suffisant : il ne touche que les extrémités de chaque modificateur déjà délimité par la virgule de plus haut niveau, jamais l'intérieur des parenthèses. Design initial envisagé (`prefix:`/`suffix:` sans parenthèses, contrainte de position "doit être en dernier" pour éviter l'ambiguïté du trim) abandonné avant d'être finalisé : la délimitation par parenthèses supprime cette contrainte entièrement.
>
> **Résumé v9 (2026-07-22) :** Suite à une relecture externe du code. `orchestrator.ts` gagne `validateResourceAccessibility`-adjacent : `--list` (retourne la liste des lignes éligibles sans construire `PipelineDeps` ni marquer/traiter aucune ligne) et `printSummary` (appelée en fin de `runPipeline`, hors branches `--validate`/`--list`/liste vide). `cliFlags.ts` gagne la constante `HELP_TEMPLATES` (contenu statique, testé pour présence des sections clés) consommée par `--help-templates` dans `cli.ts`, traité avant même la lecture du nom de profil. `folderResolver.ts`/`mail.ts` : les erreurs d'ambiguïté (dossier / fichier externe) incluent désormais les IDs Drive des éléments en conflit (déjà présents dans la réponse `files.list`, aucun appel supplémentaire).
>
> **Résumé v8 (2026-07-22) :** `MailOutput` (§4) gagne `draftOnly: boolean` (reflète `config.draft_only` de l'instance), écrit par `runMailInstance` dans les trois branches (dry-run, brouillon, envoi) — permet d'interpréter `url` sans consulter le profil. Documenté : le lien de brouillon (`#drafts?compose=<id>`) est fragile par nature (voir v7) — cesse de fonctionner si le brouillon est modifié/restauré après coup, l'ID de composition utilisé par l'UI Gmail moderne étant interne au client web et non dérivable depuis l'API (confirmé par recherche : aucune méthode connue pour le reconstruire à partir de `draft.id`/`message.id`). Retenu malgré tout plutôt qu'un lien générique vers le dossier Brouillons, qui n'apporterait aucune information utile.
>
> **Résumé v7 (2026-07-22) :** URL de brouillon Gmail (§3) vérifiée en conditions réelles et **corrigée** : `https://mail.google.com/mail/u/0/#drafts?compose=<data.message.id>` — ni le format `#drafts/<id>` (ne fonctionne plus dans l'UI Gmail actuelle), ni `data.id` (l'ID du brouillon lui-même, qui n'ouvre rien) ne fonctionnaient. URL d'un mail envoyé (`#sent/<data.id>`) confirmée correcte telle quelle.
>
> **Résumé v6 (2026-07-22) :** Implémentation complète (tous les modules, précédemment stubs). Ajouts issus de cette implémentation, non prévus par les versions précédentes de ce document :
> - **`PipelineDeps`** (`pipeline/deps.ts`, nouveau) : dépendances partagées par `gdocs.ts`/`pdf.ts`/`mail.ts`, construites une seule fois par exécution par l'orchestrateur (clients Google, `SheetsWriter`, cache de dossiers "par exécution", `defaultDateFormat`, `autoCreateFolders`, `dryRun`, `verbose`).
> - **`--dry-run`** : chaque module du pipeline (`gdocs`/`pdf`/`mail`) résout les champs purs (nom de fichier, destinataires…) puis court-circuite avant tout appel Drive/Docs/Gmail, écrivant une sortie synthétique (`url: '(dry-run)'`). `SheetsWriter` simule ses écritures (`writeCells` en no-op loggé) tout en conservant ses lectures réelles.
> - **`--init-columns`** (nouveau flag) : crée les colonnes système `mmm_*` manquantes (ajoutées en fin d'en-tête) au lieu de lever une erreur — voir §5, §6.
> - **`--validate`** étendu : vérifie aussi l'accessibilité Drive des `template_id`/`output_folder_id` référencés (§6).
> - **`cliFlags.ts`** (nouveau) : `parseLines` extrait de `cli.ts` pour rester testable — importer `cli.ts` déclenche `main()` (c'est un script, pas un module réutilisable).
> - **`googleDocsHelpers.ts`** (nouveau, `pipeline/modules/`) : logique partagée par `gdocs.ts`/`pdf.ts` (résolution du dossier de sortie, remplissage des balises, `resolveShareSettings`, `driveRole`).
> - **`mimeMessage.ts`** (nouveau, `pipeline/modules/`) : construction manuelle du message MIME pour Gmail (`raw`), logique pure séparée de `mail.ts`.
> - Racine de résolution de dossiers Drive (`folderResolver.ts`) : "Mon Drive" (`root`) pour le premier segment d'un chemin comme `Contrats/2026`. Ambiguïté (plusieurs dossiers identiques au même niveau) → `Erreur`, par cohérence avec la règle déjà explicite pour `external` (specs.md §3).
> - `driveRole` (`googleDocsHelpers.ts`) : `reader`/`commenter` inchangés, `editor` → `writer` (rôles natifs de l'API Drive).
> - URL d'un brouillon Gmail — voir correction en tête de changelog (v7).
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
│   ├── paths.ts               # PROJECT_ROOT (résolu depuis import.meta.url, pas process.cwd())
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
│       ├── log.ts             # loggedStep : logging de progression en temps réel (actif par défaut, --quiet pour le couper)
│       ├── rowContext.ts      # définition du type RowContext
│       └── modules/
│           ├── json2columns.ts              # enrichissement depuis un fichier JSON externe, indexé par une colonne clé
│           ├── columns.ts             # calcule une valeur (balises) et l'écrit dans une colonne du Sheet
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

OAuth2 "Desktop app", scopes Sheets/Docs/Drive/Gmail, `credentials.json`/`token.json` locaux (résolus depuis `PROJECT_ROOT`, §1 — pas `process.cwd()`), refresh token à 7 jours (compte Gmail personnel, statut "Testing"), reconnexion manuelle acceptée.

Le scope `drive` déjà présent couvre la modification des permissions de partage (`permissions.create`) — aucun scope supplémentaire requis pour `resolveShareSettings`.

---

## 3. Orchestrateur & Pipeline

### Les cinq phases

```
[Filtre des lignes à traiter] → [Enrichissement JSON] → [Colonnes calculées] → [Création de fichiers : gDocs, PDF, ...] → [Mail]
```

Chaque instance Mail résout ses propres pièces jointes en interne, via une fonction utilitaire partagée — pas de phase Attachment séparée. `json2columns[]` s'exécute en tout premier : `runJson2ColumnsInstance` écrit dans `context.rawData` avant tout appel `columns[]`/`gdocs[]`/`pdf[]`/`mail[]`. `columns[]` s'exécute juste après, pour la même raison : `runColumnsInstance` écrit aussi dans `context.rawData` avant `gdocs[]`/`pdf[]`/`mail[]`. Dans les deux cas, la valeur écrite devient utilisable par une balise `{{...}}` ordinaire dans les phases suivantes, pour la même ligne.

### Nommage technique des instances

Avant l'exécution, l'orchestrateur annote chaque objet de configuration d'instance avec son identifiant technique de position (`gdocs[0]`, `pdf[1]`, `mail[0]`...), calculé à partir de son index dans le tableau du profil. Cet identifiant est distinct de la clé `name` (optionnelle, définie par l'utilisateur — specs.md §3) : l'identifiant technique sert de référence stable dans tout le système ; `name`, quand présent, ne fait que s'afficher en complément dans les messages d'erreur. Une instance `disable: true` (specs.md §3) garde le même identifiant qu'une instance active à la même position — le `.entries()` du tableau n'est jamais filtré avant calcul de l'index, seulement après (dans la boucle d'exécution, `processRow`) — donc désactiver `gdocs[0]` ne renomme jamais `gdocs[1]` en `gdocs[0]`.

### Purge des sorties existantes en début de ligne

Avant d'exécuter la moindre instance, l'orchestrateur lit `mmm_outputs` tel qu'il existait avant cette exécution (déjà disponible depuis la lecture initiale du Sheet). Pour **chaque** entrée qui y figure, `purgeRowOutputs` retrouve la config actuelle de l'instance via `resolveInstanceByRef(key, profile)` et décide au cas par cas :

```ts
const instance = resolveInstanceByRef(key, profile);
if (!instance) {
  preserved[key] = value; // ne résout à aucune instance de CE profil : jamais purgée, jamais perdue (v34)
  continue;
}
let willRunThisRow: boolean;
try {
  willRunThisRow = !instance.disable && matchesFilter(key, instance.filter, row.rawData);
} catch {
  willRunThisRow = false; // filtre non évaluable ici : préserver par sécurité, l'erreur réapparaîtra via skipIfFiltered
}
if (!willRunThisRow) {
  preserved[key] = value; // désactivée, ou filtre non satisfait pour cette ligne : ni purgée, ni perdue
  continue;
}
// instance trouvée, active, va se régénérer cette ligne : purge normale (gdocs/pdf uniquement)
```

- Instance introuvable dans le profil **en cours d'exécution** → **ni purgée, ni perdue** (v34, corrige un bug de perte de données réel) : l'entrée est recopiée telle quelle dans `preserved`. Avant ce correctif, ce cas était traité comme "orpheline" (instance retirée du profil) et purgée sans condition — ce qui est correct pour une instance réellement retirée d'un profil, mais `mmm_outputs` est une cellule du Sheet, pas un espace de noms par profil : si un second profil traite les mêmes lignes (ex: un profil de génération gDocs et un profil de lookup JSON tous deux pointés sur le même `sheetId`/`sheetTabName`), ses propres clés (`gdocs[0]`, `pdf[0]`...) ne résolvent jamais dans le profil en cours d'exécution — indiscernable, avec l'ancienne logique, d'une instance réellement retirée. Résultat observé : lancer le profil B trashait un fichier valide généré par le profil A. `resolveInstanceByRef` n'a pas et ne peut pas avoir cette information (il ne connaît que `profile`, jamais "quel profil a écrit cette clé"), donc la seule décision sûre par défaut est de ne jamais purger une clé non résolue. Contrepartie assumée : le nettoyage automatique d'une instance réellement retirée d'un profil doit désormais se faire manuellement sur Drive — cas jugé plus rare et moins coûteux qu'une suppression accidentelle inter-profils.
- Instance trouvée, active, filtre satisfait (ou absent) → elle va se régénérer cette ligne : fichier `gdocs[i]`/`pdf[i]` envoyé à la corbeille via `extractDriveFileId` + `files.update(fileId, { trashed: true })`, avertissement loggé (purge de l'ancien avant que le nouveau ne soit créé juste après) ; entrée `mail[i]` simplement abandonnée de `preserved` (jamais de purge physique pour mail — specs.md §2, §6), régénérée juste après par `updateOutput`.
- Instance trouvée mais `disable: true`, ou `filter` non satisfait pour cette ligne (ou non évaluable — colonne absente) → **ni purgée, ni perdue** : l'entrée est recopiée telle quelle dans `preserved`, sans aucun appel `files.update`. Corrige un bug de perte de données (v24) : avant ce correctif, ce cas n'était pas distingué et suivait le chemin "orpheline/va régénérer", trashant un fichier qui ne serait jamais recréé.

`preserved` devient le nouveau contenu de `mmm_outputs`, écrit via `sheetsWriter.resetOutputs(row.rowNumber, preserved)` (mmm_last_run mis à jour dans le même appel) avant que la génération ne commence — remplace l'ancien `resetOutputs(rowNumber)` qui écrivait toujours le littéral `'{}'`, sans possibilité de rien conserver.

Cette purge par instance remplace une vérification "juste avant régénération" globale et aveugle : elle garantit qu'une instance sur le point de régénérer ne laisse pas de doublon, qu'une instance simplement mise en pause ou temporairement hors filtre ne perd rien (v24), et — depuis v34 — qu'une clé appartenant à un autre profil partageant le même Sheet n'est jamais prise pour un résidu à nettoyer.

### Exécution séquentielle

Toutes les instances `gdocs[]` d'abord (ordre du tableau), puis toutes les instances `pdf[]`, puis toutes les instances `mail[]`. Aucun parallélisme.

### Exécution conditionnelle par ligne (`filterEngine.ts`)

`disable` (ci-dessus) est un réglage statique du profil — connu au chargement, jamais dépendant d'une ligne du Sheet. `filter` (specs.md §3) répond au besoin symétrique : sauter une instance pour certaines lignes seulement, selon leurs valeurs de colonnes. Cette dépendance à `rawData` interdit toute validation statique équivalente à celle de `disable` (§6) — la validité d'un `filter` ne peut être connue qu'au moment de traiter une ligne réelle.

`matchesFilter(moduleName, filter, rawData)` (`filterEngine.ts`, fonction pure, aucun état) :
```ts
function evaluateCondition(moduleName, condition, rawData) {
  if (!(condition.label in rawData)) {
    throw new ModuleError(moduleName, `Filtre : colonne "${condition.label}" absente du tableau`);
  }
  // insensible à la casse, espaces non normalisés
  const isEqual = rawData[condition.label].toLowerCase() === condition.value.toLowerCase();
  return condition.criterium === 'not_equals' ? !isEqual : isEqual;
}

function matchesFilter(moduleName, filter, rawData) {
  if (!filter) return true;
  const results = filter.conditions.map((c) => evaluateCondition(moduleName, c, rawData));
  if (filter.match === 'all') return results.every(Boolean);
  if (filter.match === 'any') return results.some(Boolean);
  return results.every((r) => !r); // 'none'
}
```

Dans `processRow`, `skipIfFiltered` appelle `matchesFilter` juste après le test `disable`, dans chacune des trois boucles (gdocs/pdf/mail) : `filter` non satisfait → `continue` (comme `disable`), avec un log dédié hors `--quiet` — mais ce n'est jamais une `Erreur`, la ligne continue normalement.

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

function parseSheetNumber(moduleName: string, name: string, rawValue: string): number {
  const parsed = Number(rawValue);
  if (Number.isNaN(parsed)) {
    throw new ModuleError(moduleName, `Balise {{${name}}} : la valeur ne correspond pas à un nombre (cellule formatée en texte brut ?)`);
  }
  return parsed;
}

function formatNumberFr(value: number, decimals?: number, noGroup = false): string {
  return new Intl.NumberFormat('fr-FR', {
    useGrouping: !noGroup,
    ...(decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  }).format(value);
}

// Vrai si la valeur, arrondie au centime le plus proche, a des centimes non nuls.
// Number.EPSILON corrige l'imprécision flottante (12.335 est stocké en interne comme
// 12.334999... qui arrondirait autrement vers le bas) — vérifié sur les 6 cas rapportés
// par l'utilisateur, voir templateEngine.test.ts.
function hasNonZeroCents(value: number): boolean {
  const cents = Math.round((value + Number.EPSILON) * 100);
  return cents % 100 !== 0;
}

// 0 décimale si le montant est rond, 2 sinon — sauf si `decimals` est fourni explicitement
// (modificateur format:<n>), qui prime toujours sur cette règle automatique. `noGroup`
// (modificateur nospace) retire uniquement le séparateur de milliers — l'espace insécable
// avant "€" (généré par style: 'currency', indépendant de useGrouping) reste inchangé.
function formatEuro(value: number, decimals?: number, noGroup = false): string {
  const fractionDigits = decimals ?? (hasNonZeroCents(value) ? 2 : 0);
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    useGrouping: !noGroup,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function applyModifiers(
  moduleName: string,
  name: string,
  type: string,
  modifiers: string[],
  rawValue: string,
  defaultDateFormat: string,
): string {
  const parsedDate = type === 'date' ? parseSheetDate(moduleName, name, rawValue) : null;
  const parsedNumber = type === 'number' || type === 'euro' ? parseSheetNumber(moduleName, name, rawValue) : null;
  // nospace n'est pas positionnel comme les autres modificateurs : il pilote le même appel
  // Intl.NumberFormat que format:<n>, donc résolu une fois pour toutes ici (comme required),
  // plutôt qu'appliqué à sa position — se combine avec format:<n> dans n'importe quel ordre.
  const noGroup = modifiers.includes('nospace');

  // Valeur de départ déjà mise en forme (format par défaut) pour date/number/euro — pas
  // la valeur brute — pour que prefix(...)/suffix(...) sans format: explicite s'appliquent
  // au texte réellement affiché plutôt que d'être écrasés en fin de parcours (voir v12).
  let value = rawValue;
  if (type === 'date') value = formatDate(parsedDate!, defaultDateFormat, { locale: fr });
  if (type === 'number') value = formatNumberFr(parsedNumber!, undefined, noGroup);
  if (type === 'euro') value = formatEuro(parsedNumber!, undefined, noGroup);

  for (const modifier of modifiers) {
    if (modifier === 'required') continue;
    if (modifier === 'nospace') {
      if (type !== 'number' && type !== 'euro') {
        throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "nospace" incompatible avec le type "${type}"`);
      }
      continue; // déjà pris en compte dans noGroup ci-dessus
    }
    if (modifier.startsWith('format:')) {
      const arg = modifier.slice('format:'.length);
      if (type === 'date') {
        value = formatDate(parsedDate!, arg, { locale: fr });
      } else if (type === 'number' || type === 'euro') {
        const decimals = Number(arg);
        if (!Number.isInteger(decimals) || decimals < 0) {
          throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "format:${arg}" invalide pour le type "${type}" (attendu un nombre entier de décimales, ex: format:2)`);
        }
        value = type === 'number' ? formatNumberFr(parsedNumber!, decimals, noGroup) : formatEuro(parsedNumber!, decimals, noGroup);
      } else {
        throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "format" incompatible avec le type "${type}"`);
      }
    } else if (modifier === 'initial') {
      if (type !== 'string') throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "initial" incompatible avec le type "${type}"`);
      value = value.charAt(0).toUpperCase() + '.';
    } else if (modifier === 'capitalize') {
      value = value.replace(/(^|[\s\-'])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());
    } else if (modifier === 'uppercase') {
      value = value.toUpperCase();
    } else if (modifier === 'lowercase') {
      value = value.toLowerCase();
    } else if (modifier.startsWith('prefix(') && modifier.endsWith(')')) {
      value = modifier.slice('prefix('.length, -1) + value;
    } else if (modifier.startsWith('suffix(') && modifier.endsWith(')')) {
      value = value + modifier.slice('suffix('.length, -1);
    } else {
      throw new ModuleError(moduleName, `Balise {{${name}}} : modificateur "${modifier}" inconnu`);
    }
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
  drive: drive_v3.Drive,
  fileId: string,
  shareConfig: { email?: { addresses: string[]; permission: 'reader'|'commenter'|'editor' }; link?: { permission: 'reader'|'commenter'|'editor' } },
  rawData: Record<string, string>,
  defaultDateFormat: string,
  rowNumber = 0,
  quiet = true,
): Promise<void> {
  const logPrefix = `Ligne ${rowNumber} : ${moduleName} : partage`;

  if (shareConfig.link) {
    await loggedStep(quiet, `${logPrefix} — lien public`, () =>
      drive.permissions.create({ fileId, requestBody: { type: 'anyone', role: driveRole(shareConfig.link.permission) } }));
  }
  if (shareConfig.email) {
    for (const addressTemplate of shareConfig.email.addresses) {
      const address = renderTemplateString(moduleName, addressTemplate, rawData, {}, defaultDateFormat);
      await loggedStep(quiet, `${logPrefix} — email "${address}"`, () =>
        drive.permissions.create({ fileId, requestBody: { type: 'user', emailAddress: address, role: driveRole(shareConfig.email.permission) } }));
    }
  }
}
```

`rowNumber`/`quiet` défaut à `0`/`true` uniquement pour ne pas casser les sites d'appel des tests existants (voir remarque similaire, résumé v15) — l'appelant réel (`gdocs.ts`) passe toujours `context.rowNumber`/`deps.quiet` explicitement.

`driveRole` traduit `reader`/`commenter`/`editor` vers les rôles Drive natifs : `reader`→`reader`, `commenter`→`commenter` (inchangés), `editor`→`writer` (seul le nom diffère). Échec en cours de boucle → permissions déjà accordées restent en place. Le fichier lui-même est déjà tracé dans `mmm_outputs` avant cet appel, donc un échec ici n'orpheline jamais le fichier.

### Résolution des pièces jointes par instance Mail

```ts
async function resolveAttachments(
  moduleName: string,
  config: MailInstance,
  context: RowContext,
  deps: PipelineDeps,
): Promise<ResolvedAttachment[]> {
  const fromGenerated = config.attach === 'all' || config.attach === 'generated'
    ? config.generated.map((ref) => {
        const output = context.outputs[ref] as FileOutput | undefined;
        if (!output) {
          // disable est déjà exclu statiquement (superRefine, §6) — un filter non satisfait
          // est donc la seule cause restante d'une référence "generated" manquante ici.
          const referenced = resolveInstanceByRef(ref, deps.profile);
          const reason = referenced?.filter
            ? ' Cette instance a un filtre configuré, qui n\'a peut-être pas été satisfait pour cette ligne.'
            : '';
          throw new ModuleError(moduleName, `Référence "${ref}" introuvable dans les sorties générées.${reason}`);
        }
        return { fileId: extractDriveFileId(output.url), filename: output.filename, mimeType: 'application/pdf' };
      })
    : [];

  const fromExternal = config.attach === 'all' || config.attach === 'external'
    ? await resolveExternalFiles(moduleName, deps, context, config.external, config)
    : [];

  return [...fromGenerated, ...fromExternal];
}
```

`resolveExternalFiles` (signature élargie : reçoit désormais l'objet `{ externalFolder?, externalFolderId?, externalSubfolder? }` plutôt qu'une seule chaîne de chemin) : résout le dossier via `folderResolver.resolveConfiguredFolderId` (autoCreate forcé à `false`, y compris pour `externalSubfolder` — voir §7), résout chaque entrée de `external` via `renderTemplateString`, détecte les doublons de noms résolus (`Erreur` immédiate si deux entrées se résolvent au même nom), puis un `drive.files.list` par nom recherché — enveloppé par `loggedStep` (le nom du fichier recherché est inclus dans le message pour rester non ambigu si plusieurs recherches se suivent). 0 résultat, plusieurs résultats, ou doublon résolu → `Erreur`. `ResolvedAttachment` (type interne à `mail.ts`) = `{ fileId, filename, mimeType }` — `mimeType` toujours `'application/pdf'` pour une pièce jointe `generated` (un PDF, par construction), déduit du fichier Drive lui-même pour une pièce jointe `external`.

### Composition du message (Gmail, `mimeMessage.ts`)

L'API Gmail n'offre pas de méthode haut niveau pour composer un message avec pièces jointes : `users.drafts.create`/`users.messages.send` attendent un message RFC 2822 complet, encodé en base64url, dans le champ `raw`. `mimeMessage.ts` construit ce message brut (logique pure, sans appel réseau) :
- Sujet encodé en `=?UTF-8?B?<base64>?=` (RFC 2047), systématiquement — valide même pour un sujet purement ASCII, évite de détecter au cas par cas.
- Corps HTML et chaque pièce jointe en base64 (`Content-Transfer-Encoding: base64`), lignes limitées à 76 caractères (RFC 2045).
- Contenu des pièces jointes téléchargé via `drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })`, bufferisé puis encodé en base64.
- Message final encodé en base64url (`toBase64Url`) pour le champ `raw`, requis par l'API Gmail.
- `draft_only: true` → `users.drafts.create`, `mmm_outputs.mail[i]` = `{ url: 'https://mail.google.com/mail/u/0/#drafts?compose=<data.message.id>', draftOnly: true, ... }` — **vérifié en conditions réelles**. Ni `#drafts/<id>` (obsolète dans l'UI Gmail actuelle) ni `data.id` (l'ID du brouillon lui-même, qui n'ouvre rien) ne fonctionnent ; seul l'ID du **message** sous-jacent, avec le paramètre `?compose=`, ouvre effectivement le brouillon. **Fragile par nature** : ce lien cesse de fonctionner dès que le brouillon est modifié ou restauré depuis la corbeille — l'ID de composition affiché par l'UI Gmail moderne (une longue chaîne alphanumérique, ex. `DmwnWrRrlZdPRSXhFTgQHrgNvnDNXqXjhlddPhsfXPBhDgClMzGkPnKfRZSRKdlcMQwLZTtSDcNQ`) est généré côté client et n'est pas dérivable depuis l'API Gmail. Retenu quand même : reste valide juste après la génération (le cas d'usage principal), et un lien générique vers `#drafts` n'apporterait aucune information que l'utilisateur n'a pas déjà en ouvrant Gmail manuellement. `draft_only: false` → `users.messages.send`, `mmm_outputs.mail[i]` = `{ url: 'https://mail.google.com/mail/u/0/#sent/<data.id>', draftOnly: false, ... }` — **vérifié en conditions réelles, lien stable**.

### Étapes de l'orchestrateur

1. Charge et valide la configuration.
2. Si le profil contient au moins une instance `disable: true` (tous modules confondus), logge une notification unique les listant (`listDisabledInstances`) — avant toute authentification, et non affectée par `--quiet`.
3. S'authentifie (§2).
4. Détermine la liste des lignes à traiter (filtre structurel + `--lines`/`--force`).
5. Écrit `En cours d'exécution` (+ `mmm_last_run`) sur la première ligne. Liste vide → sortie propre (code `0`).
6. Pour chaque ligne : purge les sorties existantes, construit un `RowContext` (`outputs: {}`), annote chaque instance avec son identifiant technique, puis exécute dans l'ordre : instances `json2columns[]` (recherche dans le fichier JSON → écriture des colonnes trouvées, alimente `context.rawData` — voir §3), instances `columns[]` (calcul → écriture de la colonne, alimente aussi `context.rawData`), instances `gdocs[]` (création → écriture incrémentale → `resolveShareSettings` si configuré), instances `pdf[]` (création → écriture incrémentale), instances `mail[]` (composition/envoi → écriture incrémentale) — une instance `disable: true` est sautée (`continue`) avant tout appel, **sans** consommer son tour dans l'exécution (mais son identifiant de position, lui, reste inchangé — §3, §6). Juste après ce test, `skipIfFiltered` évalue `instance.filter` (s'il existe) via `matchesFilter(moduleName, filter, context.rawData)` (`filterEngine.ts`) — si le filtre n'est pas satisfait pour cette ligne, l'instance est sautée (`continue`) exactement comme `disable`, avec un log dédié hors `--quiet` (`"<ligne> : <instance> : filtre non satisfait, ignoré."`), mais **sans** qu'il s'agisse d'une erreur : la ligne continue normalement vers les instances suivantes. Contrairement à `disable`, cette décision dépend de `rawData` et ne peut donc jamais être connue avant l'exécution réelle de la ligne. Toute erreur interrompt la ligne et le script (§8). Succès complet → `SheetsWriter.closeRow` final, qui ouvre aussi la ligne suivante (`markInitialRow` fusionné dans le même appel) — "ligne suivante" désigne la prochaine ligne **éligible** de la liste déjà filtrée à l'étape 4, pas nécessairement `rowNumber + 1`. `processRow` retourne `{ success, outputs, columnsWritten, json2ColumnsEnriched }` plutôt qu'un simple booléen — `outputs` (le `RowContext.outputs` de la ligne, y compris en cas d'échec en cours de route) alimente le rapport `--verbose` (étape 9), via `recordOutputs`, quelle que soit l'issue de la ligne ; `columnsWritten`/`json2ColumnsEnriched` (compteurs de succès pour cette ligne) sont accumulés séparément par `runPipeline` et transmis à `printSummary`. `json2ColumnsEnriched` ne compte que les lignes où `runJson2ColumnsInstance` a effectivement trouvé une correspondance (retourne `true`) — une clé sans correspondance retourne `false` sans incrémenter le compteur.
7. `--dry-run` : respecté individuellement par chaque module et `SheetsWriter`. Concrètement, chaque module (`gdocs`/`pdf`/`mail`) résout d'abord ses champs purs (nom de fichier, destinataires…, sans appel API), puis court-circuite avant tout appel Drive/Docs/Gmail réel si `dryRun` est actif, en écrivant une sortie synthétique (`url: '(dry-run)'`) via `SheetsWriter` — lui-même en écriture simulée (lectures réelles conservées).
8. Logging de progression en temps réel (`loggedStep`, `pipeline/log.ts`) : actif par défaut, désactivable via `--quiet` (`deps.quiet`/`CliFlags.quiet`). Chaque appel réseau individuel (pas seulement les changements de ligne/instance) est enveloppé par `loggedStep`, qui logge `"<message>..."` juste avant l'appel puis une ligne `"→ OK"` (volontairement compacte, ne répète pas le message — voir v20) une fois résolu avec succès — aucun `"→ OK"` si l'appel échoue, ce qui situe déjà l'erreur avant même son message. `--quiet` ne change que cette verbosité de progression, jamais le comportement.
9. `--verbose` (`CliFlags.verbose`, indépendant de `--quiet`) : après `printSummary` (succès ou échec), `printVerboseManifest(report, profile)` affiche le détail ligne par ligne de chaque sortie accumulée dans `report` (`ModuleReport`, `Map<string, Array<{ rowNumber, output }>>`, construit au fil des lignes par `recordOutputs`). Groupé par instance dans l'ordre du profil (`gdocs[]` puis `pdf[]` puis `mail[]`), instance omise si aucune entrée dans `report` (désactivée, ou jamais atteinte). `isMailOutput` (garde de type sur la présence de `to`) distingue le format de ligne gDocs/PDF (`<filename> : <url>`) du format Mail (`<to> - <subject> - <url>`). `columns[]`/`json2columns[]` n'alimentent ni `report` ni ce détail — leurs compteurs (`columnsWritten`/`json2ColumnsEnriched`) ne passent que par `printSummary`.

---

## 4. RowContext

### Forme

```ts
type FileOutput = { filename: string; url: string; createdAt: string };
type MailOutput = { to: string; subject: string; url: string; draftOnly: boolean; attachments: string[]; createdAt: string };

type RowContext = {
  rowNumber: number;
  rawData: Record<string, string>;
  outputs: Record<string, FileOutput | MailOutput>;
  error?: { module: string; message: string };
};
```

`createdAt` (`new Date().toISOString()`) est en ISO 8601, contrairement à `mmm_last_run` (lecture humaine) — cette valeur n'est jamais lue directement à l'œil.

`MailOutput.to` (destinataire déjà résolu) est écrit dans les trois branches de `runMailInstance` (dry-run, brouillon, envoi) — ajouté spécifiquement pour `--verbose` (§3, `printVerboseManifest`), qui en a besoin sans vouloir re-résoudre `config.to` depuis le profil.

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

Sept méthodes publiques — `markInitialRow`, `resetOutputs` (réinitialise `mmm_outputs` à `{}`, utilisée par la purge — §3), `updateOutput` (écriture incrémentale, fusion avec `mmm_outputs` existant), `closeRow`, `writeColumn` (§3, module `columns[]`), `hasColumn`/`writeColumns` (§3, module `json2columns[]`) — toutes les méthodes d'écriture passent par le même `writeCells` privé (batching), et mettent aussi à jour `mmm_last_run` (format `d/M/yyyy HH:mm`) dans le même appel API. `hasColumn` seule ne touche à aucune API (lecture pure de l'en-tête déjà en mémoire).

### Colonnes libres : résolution et création à la volée (`resolveOrCreateColumn`, `writeColumn`)

Contrairement aux trois colonnes réservées (index résolus une fois pour toutes à la construction, dans `columns: ColumnIndexes`), une colonne ciblée par `columns[]` (specs.md §3) n'est pas forcément connue à l'avance — `SheetsWriter` garde donc aussi l'en-tête complet (`headers: string[]`, mutable) en mémoire, initialisé à la même lecture que les colonnes réservées.

```ts
private async resolveOrCreateColumn(columnName: string): Promise<number> {
  const existingIndex = this.headers.indexOf(columnName);
  if (existingIndex !== -1) return existingIndex;

  const newIndex = this.headers.length;
  const newHeaders = [...this.headers, columnName];
  if (this.dryRun) {
    console.log(`[dry-run] Colonne créée (simulée) : "${columnName}"...`);
  } else {
    await loggedStep(this.quiet, `Création de la colonne "${columnName}"`, () =>
      this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `${this.sheetTabName}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [newHeaders] },
      }),
    );
    console.warn(`Colonne créée automatiquement : "${columnName}"...`);
  }
  this.headers = newHeaders;
  return newIndex;
}

async writeColumn(rowNumber: number, columnName: string, value: string): Promise<void> {
  const column = await this.resolveOrCreateColumn(columnName);
  await this.writeCells([
    { column, rowNumber, value },
    { column: this.columns.mmm_last_run, rowNumber, value: this.nowFormatted() },
  ]);
}
```

Même mécanisme d'ajout d'en-tête que les colonnes système manquantes (`SheetsWriter.create`, ci-dessus), mais **sans** flag équivalent à `--init-columns` : la création est toujours automatique, la contrepartie étant que `columns[].output_column` ne peut pas être l'un des noms réservés (vérifié statiquement, `config/schema.ts` §6). Création "à la volée" — la première ligne qui écrit réellement dans cette colonne (instance active, `filter` satisfait) la crée ; une instance jamais déclenchée (`disable`, ou filtre jamais satisfait sur aucune ligne traitée) ne crée jamais sa colonne. Une fois créée pendant l'exécution, `this.headers` est mis à jour en mémoire — un `writeColumn` suivant vers la même colonne (autre ligne, ou autre instance `columns[]`) ne déclenche pas une seconde création.

### Colonnes existantes uniquement, sans création (`hasColumn`, `writeColumns`)

`json2columns[]` (specs.md §3) a besoin de l'inverse de `resolveOrCreateColumn` : vérifier qu'une colonne existe **sans jamais la créer** (les noms viennent d'un fichier JSON externe, pas du profil — une création automatique masquerait trop facilement une faute de frappe dans ce fichier). `hasColumn` est une lecture pure de `this.headers`, sans appel réseau :

```ts
hasColumn(columnName: string): boolean {
  return this.headers.includes(columnName);
}

async writeColumns(rowNumber: number, entries: Record<string, string>): Promise<void> {
  const cells: CellWrite[] = Object.entries(entries).map(([columnName, value]) => ({
    column: this.headers.indexOf(columnName),
    rowNumber,
    value,
  }));
  cells.push({ column: this.columns.mmm_last_run, rowNumber, value: this.nowFormatted() });
  await this.writeCells(cells);
}
```

`writeColumns` ne revérifie pas l'existence des colonnes (`indexOf` pourrait renvoyer `-1`) : c'est un invariant maintenu par son seul appelant (`json2columns.ts`), qui appelle systématiquement `hasColumn` sur **toutes** les colonnes cibles avant d'appeler `writeColumns` — cohérent avec la consigne du projet de ne valider qu'aux frontières du système, pas en interne entre fonctions qui se font déjà confiance. Contrairement à `writeColumn` (une colonne, un appel), `writeColumns` regroupe plusieurs colonnes en un seul `writeCells` — un seul appel `batchUpdate` plutôt qu'un par colonne.

### Détection des colonnes en double (`findDuplicateHeaders`)

`SheetsWriter.create` lit l'en-tête (`sheetTabName!1:1`) avant toute autre chose dans `runPipeline` (couvre donc aussi `--validate`). Juste après cette lecture, `findDuplicateHeaders` compte les occurrences de chaque titre non vide et retourne ceux apparaissant plus d'une fois — `Erreur` immédiate si le résultat est non vide, avant même la logique des colonnes `mmm_*` manquantes (qui deviendrait trompeuse sur un en-tête déjà incohérent). Un seul point de vérification : `readSheetRows` (orchestrator.ts §3), qui relit l'en-tête séparément pour construire `rawData` par ligne, s'exécute toujours après `SheetsWriter.create` dans `runPipeline` et n'a donc pas besoin de sa propre vérification.

```ts
function findDuplicateHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  for (const header of headers) {
    if (header === '') continue;
    counts.set(header, (counts.get(header) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}
```

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

const FilterConditionSchema = z.object({
  label: z.string(),
  criterium: z.enum(['equals', 'not_equals']), // extensible sans casser le format existant
  value: z.string(),
});

const FilterSchema = z.object({
  match: z.enum(['all', 'any', 'none']), // all = ET, any = OU, none = NI l'un ni l'autre
  conditions: z.array(FilterConditionSchema).min(1),
});

const InstanceMetaSchema = z.object({
  name: z.string().max(80).optional(),
  description: z.string().max(500).optional(),
  disable: z.boolean().optional().default(false),
  filter: FilterSchema.optional(), // exécution conditionnelle par ligne, évaluée sur rawData — voir filterEngine.ts
});

// Miroir de RESERVED_COLUMNS (sheetsWriter.ts) — dupliqué ici pour éviter un import circulaire.
const RESERVED_COLUMN_NAMES = ['mmm_status', 'mmm_outputs', 'mmm_last_run'] as const;

const ColumnsInstanceSchema = z.object({
  template: z.string(),
  output_column: z.string(),
}).merge(InstanceMetaSchema);

const Json2ColumnsInstanceSchema = z.object({
  file: z.string(),        // validé (lecture + JSON.parse + forme) dans ProfileSchema.superRefine
  key_column: z.string(),
}).merge(InstanceMetaSchema);

const FileModuleFieldsSchema = z.object({
  template_id: z.string(),
  template_link: z.string().optional(),
  output_folder: z.string().optional(),
  output_folder_id: z.string().optional(),
  output_subfolder: z.string().optional(), // résolu sous output_folder_id — voir refines ci-dessous
  output_filename: z.string(),
  link_column: z.string().optional(), // nom de colonne choisi par l'utilisateur — voir writeLinkColumn
}).merge(InstanceMetaSchema);

const outputFolderXorRefine = (i: { output_folder?: string; output_folder_id?: string }) =>
  Boolean(i.output_folder) !== Boolean(i.output_folder_id);
const outputFolderXorMessage = { message: 'Exactement une des deux clés output_folder / output_folder_id doit être fournie.' };

// output_subfolder n'a de sens qu'avec output_folder_id (avec output_folder, le segment se rajoute au chemin) ; jamais vide.
const outputSubfolderRequiresIdRefine = (i: { output_folder_id?: string; output_subfolder?: string }) =>
  !i.output_subfolder || Boolean(i.output_folder_id);
const nonEmptyIfPresent = (value?: string) => value === undefined || value.trim().length > 0;

const PdfInstanceSchema = FileModuleFieldsSchema
  .refine(outputFolderXorRefine, outputFolderXorMessage)
  .refine(outputSubfolderRequiresIdRefine, { message: 'output_subfolder ne peut être utilisé qu\'avec output_folder_id.' })
  .refine((i) => nonEmptyIfPresent(i.output_subfolder), { message: 'output_subfolder ne peut pas être une chaîne vide.' });

const ShareConfigSchema = z.object({
  email: z.object({ addresses: z.array(z.string()), permission: z.enum(['reader', 'commenter', 'editor']) }).optional(),
  link: z.object({ permission: z.enum(['reader', 'commenter', 'editor']) }).optional(),
}).refine(
  (share) => Boolean(share.email) || Boolean(share.link),
  { message: 'share doit contenir au moins une des deux clés email ou link.' }
).optional();

const GdocsInstanceSchema = FileModuleFieldsSchema
  .extend({ share: ShareConfigSchema })
  .refine(outputFolderXorRefine, outputFolderXorMessage)
  .refine(outputSubfolderRequiresIdRefine, { message: 'output_subfolder ne peut être utilisé qu\'avec output_folder_id.' })
  .refine((i) => nonEmptyIfPresent(i.output_subfolder), { message: 'output_subfolder ne peut pas être une chaîne vide.' });

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
  externalFolderId: z.string().optional(),
  externalSubfolder: z.string().optional(), // résolu sous externalFolderId — voir refines ci-dessous
  external: z.array(z.string()).optional().default([]),
  link_column: z.string().optional(),
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
  (mail) => !(mail.externalFolder && mail.externalFolderId),
  { message: 'externalFolder et externalFolderId sont mutuellement exclusifs.' }
).refine(
  (mail) => mail.external.length === 0 || Boolean(mail.externalFolder) || Boolean(mail.externalFolderId),
  { message: 'externalFolder ou externalFolderId est requis dès que external est utilisé.' }
).refine(
  (mail) => !mail.externalSubfolder || Boolean(mail.externalFolderId),
  { message: 'externalSubfolder ne peut être utilisé qu\'avec externalFolderId.' }
).refine(
  (mail) => nonEmptyIfPresent(mail.externalSubfolder),
  { message: 'externalSubfolder ne peut pas être une chaîne vide.' }
);

const ProfileSchema = z.object({
  sheetId: z.string(),
  sheetTabName: z.string(),
  autoCreateFolders: z.boolean().default(true),
  defaultDateFormat: z.string().default('d/M/yyyy'),
  gdocs: z.array(GdocsInstanceSchema).optional().default([]),
  pdf: z.array(PdfInstanceSchema).optional().default([]),
  mail: z.array(MailInstanceSchema).optional().default([]),
  columns: z.array(ColumnsInstanceSchema).optional().default([]),
  json2columns: z.array(Json2ColumnsInstanceSchema).optional().default([]),
}).superRefine((config, ctx) => {
  config.json2columns.forEach((json2ColumnsInstance, json2ColumnsIndex) => {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(json2ColumnsInstance.file, 'utf-8'));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `json2columns[${json2ColumnsIndex}].file : introuvable, illisible, ou JSON invalide.` });
      return;
    }
    const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (!isPlainObject(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `json2columns[${json2ColumnsIndex}].file : doit être un objet (clé → objet de colonnes).` });
      return;
    }
    for (const [key, entry] of Object.entries(parsed)) {
      if (!isPlainObject(entry)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `json2columns[${json2ColumnsIndex}].file : la valeur de "${key}" doit être un objet.` });
        continue;
      }
      for (const [column, value] of Object.entries(entry)) {
        if (value !== null && typeof value === 'object') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `json2columns[${json2ColumnsIndex}].file : clé "${key}", colonne "${column}" : valeur non simple.` });
        }
      }
    }
  });

  config.columns.forEach((columnsInstance, columnsIndex) => {
    if ((RESERVED_COLUMN_NAMES as readonly string[]).includes(columnsInstance.output_column)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `columns[${columnsIndex}].output_column : "${columnsInstance.output_column}" est une colonne système réservée.` });
    }
  });

  // Même garde pour link_column (gdocs/pdf/mail) — généralisée en v26, seul output_column (columns[]) était couvert jusqu'ici.
  for (const [arrayName, instances] of [['gdocs', config.gdocs], ['pdf', config.pdf], ['mail', config.mail]] as const) {
    instances.forEach((instance, index) => {
      if (instance.link_column && (RESERVED_COLUMN_NAMES as readonly string[]).includes(instance.link_column)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${arrayName}[${index}].link_column : "${instance.link_column}" est une colonne système réservée.` });
      }
    });
  }

  const pdfRefs = new Set(config.pdf.map((_, i) => `pdf[${i}]`));
  const linkableRefs = new Set([
    ...config.gdocs.map((_, i) => `gdocs[${i}]`),
    ...pdfRefs,
  ]);
  const disabledRefs = new Set([
    ...config.gdocs.flatMap((instance, i) => (instance.disable ? [`gdocs[${i}]`] : [])),
    ...config.pdf.flatMap((instance, i) => (instance.disable ? [`pdf[${i}]`] : [])),
  ]);

  const LINK_TAG_PATTERN = /\{\{link:([a-zA-Z]+\[\d+\])\}\}/g;
  const extractLinkRefs = (text: string) => [...text.matchAll(LINK_TAG_PATTERN)].map((m) => m[1]);

  config.mail.forEach((mailInstance, mailIndex) => {
    const seenGenerated = new Set<string>();
    for (const ref of mailInstance.generated) {
      if (!pdfRefs.has(ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mail[${mailIndex}].generated : "${ref}" doit référencer une instance pdf[] (un gDoc ne peut pas être joint à un email)` });
      } else if (disabledRefs.has(ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mail[${mailIndex}].generated : "${ref}" est désactivée (disable: true) — impossible de la joindre.` });
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
        } else if (disabledRefs.has(ref)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mail[${mailIndex}] : {{link:${ref}}} référence une instance désactivée (disable: true)` });
        }
      }
    }
  });
});
```

Toutes ces validations sont **statiques** — détectables via `--validate` sans lire une seule ligne du Sheet. Elles s'exécutent à chaque lancement (au chargement de la config, via `loadConfig`), pas seulement avec `--validate`.

`template_link` (`FileModuleFieldsSchema`, donc `gdocs`/`pdf` uniquement) : aucune logique associée nulle part dans le code — ni lu par un module, ni vérifié par `superRefine`, ni par `validateResourceAccessibility` (§6). Un simple champ de type `string` optionnel, présent uniquement pour être visible dans le profil JSON.

### Emplacement du fichier de profil

`configs/<nom-du-profil>.json` (`loader.ts`) — un fichier par profil, nommé exactement comme l'argument positionnel de la commande (`mmmerge <profil>`). `configs/` est résolu depuis `PROJECT_ROOT` (`paths.ts`, §1), pas depuis `process.cwd()` — fonctionne quel que soit le dossier courant.

### `--validate`

En plus des validations statiques ci-dessus (déjà systématiques), `--validate` authentifie, résout les colonnes `mmm_*` via `SheetsWriter.create`, puis vérifie l'accessibilité Drive de chaque `template_id`/`output_folder_id` référencé par les instances `gdocs[]`/`pdf[]` **non désactivées** (`validateResourceAccessibility`, `orchestrator.ts`, filtre `!instance.disable` avant construction de la liste à vérifier) — un `drive.files.get` par ressource, en parallèle, toutes les ressources introuvables étant rapportées ensemble plutôt qu'au premier échec. Ne lit aucune ligne de données : `output_folder` (chemin dynamique) n'est donc pas vérifiable par cette voie.

### `--init-columns`

Si une ou plusieurs colonnes `mmm_status`/`mmm_outputs`/`mmm_last_run` sont absentes de l'en-tête, `SheetsWriter.create` lève par défaut une erreur les listant toutes. Avec `--init-columns`, elles sont ajoutées à la fin de la ligne d'en-tête (`values.update` sur la plage `<onglet>!1:1`) plutôt que de lever une erreur — respecte `--dry-run` (log de simulation, aucune écriture). Choix délibéré de ne pas les créer automatiquement par défaut : une colonne manquante peut aussi bien signifier un premier lancement sur ce Sheet qu'une erreur de configuration (mauvais `sheetTabName`/`sheetId`), que l'on ne veut pas masquer silencieusement.

---

## 7. Gestion des Fichiers Drive

### Résolution de chemins dynamiques (`folderResolver.ts`)

Substitution de balises via `renderTemplateString`, cache par exécution, création automatique des segments manquants selon `autoCreateFolders` (défaut `true`). Le premier segment est résolu depuis la racine "Mon Drive" (`root`) par défaut — un chemin comme `Contrats/2026` part donc de la racine du Drive du compte authentifié, sauf si un point de départ explicite est fourni (voir `resolveConfiguredFolderId` ci-dessous). Si plusieurs dossiers portent le même nom au même niveau (ambiguïté), `Erreur` listant les IDs Drive des dossiers en conflit (pour identifier lequel supprimer/renommer) — même règle que pour la recherche de fichiers externes (§3, §7 ci-dessous), bien que specs.md ne l'explicite que pour ce second cas.

`resolveFolderPath` accepte un neuvième paramètre optionnel `startParentId` (défaut `'root'`), pour descendre un chemin dynamique sous un dossier connu par ID plutôt que depuis la racine. La clé de cache (`cache.get`/`cache.set`) inclut désormais `startParentId` (`` `${startParentId}:${resolvedPath}` `` plutôt que `resolvedPath` seul) : deux instances partant de dossiers conteneurs différents peuvent résoudre le même chemin relatif (ex: même nom de sous-dossier `"2026-08"` sous deux `output_folder_id` distincts) sans que ce soit le même dossier Drive — sans cette correction, la seconde résolution renverrait à tort l'ID mis en cache par la première.

**`resolveConfiguredFolderId(moduleName, drive, config, rawData, defaultDateFormat, autoCreate, cache, quiet)`** — nouvelle fonction exportée, factorise la règle "chemin de noms depuis la racine (`config.folder`) XOR ID fixe (`config.folderId`), avec un sous-chemin dynamique optionnel (`config.subfolder`) résolu **sous** cet ID" : si `folderId` est fourni sans `subfolder`, retourne l'ID directement (aucun appel Drive, comportement historique inchangé) ; si `folderId` **et** `subfolder` sont fournis, résout `subfolder` via `resolveFolderPath` avec `folderId` comme `startParentId` ; sinon, résout `folder` comme chemin complet depuis la racine (comportement historique inchangé). Signature générique (`folder`/`folderId`/`subfolder`, pas `output_*`/`external*`) : partagée telle quelle par `googleDocsHelpers.ts#resolveOutputFolderId` (`output_folder`/`output_folder_id`/`output_subfolder`) et `mail.ts#resolveExternalFiles` (`externalFolder`/`externalFolderId`/`externalSubfolder`) — chaque appelant fait juste la correspondance de noms de champs, la logique de branchement n'est écrite qu'une fois.

### Copie du template (instances gDocs)

`resolveTemplateTagsForDoc` (lit et résout les balises du **template lui-même**, `config.template_id`, avant toute copie) → `files.copy` → `applyTemplateTags` (`documents.batchUpdate` avec les balises déjà résolues) → **écriture incrémentale de `mmm_outputs`/`mmm_last_run`** (§5) → si `share` configuré, `resolveShareSettings` (§3). L'écriture incrémentale précède délibérément le partage. URL stockée : `https://docs.google.com/document/d/<fileId>/edit` (format standard Google, non documenté ailleurs).

Résoudre les balises **avant** `files.copy` est délibéré : si une balise du template est invalide (type inconnu, `required` sur cellule vide, modificateur inconnu…), l'erreur est levée avant qu'aucun fichier Drive n'existe — sinon la copie, déjà créée, ne serait jamais nettoyée (elle n'est écrite dans `mmm_outputs` qu'après le remplissage réussi, donc invisible à la purge du prochain run — §3). Comme une copie fraîche a un contenu strictement identique au template au moment de la copie, résoudre les balises sur `template_id` puis les appliquer sur le `fileId` de la copie est équivalent à tout faire sur la copie, sans le risque de fichier orphelin.

### Cycle interne des instances PDF

`resolveTemplateTagsForDoc` sur `config.template_id` (même logique et même motivation anti-orphelin que pour gDocs, ci-dessus — particulièrement important ici car le doc temporaire ne serait sinon jamais supprimé) → `files.copy` (temporaire, nommé `[tmp] <nom rendu, sans extension>` — le doc temporaire n'est pas un PDF, son nom ne doit donc pas en porter l'extension) → `applyTemplateTags` → `files.export` (`mimeType: 'application/pdf'`, `responseType: 'stream'`) → `files.create` (destination finale, nom = `ensurePdfExtension(<nom rendu>)`, `media.body` = le flux exporté) → `files.delete` (suppression définitive du temporaire, pas une mise à la corbeille) → écriture incrémentale (`filename` inclut l'extension). URL stockée : `https://drive.google.com/file/d/<fileId>/view` — confirmée par l'exemple `mmm_outputs` de specs.md §1.

`ensurePdfExtension(filename: string): string` (`pdf.ts`) : ajoute `.pdf` si le nom rendu ne se termine pas déjà par `.pdf`/`.PDF` (`/\.pdf$/i`) — jamais de doublon. Motivé par un signalement utilisateur : `drive.files.create` ne déduit jamais d'extension à partir du `mimeType` fourni, contrairement à un upload via l'UI Drive — sans cette fonction, le fichier final (et par ricochet `output.filename`, utilisé tel quel comme nom de pièce jointe par `mail.ts` en mode `generated`) n'avait aucune extension.

### Recherche des fichiers externes (résolution interne à chaque instance Mail)

Dossier résolu via `resolveConfiguredFolderId` (voir ci-dessus) — `externalFolder` (chemin depuis la racine) ou `externalFolderId` (+ `externalSubfolder` optionnel résolu sous cet ID) — toujours avec `autoCreate` forcé à `false`, y compris pour `externalSubfolder` (c'est un dossier qu'on cherche, pas qu'on écrit — jamais de création automatique, contrairement à `output_subfolder`). Puis chaque nom de fichier résolu, puis `files.list` filtré sur ce nom exact + le dossier résolu. 0 résultat, plusieurs résultats, ou doublon résolu → `Erreur`.

### Purge globale avant régénération

Voir §3 ("Purge des sorties existantes en début de ligne").

---

## 8. Gestion des Erreurs

`ModuleError` (avec `module` incluant l'instance en cause), un seul `try/catch` dans l'orchestrateur englobant les trois phases, écriture confirmée du statut avant `process.exit(1)`, codes de sortie `0`/`1`, `--quiet` n'affecte que la verbosité du log de progression (`pipeline/log.ts`), jamais la présentation des erreurs.

**Erreur non interceptée au niveau `main()` (`cli.ts`)** : message seul (`Erreur : <message>`), **toujours**, jamais la trace de pile brute, quel que soit `--quiet`. Toute erreur fatale de cette application a un message explicite et actionnable par construction (`ModuleError`, erreurs de config Zod déjà formatées par `formatZodError`, erreurs `--lines`/Sheet/`SheetsWriter.create` déjà enrichies de contexte) — une trace technique n'ajoute jamais d'information utile pour l'utilisateur final, seulement du bruit qui peut faire passer une erreur de saisie anodine (ex: `--lines=1`, qui cible la ligne d'en-tête) pour un crash. Ce comportement a une histoire : introduit une première fois (commit `cd2ccce`), il a été accidentellement inversé lors de l'introduction de `--quiet` (v13) — le renommage `--verbose`→`--quiet` avait mécaniquement inversé aussi cette logique, alors que les deux n'ont aucun rapport (l'une concerne le logging de progression, l'autre la présentation finale d'une erreur fatale). Corrigé (v18) en découplant complètement les deux : la présentation d'erreur ne dépend plus d'aucun flag.
