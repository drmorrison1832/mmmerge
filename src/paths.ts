/**
 * Racine du projet, résolue depuis l'emplacement de ce module plutôt que le répertoire
 * courant (process.cwd()) — permet à `mmmerge` de retrouver configs/credentials.json/
 * token.json quel que soit le dossier depuis lequel il est lancé (ex: après `npm link`).
 * Voir architecture.md §1.
 *
 * fileURLToPath (et non une manipulation manuelle de l'URL) est indispensable ici :
 * le chemin de ce projet contient un espace ("Projets Personnels"), encodé en %20 dans
 * import.meta.url — fileURLToPath le décode correctement, contrairement à `.pathname`.
 *
 * Ce module doit rester directement à la racine de src/ (comme il compile à la racine
 * de dist/) : PROJECT_ROOT = un niveau au-dessus du dossier contenant CE fichier, que ce
 * soit src/paths.ts (exécuté directement, ex: sous vitest) ou dist/paths.js (compilé).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = join(MODULE_DIR, '..');
