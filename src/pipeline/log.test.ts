import { describe, expect, it, vi } from 'vitest';
import { loggedStep } from './log.js';

describe('loggedStep', () => {
  it('logge le message de départ puis "→ OK" une fois résolu avec succès', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await loggedStep(false, 'Étape', async () => 42);

    expect(result).toBe(42);
    expect(logSpy.mock.calls).toEqual([['Étape...'], ['→ OK']]);
    logSpy.mockRestore();
  });

  it('ne logge rien sous quiet', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loggedStep(true, 'Étape', async () => 1);

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("n'affiche jamais \"→ OK\" si l'action échoue, et propage l'erreur", async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      loggedStep(false, 'Étape', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(logSpy).toHaveBeenCalledWith('Étape...');
    expect(logSpy).not.toHaveBeenCalledWith('→ OK');
    logSpy.mockRestore();
  });
});
