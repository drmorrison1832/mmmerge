# Build Idea : "MMMerge" (Nom de code temporaire)

Outil local de publipostage automatisé multi-format (documents + emails) piloté par Google Sheets.

## 1. Vision & Objectif

Automatiser la génération de documents (Google Docs et/ou PDF) et l'envoi ou la préparation de courriels associés, à partir de données centralisées dans Google Sheets — afin de simplifier tout processus administratif ou relationnel reposant sur du publipostage (contrats, factures, relances, invitations, etc.).

## 2. Public Cible & Contexte d'Utilisation

- **Utilisateur :** Un administrateur / gestionnaire unique.
- **Environnement :** Application Node.js s'exécutant en local (CLI ou script), connectée à un unique compte Google.
- **Volume :** Faible à modéré (une à quelques dizaines d'occurrences par mois).
- **Cas d'usage :** Générique — le premier cas d'application concret est la gestion des contrats CDDU, mais l'outil n'est pas conçu pour lui être spécifique.

## 3. Fonctionnalités Clés (MVP)

- **Extraction :** Lecture d'un tableur Google Sheets multi-onglets contenant les variables nécessaires à la génération (destinataires, dates, montants, chemins de documents, etc.).
- **Génération de documents :** Remplacement de variables textuelles dans un ou plusieurs modèles Google Docs, avec sortie en Google Docs et/ou en PDF.
- **Génération d'emails :** Création de courriels via Gmail, en deux modes possibles — brouillon à valider manuellement, ou envoi automatique.
- **Pièces jointes flexibles :** Les emails peuvent inclure soit les documents fraîchement générés, soit des documents déjà existants référencés directement dans le Google Sheet.
- **Contrôle :** Processus semi-automatisé incluant une étape de validation/supervision humaine avant les actions critiques (génération/envoi).
