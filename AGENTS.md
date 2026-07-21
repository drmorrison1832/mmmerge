# AGENTS.md — MMMerge

Outil local de publipostage automatisé (Node.js/TypeScript) piloté par Google Sheets : génère des Google Docs et PDF à partir de templates, et compose/envoie des emails, une ligne du tableur à la fois.

## Sources de vérité — à lire avant toute tâche

Ces deux fichiers font autorité sur le comportement et la conception. En cas de doute, s'y référer ; ne pas deviner.

- `docs/specs.md` — spécifications fonctionnelles (comportement observable, règles métier, format des colonnes `mmm_*`, syntaxe des balises).
- `docs/architecture.md` — conception technique (modules, types, schéma Zod, flux des appels API, gestion d'erreurs).
- `docs/schema-fonctionnement.md` — vue d'ensemble du pipeline (support visuel).

Chaque section de code renvoie à un numéro de section de ces documents (ex: « voir architecture.md §3 »).

## Stack

- TypeScript, Node.js 24 (LTS), modules ES (ESM), npm.
- Dépendances : `googleapis` (Sheets/Docs/Drive/Gmail), `mri` (parsing CLI), `zod` (validation + types via `z.infer`), `date-fns` (formatage des dates, locale `fr`).
- Tests : `vitest`.

## Commandes

```bash
npm install
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest run
node dist/cli.js <profil> [options]   # exécution (ex: node dist/cli.js contrat-cddu --dry-run)
```

## État actuel du projet

Scaffolding (walking skeleton) en place et compilant. Déjà implémentés : les types (`src/pipeline/rowContext.ts`) et le schéma Zod complet (`src/config/schema.ts`). Tout le reste est un **stub** qui lève `not implemented` — à compléter dans cet ordre recommandé (le plus sûr d'abord, sans API externe) :

1. `src/config/loader.ts` — parsing/fusion/validation.
2. `src/templateEngine.ts` — résolution des balises (logique pure, très testable).
3. `src/auth.ts`, puis les modules Google (`sheetsWriter`, `folderResolver`, `pipeline/modules/*`, `orchestrator`).

## Conventions propres à ce projet

- **Identifiant technique d'instance** (`gdocs[0]`, `pdf[1]`, `mail[0]`) : référence stable partout (erreurs, `generated`, `{{link:...}}`, clés de `mmm_outputs`). La clé `name` du profil est purement humaine — jamais une référence.
- **Fail-fast** : toute erreur métier lève une `ModuleError(module, message)`, remonte à l'orchestrateur, est écrite dans `mmm_status`, puis le script s'arrête. Pas de récupération silencieuse, pas de valeur par défaut de repli non spécifiée.
- **Validation stricte et symétrique** : préférer une erreur explicite à un comportement silencieux (voir les règles `attach` dans le schéma Zod). Une config sans effet est une erreur, pas un cas toléré.
- **Messages destinés à l'utilisateur : en français.** Commentaires de code : en français également, pour cohérence avec les docs.

## Frontières

- Ne jamais committer `credentials.json` ni `token.json` (déjà dans `.gitignore`).
- Ne pas modifier `dist/` à la main (généré par `tsc`).
- Ne pas ajouter de dépendance sans raison claire — l'outil vise la simplicité, pour un usage personnel à faible volume.

## Attente spécifique de l'auteur

Ce projet a aussi un but d'apprentissage. **Expliquer le raisonnement avant d'écrire du code** (quelles options, quels compromis), plutôt que de produire directement la solution. Découper en étapes compréhensibles ; ne pas enchaîner de longues modifications sans que l'intention soit claire.
