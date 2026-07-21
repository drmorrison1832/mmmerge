# Schéma de fonctionnement — MMMerge (mis à jour)

## Vue d'ensemble

```
┌────────────────────────────────┐
│ CLI                            │
│ mmmerge <profil> [options]     │
└───────────────┬────────────────┘
                ▼
┌────────────────────────────────┐
│ Configuration                  │
│ Parsing (mri), fusion, Zod     │
└───────────────┬────────────────┘
                ▼
┌────────────────────────────────┐
│ Authentification               │
│ OAuth2 : Sheets, Docs,          │
│ Drive, Gmail                   │
└───────────────┬────────────────┘
                ▼
┌────────────────────────────────┐
│ Orchestrateur                  │
│ Lecture + filtrage des lignes  │
│ (statut, --lines, --force,     │
│ lignes masquées)               │
└───────────────┬────────────────┘
                ▼
┌────────────────────────────────┐
│ Traitement ligne par ligne      │
│ → voir détail ci-dessous       │
└───────────────┬────────────────┘
                ▼
┌────────────────────────────────┐
│ Fin — code de sortie 0 ou 1    │
└────────────────────────────────┘
```

## Détail : traitement d'une ligne (pipeline en 3 phases)

```
                        RowContext (créé pour la ligne)
                        outputs: {}
                                 │
                                 ▼
        ┌────────────────────────────────────────────┐
        │  PHASE 1 : Création de fichiers             │
        │  (gDocs et PDF sont indépendants l'un       │
        │   de l'autre, chacun en tableau d'instances)│
        │                                              │
        │  gdocs[0] → gdocs[1] → ...                   │
        │  (partage éventuel du document via `share`) │
        │       │                                      │
        │       ▼ (dans l'ordre du tableau)            │
        │  pdf[0] → pdf[1] → ...                       │
        │       (chaque instance PDF crée en interne   │
        │        son propre gDoc temporaire, l'exporte │
        │        en PDF, puis le supprime)             │
        │                                              │
        │  → écrit dans outputs['gdocs[i]'] /          │
        │    outputs['pdf[i]'] : { filename, url }     │
        └───────────────────┬──────────────────────────┘
                             ▼
        ┌────────────────────────────────────────────┐
        │  PHASE 2 : Mail (tableau d'instances)        │
        │  Pour chaque instance mail[i], dans l'ordre :│
        │  - résout ses propres pièces jointes en      │
        │    interne (generated: pdf[] uniquement,     │
        │    external: fichiers dans externalFolder)   │
        │  - compose to / cc / subject / corps          │
        │    (balises {{variable}} + {{link:gdocs[0]}}) │
        │  - crée le brouillon ou envoie le message     │
        │                                              │
        │  → écrit dans outputs['mail[i]'] :           │
        │    { subject, url, attachments: [...] }      │
        └───────────────────┬──────────────────────────┘
                             │
        ┌────────────────────┴───────────────────────┐
        │ succès de toutes les instances   erreur (n'importe quelle instance/étape) │
        ▼                                             ▼
┌───────────────────────────┐        ┌───────────────────────────┐
│ SheetsWriter               │        │ SheetsWriter               │
│ mmm_status = "Succès"      │        │ mmm_status = "Erreur: ...  │
│ mmm_outputs = JSON(outputs)│        │  <module ex: mail[0]>"     │
│ + ouverture ligne suivante │        │                             │
└──────────────┬─────────────┘        └──────────────┬─────────────┘
               ▼                                      ▼
   ↻ Ligne suivante                          Arrêt du script (exit 1)
   (retour à "Orchestrateur")
```

## Points clés à retenir

- **Pipeline à 3 phases**, pas 4 : il n'y a plus de phase "Attachment" séparée — chaque instance Mail résout ses propres pièces jointes en interne, puisque des instances différentes peuvent avoir besoin de combinaisons différentes pour une même ligne.
- **`mmm_outputs`** est un seul champ JSON, indexé par instance (`gdocs[0]`, `pdf[1]`, `mail[0]`...), qui s'adapte à n'importe quel nombre d'instances configurées. Les fichiers générés utilisent la clé `filename` (pas `title`).
- **Un gDoc ne peut pas être joint à un email** — seul un PDF le peut (`generated` dans une instance Mail ne peut référencer que des instances `pdf[]`). Pour partager un gDoc, on configure `share` (email et/ou lien) sur l'instance gDocs elle-même, ou on référence son lien dans le corps du mail via `{{link:gdocs[0]}}`.
- **PDF ne dépend pas de gDocs** : chaque instance PDF a son propre template et gère son propre cycle interne (Doc temporaire → export → suppression), invisible dans `mmm_outputs`.
- **`mmm_status` reste du texte libre**, volontairement — c'est ce qui permet à l'utilisateur d'y écrire `skip` ou une note manuelle directement dans le Sheet.
- N'importe quelle instance de n'importe quelle phase peut déclencher le chemin "Erreur" — la position dans le pipeline ne change rien à ce qui se passe ensuite (écriture du statut, puis arrêt).
