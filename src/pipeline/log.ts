/**
 * Logging de progression en temps réel, actif par défaut (désactivable via --quiet).
 * Voir architecture.md §3.
 */

/** Log "<message>..." avant `action`, puis "<message> : OK" une fois `action` résolue avec succès. */
export async function loggedStep<T>(quiet: boolean, message: string, action: () => Promise<T>): Promise<T> {
  if (!quiet) console.log(`${message}...`);
  const result = await action();
  if (!quiet) console.log(`${message} : OK`);
  return result;
}
