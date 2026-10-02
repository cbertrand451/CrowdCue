// Public DTOs and validation only: safe to reuse in the browser.
import { z } from 'zod';

export const partySettingsSchema = z
  .object({
    requireGuestNames: z.boolean().default(false),
    votingEnabled: z.boolean().default(true),
    approvalRequired: z.boolean().default(false),
    maxActiveRequestsPerGuest: z
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .default(null),
    allowExplicitTracks: z.boolean().default(true),
    requestCooldownSeconds: z.number().int().min(0).max(3600).default(0),
    queueBehavior: z
      .enum(['SPOTIFY_QUEUE', 'BACKUP_PLAYLIST'])
      .default('SPOTIFY_QUEUE'),
  })
  .strict();
export const createPartySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) =>
        Array.from(value).every(
          (character) =>
            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      ),
    settings: partySettingsSchema.default(() => partySettingsSchema.parse({})),
  })
  .strict();
export type CreatePartyInput = z.infer<typeof createPartySchema>;
export const publicPartySchema = z.object({
  name: z.string(),
  status: z.enum(['ACTIVE', 'ENDED']),
  settings: partySettingsSchema,
});
export const partyDetailsSchema = publicPartySchema.extend({
  id: z.uuid(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  links: z.object({
    guest: z.string().url(),
    admin: z.string().url().nullable(),
    display: z.string().url().nullable(),
  }),
});
export type PublicParty = z.infer<typeof publicPartySchema>;
export type PartyDetails = z.infer<typeof partyDetailsSchema>;

export class PartyError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
