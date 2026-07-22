#!/usr/bin/env node
/**
 * Point d'entrée : parsing mri, dispatch vers l'orchestrateur. Voir architecture.md §1, §6.
 */
import mri from 'mri';
import { loadConfig } from './config/loader.js';
import { runPipeline, type CliFlags } from './pipeline/orchestrator.js';
import { parseLines } from './cliFlags.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = mri(argv, { boolean: ['dry-run', 'force', 'validate', 'verbose', 'init-columns'] });
  const profileArg = args._[0];

  if (profileArg === undefined) {
    console.error('Usage: mmmerge <profil> [options]');
    process.exit(1);
  }
  const profileName = String(profileArg);

  const cliFlags: CliFlags = {
    dryRun: Boolean(args['dry-run']),
    force: Boolean(args.force),
    verbose: Boolean(args.verbose),
    validate: Boolean(args.validate),
    initColumns: Boolean(args['init-columns']),
    lines: parseLines(args.lines),
  };

  const config = loadConfig(profileName, argv);
  const exitCode = await runPipeline(config, cliFlags);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
