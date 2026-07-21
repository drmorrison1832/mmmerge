#!/usr/bin/env node
/**
 * Point d'entrée : parsing mri, dispatch vers l'orchestrateur. Voir architecture.md §1, §6.
 * STUB — à implémenter.
 */
import mri from "mri";

async function main(): Promise<void> {
  const args = mri(process.argv.slice(2));
  const profileName = args._[0];

  if (!profileName) {
    console.error("Usage: mmmerge <profil> [options]");
    process.exit(1);
  }

  console.log(`[stub] mmmerge démarré avec le profil "${profileName}"`);
  console.log("[stub] Pipeline pas encore implémenté.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
