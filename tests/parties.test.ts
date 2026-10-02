import { describe, expect, it } from 'vitest';
import { createPartySchema } from '../src/server/parties/contracts.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

describe('party validation', () => {
  it('normalizes names and supplies explicit safe defaults', () => {
    const result = createPartySchema.parse({
      name: '  Sam’s party  ',
      settings: { approvalRequired: true },
    });
    expect(result.name).toBe('Sam’s party');
    expect(result.settings).toMatchObject({
      approvalRequired: true,
      votingEnabled: true,
      requireGuestNames: false,
      maxActiveRequestsPerGuest: null,
    });
    expect(
      createPartySchema.parse({ name: 'Party' }).settings
        .requestCooldownSeconds,
    ).toBe(0);
  });
  it('rejects private ownership fields, invalid names, and unsafe or unrecognized settings', () => {
    for (const input of [
      { name: '' },
      { name: '   ' },
      { name: 'a'.repeat(121) },
      { name: 'bad\u0000name' },
      { name: 'bad\nname' },
      { name: 123 },
      { name: 'Party', host_account_id: 'untrusted' },
      { name: 'Party', status: 'ENDED' },
      { name: 'Party', settings: { votingEnabled: 'false' } },
      { name: 'Party', settings: { maxActiveRequestsPerGuest: -1 } },
      { name: 'Party', settings: { maxActiveRequestsPerGuest: 101 } },
      { name: 'Party', settings: { requestCooldownSeconds: 3601 } },
      { name: 'Party', settings: { unknown: true } },
    ])
      expect(createPartySchema.safeParse(input).success).toBe(false);
  });
  it('keeps the base app running and returns a clear error when party creation is unavailable', async () => {
    const app = buildApp(readConfig({ NODE_ENV: 'test' }), { logger: false });
    try {
      expect((await app.inject('/api/health')).statusCode).toBe(200);
      const response = await app.inject({
        method: 'POST',
        url: '/api/parties',
        payload: { name: 'Party' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: 'Party creation is not available yet.',
      });
    } finally {
      await app.close();
    }
  });
});
